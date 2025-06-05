import { GitRepository } from "./git-utils.ts";
import { SessionLog, WorkspaceManager } from "./workspace.ts";
import { execInDevcontainer } from "./devcontainer.ts";

interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id: string;
    type: string;
    role: string;
    model: string;
    content: Array<{
      type: string;
      text?: string;
    }>;
    stop_reason: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  result?: string;
  is_error?: boolean;
}

export interface ClaudeCommandExecutor {
  execute(
    args: string[],
    cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;

  executeStreaming?(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }>;
}

class DefaultClaudeCommandExecutor implements ClaudeCommandExecutor {
  async execute(
    args: string[],
    cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const command = new Deno.Command("claude", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    return { code, stdout, stderr };
  }

  async executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const command = new Deno.Command("claude", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // stdoutをストリーミングで読み取る
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    let stderrOutput = new Uint8Array();

    // stdoutの読み取りPromise
    const stdoutPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          if (value) {
            onData(value);
          }
        }
      } catch (error) {
        console.error("stdout読み取りエラー:", error);
      } finally {
        stdoutReader.releaseLock();
      }
    })();

    // stderrの読み取りPromise
    const stderrPromise = (async () => {
      try {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
          }
        }
        // stderrの内容を結合
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        stderrOutput = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          stderrOutput.set(chunk, offset);
          offset += chunk.length;
        }
      } catch (error) {
        console.error("stderr読み取りエラー:", error);
      } finally {
        stderrReader.releaseLock();
      }
    })();

    // プロセスの終了を待つ
    const [{ code }] = await Promise.all([
      process.status,
      stdoutPromise,
      stderrPromise,
    ]);

    return { code, stderr: stderrOutput };
  }
}

export class DevcontainerClaudeExecutor implements ClaudeCommandExecutor {
  private readonly repositoryPath: string;

  constructor(repositoryPath: string) {
    this.repositoryPath = repositoryPath;
  }

  async execute(
    args: string[],
    _cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    // devcontainer内でclaudeコマンドを実行
    const command = ["claude", ...args];
    return await execInDevcontainer(this.repositoryPath, command);
  }

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // devcontainer内でclaudeコマンドをストリーミング実行
    const devcontainerCommand = new Deno.Command("devcontainer", {
      args: [
        "exec",
        "--workspace-folder",
        this.repositoryPath,
        "claude",
        ...args,
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: this.repositoryPath,
      env: {
        ...Deno.env.toObject(),
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      },
    });

    const process = devcontainerCommand.spawn();

    // stdoutをストリーミングで読み取る
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    let stderrOutput = new Uint8Array();

    // stdoutの読み取りPromise
    const stdoutPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          if (value) {
            onData(value);
          }
        }
      } catch (error) {
        console.error("devcontainer stdout読み取りエラー:", error);
      } finally {
        stdoutReader.releaseLock();
      }
    })();

    // stderrの読み取りPromise
    const stderrPromise = (async () => {
      try {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
          }
        }
        // stderrの内容を結合
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        stderrOutput = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          stderrOutput.set(chunk, offset);
          offset += chunk.length;
        }
      } catch (error) {
        console.error("devcontainer stderr読み取りエラー:", error);
      } finally {
        stderrReader.releaseLock();
      }
    })();

    // プロセスの終了を待つ
    const [{ code }] = await Promise.all([
      process.status,
      stdoutPromise,
      stderrPromise,
    ]);

    return { code, stderr: stderrOutput };
  }
}

export interface IWorker {
  processMessage(
    message: string,
    onProgress?: (content: string) => Promise<void>,
  ): Promise<string>;
  getName(): string;
  getRepository(): GitRepository | null;
  setRepository(repository: GitRepository, localPath: string): Promise<void>;
  setThreadId(threadId: string): void;
}

export class Worker implements IWorker {
  private readonly name: string;
  private repository: GitRepository | null = null;
  private worktreePath: string | null = null;
  private sessionId: string | null = null;
  private threadId: string | null = null;
  private claudeExecutor: ClaudeCommandExecutor;
  private readonly workspaceManager: WorkspaceManager;
  private useDevcontainer: boolean = false;
  private devcontainerStarted: boolean = false;
  private skipPermissions: boolean = false;
  private verbose: boolean = false;

  constructor(
    name: string,
    workspaceManager: WorkspaceManager,
    claudeExecutor?: ClaudeCommandExecutor,
    verbose?: boolean,
  ) {
    this.name = name;
    this.workspaceManager = workspaceManager;
    this.claudeExecutor = claudeExecutor || new DefaultClaudeCommandExecutor();
    this.verbose = verbose || false;
  }

  async processMessage(
    message: string,
    onProgress?: (content: string) => Promise<void>,
  ): Promise<string> {
    this.logVerbose("メッセージ処理開始", {
      messageLength: message.length,
      hasRepository: !!this.repository,
      hasWorktreePath: !!this.worktreePath,
      threadId: this.threadId,
      sessionId: this.sessionId,
    });

    if (!this.repository || !this.worktreePath) {
      this.logVerbose("リポジトリまたはworktreeパスが未設定");
      return "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。";
    }

    try {
      // セッションログの記録（コマンド）
      if (this.threadId) {
        this.logVerbose("セッションログにコマンドを記録");
        await this.logSessionActivity("command", message);
      }

      // 処理開始の通知
      if (onProgress) {
        this.logVerbose("進捗通知開始");
        await onProgress("🤖 Claudeが考えています...");
      }

      this.logVerbose("Claude実行開始");
      const result = await this.executeClaude(message, onProgress);
      this.logVerbose("Claude実行完了", { resultLength: result.length });

      const formattedResponse = this.formatResponse(result);
      this.logVerbose("レスポンス整形完了", {
        formattedLength: formattedResponse.length,
      });

      // セッションログの記録（レスポンス）
      if (this.threadId) {
        this.logVerbose("セッションログにレスポンスを記録");
        await this.logSessionActivity("response", formattedResponse);
      }

      this.logVerbose("メッセージ処理完了");
      return formattedResponse;
    } catch (error) {
      this.logVerbose("メッセージ処理エラー", {
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
      });
      console.error(`Worker ${this.name} - Claude実行エラー:`, error);
      const errorMessage = `エラーが発生しました: ${(error as Error).message}`;

      // エラーもセッションログに記録
      if (this.threadId) {
        await this.logSessionActivity("error", errorMessage, {
          originalError: (error as Error).message,
          stack: (error as Error).stack,
        });
      }

      return errorMessage;
    }
  }

  private async executeClaude(
    prompt: string,
    onProgress?: (content: string) => Promise<void>,
  ): Promise<string> {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
    ];

    // verboseモードが有効な場合のみ--verboseオプションを追加
    if (this.verbose) {
      args.push("--verbose");
    }

    // セッション継続の場合
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
      this.logVerbose("セッション継続", { sessionId: this.sessionId });
    }

    // --dangerously-skip-permissions オプション
    if (this.skipPermissions) {
      args.push("--dangerously-skip-permissions");
      this.logVerbose("権限チェックスキップを使用");
    }

    this.logVerbose("Claudeコマンド実行", {
      args: args,
      cwd: this.worktreePath,
      useDevcontainer: this.useDevcontainer,
      hasStreaming: !!this.claudeExecutor.executeStreaming,
    });

    // ストリーミング実行が可能な場合
    if (this.claudeExecutor.executeStreaming && onProgress) {
      this.logVerbose("ストリーミング実行開始");
      return await this.executeClaudeStreaming(args, onProgress);
    }

    // 通常の実行
    this.logVerbose("通常実行開始");
    const { code, stdout, stderr } = await this.claudeExecutor.execute(
      args,
      this.worktreePath!,
    );

    this.logVerbose("Claudeコマンド実行完了", {
      exitCode: code,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
    });

    if (code !== 0) {
      const errorMessage = new TextDecoder().decode(stderr);
      this.logVerbose("Claude実行エラー", { exitCode: code, errorMessage });
      throw new Error(`Claude実行失敗 (終了コード: ${code}): ${errorMessage}`);
    }

    const output = new TextDecoder().decode(stdout);
    this.logVerbose("出力解析開始", { outputLength: output.length });
    return this.parseStreamJsonOutput(output, onProgress);
  }

  private async executeClaudeStreaming(
    args: string[],
    onProgress: (content: string) => Promise<void>,
  ): Promise<string> {
    this.logVerbose("ストリーミング実行詳細開始");
    const decoder = new TextDecoder();
    let buffer = "";
    let result = "";
    let newSessionId: string | null = null;
    let progressContent = "";
    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 1000; // 1秒ごとに更新
    let allOutput = "";
    let processedLines = 0;

    const processLine = (line: string) => {
      if (!line.trim()) return;
      processedLines++;

      try {
        const parsed: ClaudeStreamMessage = JSON.parse(line);
        this.logVerbose(`ストリーミング行処理: ${parsed.type}`, {
          lineNumber: processedLines,
          hasSessionId: !!parsed.session_id,
          hasMessage: !!parsed.message,
        });

        // JSONL各行の進捗をDiscordに送信
        if (onProgress) {
          const progressMessage = this.createProgressMessage(
            parsed,
            processedLines,
          );
          if (progressMessage) {
            onProgress(progressMessage).catch(console.error);
          }
        }

        // セッションIDを更新
        if (parsed.session_id) {
          newSessionId = parsed.session_id;
          this.logVerbose("新しいセッションID取得", {
            sessionId: newSessionId,
          });
        }

        // アシスタントメッセージからテキストを抽出
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === "text" && content.text) {
              result += content.text;
              progressContent += content.text;

              // 進捗の更新（一定間隔で）
              const now = Date.now();
              if (
                progressContent.length > 50 &&
                now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL
              ) {
                // 最後の完全な文または段落を送信
                const lastNewline = progressContent.lastIndexOf("\n");
                if (lastNewline > 0) {
                  const toSend = progressContent.substring(0, lastNewline);
                  if (toSend.trim()) {
                    this.logVerbose("進捗更新送信", {
                      contentLength: toSend.length,
                      timeSinceLastUpdate: now - lastProgressUpdate,
                    });
                    onProgress(this.formatResponse(toSend)).catch(
                      console.error,
                    );
                    lastProgressUpdate = now;
                  }
                }
              }
            }
          }
        }

        // 最終結果を取得
        if (parsed.type === "result" && parsed.result) {
          result = parsed.result;
          this.logVerbose("最終結果取得", { resultLength: result.length });
        }
      } catch (parseError) {
        this.logVerbose(`JSON解析エラー: ${parseError}`, {
          line: line.substring(0, 100),
        });
        console.warn(`JSON解析エラー: ${parseError}, 行: ${line}`);
      }
    };

    const onData = (data: Uint8Array) => {
      const chunk = decoder.decode(data, { stream: true });
      allOutput += chunk;
      buffer += chunk;

      // 改行で分割して処理
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    };

    const { code, stderr } = await this.claudeExecutor.executeStreaming!(
      args,
      this.worktreePath!,
      onData,
    );

    this.logVerbose("ストリーミング実行完了", {
      exitCode: code,
      stderrLength: stderr.length,
      totalOutputLength: allOutput.length,
      processedLines,
      hasNewSessionId: !!newSessionId,
    });

    // 最後のバッファを処理
    if (buffer) {
      this.logVerbose("最終バッファ処理", { bufferLength: buffer.length });
      processLine(buffer);
    }

    if (code !== 0) {
      const errorMessage = decoder.decode(stderr);
      this.logVerbose("ストリーミング実行エラー", {
        exitCode: code,
        errorMessage,
      });
      throw new Error(`Claude実行失敗 (終了コード: ${code}): ${errorMessage}`);
    }

    // セッションIDを更新
    if (newSessionId) {
      this.sessionId = newSessionId;
      this.logVerbose("セッションID更新", {
        oldSessionId: this.sessionId,
        newSessionId,
      });
    }

    // 生のjsonlを保存
    if (this.repository?.fullName && allOutput.trim()) {
      this.logVerbose("生JSONLを保存", { outputLength: allOutput.length });
      await this.saveRawJsonlOutput(allOutput);
    }

    const finalResult = result.trim() ||
      "Claude からの応答を取得できませんでした。";
    this.logVerbose("ストリーミング処理完了", {
      finalResultLength: finalResult.length,
    });
    return finalResult;
  }

  private parseStreamJsonOutput(
    output: string,
    onProgress?: (content: string) => Promise<void>,
  ): string {
    const lines = output.trim().split("\n");
    let result = "";
    let newSessionId: string | null = null;
    let progressContent = "";
    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 1000; // 1秒ごとに更新
    let processedLines = 0;

    // 生のjsonlを保存
    if (this.repository?.fullName && output.trim()) {
      this.saveRawJsonlOutput(output);
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processedLines++;

      try {
        const parsed: ClaudeStreamMessage = JSON.parse(line);

        // JSONL各行の進捗をDiscordに送信
        if (onProgress) {
          const progressMessage = this.createProgressMessage(
            parsed,
            processedLines,
          );
          if (progressMessage) {
            onProgress(progressMessage).catch(console.error);
          }
        }

        // セッションIDを更新
        if (parsed.session_id) {
          newSessionId = parsed.session_id;
        }

        // アシスタントメッセージからテキストを抽出
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === "text" && content.text) {
              result += content.text;
              progressContent += content.text;

              // 進捗の更新（一定間隔で）
              const now = Date.now();
              if (
                onProgress && progressContent.length > 50 &&
                now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL
              ) {
                // 最後の完全な文または段落を送信
                const lastNewline = progressContent.lastIndexOf("\n");
                if (lastNewline > 0) {
                  const toSend = progressContent.substring(0, lastNewline);
                  if (toSend.trim()) {
                    onProgress(this.formatResponse(toSend)).catch(
                      console.error,
                    );
                    lastProgressUpdate = now;
                  }
                }
              }
            }
          }
        }

        // 最終結果を取得
        if (parsed.type === "result" && parsed.result) {
          result = parsed.result;
        }
      } catch (parseError) {
        console.warn(`JSON解析エラー: ${parseError}, 行: ${line}`);
        // JSON解析できない行はそのまま結果に含める
        result += line + "\n";
      }
    }

    // セッションIDを更新
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    return result.trim() || "Claude からの応答を取得できませんでした。";
  }

  private async saveRawJsonlOutput(output: string): Promise<void> {
    if (!this.repository?.fullName || !this.sessionId) return;

    try {
      await this.workspaceManager.saveRawSessionJsonl(
        this.repository.fullName,
        this.sessionId,
        output,
      );
    } catch (error) {
      console.error("生JSONLの保存に失敗しました:", error);
    }
  }

  private formatResponse(response: string): string {
    // Discordの文字数制限（2000文字）を考慮
    const maxLength = 1900; // 余裕を持って少し短く

    if (response.length <= maxLength) {
      // ANSIエスケープシーケンスを除去
      return this.stripAnsiCodes(response);
    }

    // 長すぎる場合は分割して最初の部分だけ返す
    const truncated = response.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf("\n");

    // 改行で綺麗に切れる位置があれば、そこで切る
    const finalResponse = lastNewline > maxLength * 0.8
      ? truncated.substring(0, lastNewline)
      : truncated;

    return this.stripAnsiCodes(finalResponse) +
      "\n\n*（応答が長いため、一部のみ表示しています）*";
  }

  private stripAnsiCodes(text: string): string {
    // ANSIエスケープシーケンスを除去する正規表現
    // deno-lint-ignore no-control-regex
    return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
  }

  getName(): string {
    return this.name;
  }

  getRepository(): GitRepository | null {
    return this.repository;
  }

  async setRepository(
    repository: GitRepository,
    localPath: string,
  ): Promise<void> {
    this.logVerbose("リポジトリ設定開始", {
      repositoryFullName: repository.fullName,
      localPath,
      hasThreadId: !!this.threadId,
      useDevcontainer: this.useDevcontainer,
    });

    this.repository = repository;

    if (this.threadId) {
      try {
        this.logVerbose("worktree作成開始", { threadId: this.threadId });
        this.worktreePath = await this.workspaceManager.createWorktree(
          this.threadId,
          localPath,
        );
        this.logVerbose("worktree作成完了", {
          worktreePath: this.worktreePath,
        });

        const threadInfo = await this.workspaceManager.loadThreadInfo(
          this.threadId,
        );
        if (threadInfo) {
          threadInfo.repositoryFullName = repository.fullName;
          threadInfo.repositoryLocalPath = localPath;
          threadInfo.worktreePath = this.worktreePath;
          await this.workspaceManager.saveThreadInfo(threadInfo);
          this.logVerbose("スレッド情報更新完了");
        }
      } catch (error) {
        this.logVerbose("worktree作成失敗、localPathを使用", {
          error: (error as Error).message,
          fallbackPath: localPath,
        });
        console.error(`worktreeの作成に失敗しました: ${error}`);
        this.worktreePath = localPath;
      }
    } else {
      this.logVerbose("threadIdなし、localPathを直接使用");
      this.worktreePath = localPath;
    }

    // devcontainerが有効な場合はDevcontainerClaudeExecutorに切り替え
    if (this.useDevcontainer && this.worktreePath) {
      this.logVerbose("DevcontainerClaudeExecutorに切り替え");
      this.claudeExecutor = new DevcontainerClaudeExecutor(this.worktreePath);
    }

    this.sessionId = null;
    this.logVerbose("リポジトリ設定完了", {
      finalWorktreePath: this.worktreePath,
      executorType: this.useDevcontainer
        ? "DevcontainerClaudeExecutor"
        : "DefaultClaudeCommandExecutor",
    });
  }

  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }

  /**
   * devcontainerの使用を設定する
   */
  setUseDevcontainer(useDevcontainer: boolean): void {
    this.useDevcontainer = useDevcontainer;
  }

  /**
   * devcontainerが使用されているかを取得
   */
  isUsingDevcontainer(): boolean {
    return this.useDevcontainer;
  }

  /**
   * devcontainerが起動済みかを取得
   */
  isDevcontainerStarted(): boolean {
    return this.devcontainerStarted;
  }

  /**
   * --dangerously-skip-permissions オプションの使用を設定する
   */
  setSkipPermissions(skipPermissions: boolean): void {
    this.skipPermissions = skipPermissions;
  }

  /**
   * --dangerously-skip-permissions オプションが使用されているかを取得
   */
  isSkipPermissions(): boolean {
    return this.skipPermissions;
  }

  /**
   * verboseモードを設定する
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * verboseモードが有効かを取得
   */
  isVerbose(): boolean {
    return this.verbose;
  }

  /**
   * JSONL行から進捗メッセージを作成する
   */
  private createProgressMessage(
    parsed: ClaudeStreamMessage,
    lineNumber: number,
  ): string | null {
    switch (parsed.type) {
      case "task_start":
        return `🔍 [${lineNumber}] タスク開始: 分析中...`;

      case "tool_use":
        return `🛠️ [${lineNumber}] ツール使用中...`;

      case "thinking":
        return `💭 [${lineNumber}] 思考中...`;

      case "assistant":
        if (parsed.message?.content?.some((c) => c.type === "text")) {
          return `✍️ [${lineNumber}] 回答生成中...`;
        }
        return null;

      case "result":
        return `✅ [${lineNumber}] 処理完了`;

      case "error":
        return `❌ [${lineNumber}] エラーが発生しました`;

      case "session_start":
        return `🎯 [${lineNumber}] セッション開始`;

      case "session_end":
        return `🏁 [${lineNumber}] セッション終了`;

      default:
        // その他のタイプは限定的に表示
        if (
          parsed.type && !["ping", "metadata", "debug"].includes(parsed.type)
        ) {
          return `⚡ [${lineNumber}] ${parsed.type}`;
        }
        return null;
    }
  }

  /**
   * verboseログを出力する
   */
  private logVerbose(
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [Worker:${this.name}] ${message}`;
      console.log(logMessage);

      if (metadata && Object.keys(metadata).length > 0) {
        console.log(
          `[${timestamp}] [Worker:${this.name}] メタデータ:`,
          metadata,
        );
      }
    }
  }

  /**
   * devcontainerを起動する
   */
  async startDevcontainer(
    onProgress?: (message: string) => Promise<void>,
  ): Promise<
    { success: boolean; containerId?: string; error?: string }
  > {
    if (!this.repository || !this.worktreePath) {
      return {
        success: false,
        error: "リポジトリが設定されていません",
      };
    }

    const { startDevcontainer } = await import("./devcontainer.ts");
    const result = await startDevcontainer(this.worktreePath, onProgress);

    if (result.success) {
      this.devcontainerStarted = true;
    }

    return result;
  }

  private async logSessionActivity(
    type: "command" | "response" | "error",
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.threadId) return;

    const sessionLog: SessionLog = {
      sessionId: this.sessionId || "no-session",
      threadId: this.threadId,
      timestamp: new Date().toISOString(),
      type,
      content,
      metadata: {
        ...metadata,
        repository: this.repository?.fullName,
        workerName: this.name,
      },
    };

    try {
      await this.workspaceManager.saveSessionLog(sessionLog);
    } catch (error) {
      console.error("セッションログの保存に失敗しました:", error);
    }
  }
}
