import { GitRepository } from "./git-utils.ts";
import { SessionLog, WorkspaceManager } from "./workspace.ts";

export class ClaudeCodeRateLimitError extends Error {
  public readonly timestamp: number;

  constructor(timestamp: number) {
    super(`Claude AI usage limit reached|${timestamp}`);
    this.name = "ClaudeCodeRateLimitError";
    this.timestamp = timestamp;
  }
}

async function processStreams(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
  onData: (data: Uint8Array) => void,
): Promise<Uint8Array> {
  const stdoutReader = stdout.getReader();
  const stderrReader = stderr.getReader();
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

  await Promise.all([stdoutPromise, stderrPromise]);
  return stderrOutput;
}

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
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
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
  executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }>;
}

class DefaultClaudeCommandExecutor implements ClaudeCommandExecutor {
  private readonly verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  async executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // VERBOSEモードでコマンド詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DefaultClaudeCommandExecutor] Claudeコマンド実行:`,
      );
      console.log(`  作業ディレクトリ: ${cwd}`);
      console.log(`  引数: ${JSON.stringify(args)}`);
    }

    const command = new Deno.Command("claude", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // プロセスの終了を待つ
    const [{ code }, stderrOutput] = await Promise.all([
      process.status,
      processStreams(process.stdout, process.stderr, onData),
    ]);

    // VERBOSEモードで実行結果詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DefaultClaudeCommandExecutor] 実行完了:`,
      );
      console.log(`  終了コード: ${code}`);
      console.log(`  stderr長: ${stderrOutput.length}バイト`);
    }

    return { code, stderr: stderrOutput };
  }
}

export class DevcontainerClaudeExecutor implements ClaudeCommandExecutor {
  private readonly repositoryPath: string;
  private readonly verbose: boolean;

  constructor(repositoryPath: string, verbose: boolean = false) {
    this.repositoryPath = repositoryPath;
    this.verbose = verbose;
  }

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // VERBOSEモードでdevcontainerコマンド詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DevcontainerClaudeExecutor] devcontainerコマンド実行:`,
      );
      console.log(`  リポジトリパス: ${this.repositoryPath}`);
      console.log(`  引数: ${JSON.stringify(args)}`);
    }

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

    // プロセスの終了を待つ
    const [{ code }, stderrOutput] = await Promise.all([
      process.status,
      processStreams(process.stdout, process.stderr, onData),
    ]);

    // VERBOSEモードで実行結果詳細ログ
    if (this.verbose) {
      console.log(
        `[${new Date().toISOString()}] [DevcontainerClaudeExecutor] 実行完了:`,
      );
      console.log(`  終了コード: ${code}`);
      console.log(`  stderr長: ${stderrOutput.length}バイト`);
    }

    return { code, stderr: stderrOutput };
  }
}

export interface IWorker {
  processMessage(
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
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
    this.verbose = verbose || false;
    this.claudeExecutor = claudeExecutor ||
      new DefaultClaudeCommandExecutor(this.verbose);
  }

  async processMessage(
    message: string,
    onProgress: (content: string) => Promise<void> = async () => {},
    onReaction?: (emoji: string) => Promise<void>,
  ): Promise<string> {
    this.logVerbose("メッセージ処理開始", {
      messageLength: message.length,
      hasRepository: !!this.repository,
      hasWorktreePath: !!this.worktreePath,
      threadId: this.threadId,
      sessionId: this.sessionId,
      hasReactionCallback: !!onReaction,
    });

    // VERBOSEモードでユーザーメッセージの詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [Worker:${this.name}] ユーザーメッセージ処理詳細:`,
      );
      console.log(`  メッセージ: "${message}"`);
      console.log(`  リポジトリ: ${this.repository?.fullName || "なし"}`);
      console.log(`  worktreePath: ${this.worktreePath || "なし"}`);
      console.log(`  セッションID: ${this.sessionId || "なし"}`);
    }

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
      this.logVerbose("進捗通知開始");
      await onProgress("🤖 Claudeが考えています...");

      // Claude実行開始前のリアクションを追加
      if (onReaction) {
        try {
          await onReaction("⚙️");
          this.logVerbose("Claude実行開始リアクション追加完了");
        } catch (error) {
          this.logVerbose("Claude実行開始リアクション追加エラー", {
            error: (error as Error).message,
          });
        }
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
    onProgress: (content: string) => Promise<void>,
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
    });

    this.logVerbose("ストリーミング実行開始");
    return await this.executeClaudeStreaming(args, onProgress);
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

        // Claude Codeの実際の出力内容をDiscordに送信
        if (onProgress) {
          const outputMessage = this.extractOutputMessage(parsed);
          if (outputMessage) {
            onProgress(this.formatResponse(outputMessage)).catch(console.error);
          }
        }

        // セッションIDを更新
        if (parsed.session_id) {
          newSessionId = parsed.session_id;
          this.logVerbose("新しいセッションID取得", {
            sessionId: newSessionId,
          });
        }

        // アシスタントメッセージからテキストを抽出（結果の蓄積のみ）
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === "text" && content.text) {
              result += content.text;
            }
          }
        }

        // 最終結果を取得
        if (parsed.type === "result" && parsed.result) {
          result = parsed.result;
          this.logVerbose("最終結果取得", { resultLength: result.length });

          // Claude Codeレートリミットの検出
          if (this.isClaudeCodeRateLimit(parsed.result)) {
            const timestamp = this.extractRateLimitTimestamp(parsed.result);
            if (timestamp) {
              throw new ClaudeCodeRateLimitError(timestamp);
            }
          }
        }
      } catch (parseError) {
        this.logVerbose(`JSON解析エラー: ${parseError}`, {
          line: line.substring(0, 100),
        });
        console.warn(`JSON解析エラー: ${parseError}, 行: ${line}`);

        // JSONとしてパースできなかった場合の処理
        // JSONらしい内容（{や"type"を含む）の場合は、不完全なJSON断片の可能性があるため投稿しない
        if (onProgress && line.trim()) {
          const trimmedLine = line.trim();
          // JSON断片の兆候をチェック
          const isLikelyJsonFragment = trimmedLine.startsWith("{") ||
            trimmedLine.includes('"type":') ||
            trimmedLine.includes('"message":') ||
            trimmedLine.includes('"content":') ||
            trimmedLine.includes('"text":') ||
            trimmedLine.includes('"result":');

          if (!isLikelyJsonFragment) {
            // JSON断片でない場合のみ投稿（通常のエラーメッセージなど）
            onProgress(this.formatResponse(line)).catch(console.error);
          } else {
            this.logVerbose("JSON断片と判断して投稿をスキップ", {
              linePreview: trimmedLine.substring(0, 100),
            });
          }
        }
      }
    };

    const onData = (data: Uint8Array) => {
      const chunk = decoder.decode(data, { stream: true });
      allOutput += chunk;
      buffer += chunk;

      // VERBOSEモードでstdoutを詳細ログ出力
      if (this.verbose && chunk.trim()) {
        console.log(
          `[${new Date().toISOString()}] [Worker:${this.name}] Claude stdout:`,
        );
        console.log(
          `  ${chunk.split("\n").map((line) => `  ${line}`).join("\n")}`,
        );
      }

      // 改行で分割して処理
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    };

    const { code, stderr } = await this.claudeExecutor.executeStreaming(
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

      // VERBOSEモードでstderrを詳細ログ出力
      if (this.verbose && stderr.length > 0) {
        console.log(
          `[${new Date().toISOString()}] [Worker:${this.name}] Claude stderr:`,
        );
        console.log(`  終了コード: ${code}`);
        console.log(`  エラー内容:`);
        console.log(
          `    ${
            errorMessage.split("\n").map((line) => `    ${line}`).join("\n")
          }`,
        );
      }

      this.logVerbose("ストリーミング実行エラー", {
        exitCode: code,
        errorMessage,
      });
      throw new Error(`Claude実行失敗 (終了コード: ${code}): ${errorMessage}`);
    }

    // VERBOSEモードで成功時のstderrも出力（警告等の情報がある場合）
    if (this.verbose && stderr.length > 0) {
      const stderrContent = decoder.decode(stderr);
      if (stderrContent.trim()) {
        console.log(
          `[${
            new Date().toISOString()
          }] [Worker:${this.name}] Claude stderr (警告等):`,
        );
        console.log(
          `  ${
            stderrContent.split("\n").map((line) => `  ${line}`).join("\n")
          }`,
        );
      }
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
      this.claudeExecutor = new DevcontainerClaudeExecutor(
        this.worktreePath,
        this.verbose,
      );
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
   * JSONL行からClaude Codeの実際の出力メッセージを抽出する
   */
  private extractOutputMessage(parsed: ClaudeStreamMessage): string | null {
    // assistantメッセージの場合
    if (parsed.type === "assistant" && parsed.message?.content) {
      return this.extractAssistantMessage(parsed.message.content);
    }

    // userメッセージの場合（tool_result等）
    if (parsed.type === "user" && parsed.message?.content) {
      return this.extractUserMessage(parsed.message.content);
    }

    // resultメッセージは最終結果として別途処理されるため、ここでは返さない
    if (parsed.type === "result") {
      return null;
    }

    // エラーメッセージの場合
    if (parsed.is_error && parsed.message?.content) {
      return this.extractErrorMessage(parsed.message.content);
    }

    return null;
  }

  /**
   * assistantメッセージのcontentを処理する
   */
  private extractAssistantMessage(
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>,
  ): string | null {
    let textContent = "";

    for (const item of content) {
      if (item.type === "text" && item.text) {
        textContent += item.text;
      } else if (item.type === "tool_use") {
        // ツール使用を進捗として投稿
        const toolMessage = this.formatToolUse(item);
        if (toolMessage) {
          return toolMessage;
        }
      }
    }

    // テキスト内容からTODOリスト更新の検出も試行（fallback）
    const todoListUpdate = this.extractTodoListUpdate(textContent);
    if (todoListUpdate) {
      return todoListUpdate;
    }

    return textContent || null;
  }

  /**
   * userメッセージのcontentを処理する（tool_result等）
   */
  private extractUserMessage(
    content: Array<{
      type: string;
      text?: string;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>,
  ): string | null {
    for (const item of content) {
      if (item.type === "tool_result") {
        const resultContent = item.content || "";

        // TodoWrite成功の定型文はスキップ
        if (!item.is_error && this.isTodoWriteSuccessMessage(resultContent)) {
          return null;
        }

        // ツール結果を進捗として投稿
        const resultIcon = item.is_error ? "❌" : "✅";

        // 長さに応じて処理を分岐
        const formattedContent = this.formatToolResult(
          resultContent,
          item.is_error || false,
        );

        return `${resultIcon} **ツール実行結果:**\n${formattedContent}`;
      } else if (item.type === "text" && item.text) {
        return item.text;
      }
    }
    return null;
  }

  /**
   * エラーメッセージのcontentを処理する
   */
  private extractErrorMessage(
    content: Array<{
      type: string;
      text?: string;
    }>,
  ): string | null {
    let errorContent = "";
    for (const item of content) {
      if (item.type === "text" && item.text) {
        errorContent += item.text;
      }
    }
    return errorContent || null;
  }

  /**
   * ツール実行結果を長さと内容に応じてフォーマットする
   */
  private formatToolResult(content: string, isError: boolean): string {
    if (!content.trim()) {
      return "```\n(空の結果)\n```";
    }

    const maxLength = 1500; // Discord制限を考慮した最大長

    // 短い場合は全文表示
    if (content.length <= 500) {
      return `\`\`\`\n${content}\n\`\`\``;
    }

    // エラーの場合は特別処理
    if (isError) {
      return this.formatErrorResult(content, maxLength);
    }

    // 中程度の長さの場合
    if (content.length <= 2000) {
      return this.formatMediumResult(content, maxLength);
    }

    // 非常に長い場合はスマート要約
    return this.formatLongResult(content, maxLength);
  }

  /**
   * エラー結果をフォーマットする
   */
  private formatErrorResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const errorLines: string[] = [];
    const importantLines: string[] = [];

    // エラーや重要な情報を含む行を抽出
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (
        lowerLine.includes("error") || lowerLine.includes("failed") ||
        lowerLine.includes("exception") || lowerLine.startsWith("fatal:")
      ) {
        errorLines.push(line);
      } else if (
        line.trim() && !lowerLine.includes("debug") &&
        !lowerLine.includes("info")
      ) {
        importantLines.push(line);
      }
    }

    // エラー行を優先して表示
    const displayLines = [...errorLines, ...importantLines.slice(0, 5)];
    const result = displayLines.join("\n");

    if (result.length <= maxLength) {
      return `\`\`\`\n${result}\n\`\`\``;
    }

    return `\`\`\`\n${
      result.substring(0, maxLength - 100)
    }...\n\n[${lines.length}行中の重要部分を表示]\n\`\`\``;
  }

  /**
   * 中程度の長さの結果をフォーマットする
   */
  private formatMediumResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const headLines = lines.slice(0, 10).join("\n");
    const tailLines = lines.slice(-5).join("\n");

    const result = lines.length > 15
      ? `${headLines}\n\n... [${lines.length - 15}行省略] ...\n\n${tailLines}`
      : content;

    if (result.length <= maxLength) {
      return `\`\`\`\n${result}\n\`\`\``;
    }

    return `\`\`\`\n${result.substring(0, maxLength - 100)}...\n\`\`\``;
  }

  /**
   * 長い結果をスマート要約する
   */
  private formatLongResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const summary = this.extractSummaryInfo(content);

    if (summary) {
      const summaryDisplay = `📊 **要約:** ${summary}\n\`\`\`\n${
        lines.slice(0, 3).join("\n")
      }\n... [${lines.length}行の詳細結果] ...\n${
        lines.slice(-2).join("\n")
      }\n\`\`\``;

      // maxLengthを超える場合は更に短縮
      if (summaryDisplay.length > maxLength) {
        return `📊 **要約:** ${summary}\n\`\`\`\n${
          lines.slice(0, 2).join("\n")
        }\n... [${lines.length}行の結果] ...\n\`\`\``;
      }
      return summaryDisplay;
    }

    // 要約できない場合は先頭部分のみ
    const preview = lines.slice(0, 8).join("\n");
    const result =
      `\`\`\`\n${preview}\n\n... [全${lines.length}行中の先頭部分のみ表示] ...\n\`\`\``;

    // maxLengthを超える場合は更に短縮
    if (result.length > maxLength) {
      const shortPreview = lines.slice(0, 4).join("\n");
      return `\`\`\`\n${shortPreview}\n... [${lines.length}行の結果] ...\n\`\`\``;
    }

    return result;
  }

  /**
   * 内容から要約情報を抽出する
   */
  private extractSummaryInfo(content: string): string | null {
    // gitコミット結果
    const gitCommitMatch = content.match(/\[([a-f0-9]+)\] (.+)/);
    if (gitCommitMatch) {
      const filesChanged = content.match(/(\d+) files? changed/);
      const insertions = content.match(/(\d+) insertions?\(\+\)/);
      const deletions = content.match(/(\d+) deletions?\(-\)/);

      let summary = `コミット ${gitCommitMatch[1].substring(0, 7)}: ${
        gitCommitMatch[2]
      }`;
      if (filesChanged) {
        summary += ` (${filesChanged[1]}ファイル変更`;
        if (insertions) summary += `, +${insertions[1]}`;
        if (deletions) summary += `, -${deletions[1]}`;
        summary += ")";
      }
      return summary;
    }

    // テスト結果
    const testMatch = content.match(/(\d+) passed.*?(\d+) failed/);
    if (testMatch) {
      return `テスト結果: ${testMatch[1]}件成功, ${testMatch[2]}件失敗`;
    }

    // ファイル操作結果
    const fileCountMatch = content.match(/(\d+) files?/);
    if (fileCountMatch && content.includes("files")) {
      return `${fileCountMatch[1]}ファイルの操作完了`;
    }

    return null;
  }

  /**
   * ツール使用を進捗メッセージとしてフォーマットする
   */
  private formatToolUse(item: {
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }): string | null {
    if (!item.name) return null;

    // TodoWriteツールの場合は特別処理
    if (item.name === "TodoWrite") {
      const todoWriteInput = item.input as {
        todos?: Array<{
          status: string;
          content: string;
        }>;
      };
      if (todoWriteInput?.todos && Array.isArray(todoWriteInput.todos)) {
        return this.formatTodoList(todoWriteInput.todos);
      }
      return null;
    }

    // その他のツール（Bash、Read、Write等）の場合
    const toolIcon = this.getToolIcon(item.name);
    const description = this.getToolDescription(item.name, item.input);

    return `${toolIcon} **${item.name}**: ${description}`;
  }

  /**
   * ツール名に対応するアイコンを取得
   */
  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      "Bash": "⚡",
      "Read": "📖",
      "Write": "✏️",
      "Edit": "🔧",
      "MultiEdit": "🔧",
      "Glob": "🔍",
      "Grep": "🔍",
      "LS": "📁",
      "Task": "🤖",
      "WebFetch": "🌐",
      "WebSearch": "🔎",
      "NotebookRead": "📓",
      "NotebookEdit": "📝",
      "TodoRead": "📋",
      "TodoWrite": "📋",
    };
    return iconMap[toolName] || "🔧";
  }

  /**
   * ツールの説明を生成
   */
  private getToolDescription(
    toolName: string,
    input?: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case "Bash": {
        const command = input?.command as string;
        const description = input?.description as string;
        if (description) {
          return description;
        }
        if (command) {
          // コマンドが長い場合は短縮
          return command.length > 50
            ? `${command.substring(0, 50)}...`
            : command;
        }
        return "コマンド実行";
      }
      case "Read":
        return `ファイル読み込み: ${input?.file_path || ""}`;
      case "Write":
        return `ファイル書き込み: ${input?.file_path || ""}`;
      case "Edit":
        return `ファイル編集: ${input?.file_path || ""}`;
      case "MultiEdit":
        return `ファイル一括編集: ${input?.file_path || ""}`;
      case "Glob":
        return `ファイル検索: ${input?.pattern || ""}`;
      case "Grep":
        return `コンテンツ検索: ${input?.pattern || ""}`;
      case "LS":
        return `ディレクトリ一覧: ${input?.path || ""}`;
      case "Task":
        return `エージェントタスク: ${input?.description || ""}`;
      case "WebFetch":
        return `Web取得: ${input?.url || ""}`;
      case "WebSearch":
        return `Web検索: ${input?.query || ""}`;
      case "NotebookRead":
        return `ノートブック読み込み: ${input?.notebook_path || ""}`;
      case "NotebookEdit":
        return `ノートブック編集: ${input?.notebook_path || ""}`;
      case "TodoRead":
        return "TODOリスト確認";
      default:
        return `${toolName}実行`;
    }
  }

  /**
   * TODOリストをチェックマーク付きリスト形式でフォーマットする
   */
  private formatTodoList(
    todos: Array<{
      status: string;
      content: string;
    }>,
  ): string {
    const todoList = todos.map((todo) => {
      const checkbox = todo.status === "completed"
        ? "✅"
        : todo.status === "in_progress"
        ? "🔄"
        : "⬜";
      return `${checkbox} ${todo.content}`;
    }).join("\n");

    return `📋 **TODOリスト更新:**\n${todoList}`;
  }

  /**
   * TODOリストの更新ログから変更後の状態をチェックマーク付きリスト形式で抽出する
   */
  private extractTodoListUpdate(textContent: string): string | null {
    try {
      // TodoWriteツールの使用を検出
      if (
        !textContent.includes('"name": "TodoWrite"') &&
        !textContent.includes("TodoWrite")
      ) {
        return null;
      }

      // JSONからtodosを抽出する正規表現
      const todoWriteMatch = textContent.match(/"todos":\s*(\[[\s\S]*?\])/);
      if (!todoWriteMatch) {
        return null;
      }

      const todosArray = JSON.parse(todoWriteMatch[1]);
      if (!Array.isArray(todosArray) || todosArray.length === 0) {
        return null;
      }

      return this.formatTodoList(todosArray);
    } catch (error) {
      // JSON解析エラーの場合は通常の処理を続行
      return null;
    }
  }

  /**
   * TodoWrite成功メッセージかどうかを判定する
   */
  private isTodoWriteSuccessMessage(content: string): boolean {
    // TodoWrite成功時の定型文パターン
    const successPatterns = [
      "Todos have been modified successfully",
      "Todo list has been updated",
      "Todos updated successfully",
      "Task list updated successfully",
    ];

    return successPatterns.some((pattern) =>
      content.includes(pattern) && content.includes("todo")
    );
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
   * Claude Codeのレートリミットメッセージかを判定する
   */
  private isClaudeCodeRateLimit(result: string): boolean {
    return result.includes("Claude AI usage limit reached|");
  }

  /**
   * レートリミットメッセージからタイムスタンプを抽出する
   */
  private extractRateLimitTimestamp(result: string): number | null {
    const match = result.match(/Claude AI usage limit reached\|(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
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
