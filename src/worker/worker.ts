import { GitRepository } from "../git-utils.ts";
import { WorkerState, WorkspaceManager } from "../workspace.ts";
import { PLaMoTranslator } from "../plamo-translator.ts";
import { MessageFormatter } from "./message-formatter.ts";
import {
  ClaudeCodeRateLimitError,
  type ClaudeStreamMessage,
  ClaudeStreamProcessor,
  JsonParseError,
  SchemaValidationError,
} from "./claude-stream-processor.ts";
import { WorkerConfiguration } from "./worker-configuration.ts";
import { SessionLogger } from "./session-logger.ts";
import {
  ClaudeCommandExecutor,
  DefaultClaudeCommandExecutor,
  DevcontainerClaudeExecutor,
} from "./claude-executor.ts";
import type { IWorker, WorkerError } from "./types.ts";
import { err, ok, Result } from "neverthrow";
import { PROCESS } from "../constants.ts";

export class Worker implements IWorker {
  private state: WorkerState;
  private claudeExecutor: ClaudeCommandExecutor;
  private readonly workspaceManager: WorkspaceManager;
  private readonly configuration: WorkerConfiguration;
  private readonly sessionLogger: SessionLogger;
  private formatter: MessageFormatter;
  private translator: PLaMoTranslator | null = null;
  private claudeProcess: Deno.ChildProcess | null = null;
  private abortController: AbortController | null = null;
  private isExecuting = false;
  private executionStartTime: number | null = null;
  private lastActivityDescription: string | null = null;

  constructor(
    state: WorkerState,
    workspaceManager: WorkspaceManager,
    claudeExecutor?: ClaudeCommandExecutor,
    verbose?: boolean,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ) {
    this.state = state;
    this.workspaceManager = workspaceManager;
    this.configuration = new WorkerConfiguration(
      verbose || false,
      appendSystemPrompt,
      translatorUrl,
    );
    this.sessionLogger = new SessionLogger(workspaceManager);
    this.formatter = new MessageFormatter(state.worktreePath || undefined);
    this.claudeExecutor = claudeExecutor ||
      new DefaultClaudeCommandExecutor(this.configuration.isVerbose());

    // 翻訳URLが設定されている場合は翻訳機能を初期化
    this.translator = PLaMoTranslator.fromEnv(translatorUrl);
    if (this.translator) {
      this.logVerbose("翻訳機能を初期化", { translatorUrl });
    }
  }

  async processMessage(
    message: string,
    onProgress: (content: string) => Promise<void> = async () => {},
    onReaction?: (emoji: string) => Promise<void>,
  ): Promise<Result<string, WorkerError>> {
    this.logVerbose("メッセージ処理開始", {
      messageLength: message.length,
      hasRepository: !!this.state.repository,
      hasWorktreePath: !!this.state.worktreePath,
      threadId: this.state.threadId,
      sessionId: this.state.sessionId,
      hasReactionCallback: !!onReaction,
    });

    // VERBOSEモードでユーザーメッセージの詳細ログ
    if (this.configuration.isVerbose()) {
      console.log(
        `[${
          new Date().toISOString()
        }] [Worker:${this.state.workerName}] ユーザーメッセージ処理詳細:`,
      );
      console.log(`  メッセージ: "${message}"`);
      console.log(`  リポジトリ: ${this.state.repository?.fullName || "なし"}`);
      console.log(`  worktreePath: ${this.state.worktreePath || "なし"}`);
      console.log(`  セッションID: ${this.state.sessionId || "なし"}`);
    }

    if (!this.state.repository || !this.state.worktreePath) {
      this.logVerbose("リポジトリまたはworktreeパスが未設定");
      return err({ type: "REPOSITORY_NOT_SET" });
    }

    // devcontainerの選択が完了していない場合は設定を促すメッセージを返す
    if (!this.isConfigurationComplete()) {
      this.logVerbose("Claude Code設定が未完了", {
        devcontainerChoiceMade: this.isConfigurationComplete(),
        useDevcontainer: this.state.devcontainerConfig.useDevcontainer,
      });

      return err({ type: "CONFIGURATION_INCOMPLETE" });
    }

    // 実行状態を設定
    this.isExecuting = true;
    this.abortController = new AbortController();
    this.executionStartTime = Date.now();
    this.lastActivityDescription = null;

    try {
      // 翻訳処理（設定されている場合のみ）
      let translatedMessage = message;
      if (this.translator) {
        this.logVerbose("メッセージの翻訳を開始");
        const translateResult = await this.translator.translate(message);

        if (translateResult.isOk()) {
          translatedMessage = translateResult.value;
          this.logVerbose("メッセージの翻訳完了", {
            originalLength: message.length,
            translatedLength: translatedMessage.length,
          });

          // VERBOSEモードで翻訳結果を表示
          if (this.configuration.isVerbose() && message !== translatedMessage) {
            console.log(
              `[${
                new Date().toISOString()
              }] [Worker:${this.state.workerName}] 翻訳結果:`,
            );
            console.log(`  元のメッセージ: "${message}"`);
            console.log(`  翻訳後: "${translatedMessage}"`);
          }
        } else {
          this.logVerbose("翻訳エラー（元のメッセージを使用）", {
            errorType: translateResult.error.type,
            error: translateResult.error,
          });
          // 翻訳に失敗した場合は元のメッセージを使用
          translatedMessage = message;
        }
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
      const claudeResult = await this.executeClaude(
        translatedMessage,
        onProgress,
      );
      if (claudeResult.isErr()) {
        // 中断エラーの場合は特別なメッセージを返す
        if (
          claudeResult.error.type === "CLAUDE_EXECUTION_FAILED" &&
          claudeResult.error.error === "中断されました"
        ) {
          // 中断が正常に完了した場合はエラーではなく正常終了として扱う
          return ok(
            "⛔ Claude Codeの実行を中断しました\n\n💡 新しい指示を送信して作業を続けることができます",
          );
        }
        return claudeResult;
      }

      const result = claudeResult.value;
      this.logVerbose("Claude実行完了", { resultLength: result.length });

      const formattedResponse = this.formatter.formatResponse(result);
      this.logVerbose("レスポンス整形完了", {
        formattedLength: formattedResponse.length,
      });

      this.logVerbose("メッセージ処理完了");
      return ok(formattedResponse);
    } catch (error) {
      if (error instanceof ClaudeCodeRateLimitError) {
        return err({
          type: "RATE_LIMIT",
          retryAt: error.retryAt,
          timestamp: error.timestamp,
        });
      }
      this.logVerbose("メッセージ処理エラー", {
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
      });
      console.error(
        `Worker ${this.state.workerName} - Claude実行エラー:`,
        error,
      );
      return err({
        type: "CLAUDE_EXECUTION_FAILED",
        error: (error as Error).message,
      });
    } finally {
      // 実行状態をリセット
      this.isExecuting = false;
      this.claudeProcess = null;
      this.abortController = null;
      this.executionStartTime = null;
      this.lastActivityDescription = null;
    }
  }

  private async executeClaude(
    prompt: string,
    onProgress: (content: string) => Promise<void>,
  ): Promise<Result<string, WorkerError>> {
    const args = this.configuration.buildClaudeArgs(
      prompt,
      this.state.sessionId,
    );

    this.logVerbose("Claudeコマンド実行", {
      args: args,
      cwd: this.state.worktreePath,
      useDevcontainer: this.state.devcontainerConfig.useDevcontainer,
    });

    this.logVerbose("ストリーミング実行開始");
    return await this.executeClaudeStreaming(args, onProgress);
  }

  private async executeClaudeStreaming(
    args: string[],
    onProgress: (content: string) => Promise<void>,
  ): Promise<Result<string, WorkerError>> {
    this.logVerbose("ストリーミング実行詳細開始");
    const decoder = new TextDecoder();
    let buffer = "";
    let result = "";
    let newSessionId: string | null = null;
    let allOutput = "";
    let processedLines = 0;

    const streamProcessor = new ClaudeStreamProcessor(
      this.formatter,
    );

    const processLine = (line: string) => {
      if (!line.trim()) return;
      processedLines++;
      this.processStreamLine(
        line,
        streamProcessor,
        onProgress,
        { result, newSessionId },
        (updates) => {
          result = updates.result || result;
          newSessionId = updates.newSessionId || newSessionId;
        },
      );
    };

    const onData = (data: Uint8Array) => {
      const { updatedBuffer, updatedAllOutput } = this.handleStreamData(
        data,
        decoder,
        buffer,
        allOutput,
        processLine,
      );
      buffer = updatedBuffer;
      allOutput = updatedAllOutput;
    };

    if (!this.state.worktreePath) {
      return err({
        type: "REPOSITORY_NOT_SET",
      });
    }

    const executionResult = await this.claudeExecutor.executeStreaming(
      args,
      this.state.worktreePath,
      onData,
      this.abortController?.signal,
      (childProcess) => {
        this.claudeProcess = childProcess;
        this.logVerbose("Claudeプロセス開始", {
          processId: childProcess.pid,
        });
      },
    );

    if (executionResult.isErr()) {
      // 中断による終了の場合
      if (
        executionResult.error.type === "STREAM_PROCESSING_ERROR" &&
        executionResult.error.error === "実行が中断されました"
      ) {
        // セッションデータを保存してから中断メッセージを返す
        await this.saveSessionData(newSessionId, allOutput);
        return err({
          type: "CLAUDE_EXECUTION_FAILED",
          error: "中断されました",
        });
      }

      const errorMessage =
        executionResult.error.type === "COMMAND_EXECUTION_FAILED"
          ? `コマンド実行失敗 (コード: ${executionResult.error.code}): ${executionResult.error.stderr}`
          : executionResult.error.error;
      return err({
        type: "CLAUDE_EXECUTION_FAILED",
        error: errorMessage,
      });
    }

    const { code, stderr } = executionResult.value;

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
      return this.handleErrorMessage(code, stderr);
    }

    // VERBOSEモードで成功時のstderrも出力（警告等の情報がある場合）
    if (this.configuration.isVerbose() && stderr.length > 0) {
      const stderrContent = new TextDecoder().decode(stderr);
      if (stderrContent.trim()) {
        console.log(
          `[${
            new Date().toISOString()
          }] [Worker:${this.state.workerName}] Claude stderr (警告等):`,
        );
        console.log(
          `  ${
            stderrContent.split("\n").map((line) => `  ${line}`).join("\n")
          }`,
        );
      }
    }

    const finalResult = await this.finalizeStreamProcessing(
      result,
      newSessionId,
      allOutput,
    );
    return finalResult;
  }

  private processStreamLine(
    line: string,
    streamProcessor: ClaudeStreamProcessor,
    onProgress: ((content: string) => Promise<void>) | undefined,
    state: { result: string; newSessionId: string | null },
    updateState: (updates: {
      result?: string;
      newSessionId?: string | null;
    }) => void,
  ): void {
    // 空行はスキップ
    if (!line.trim()) {
      return;
    }

    try {
      // 安全なJSON解析と型検証を使用
      const parsed = streamProcessor.parseJsonLine(line);
      this.logVerbose(`ストリーミング行処理: ${parsed.type}`, {
        lineNumber: undefined,
        hasSessionId: !!parsed.session_id,
      });

      // メッセージタイプごとの処理
      switch (parsed.type) {
        case "result":
          this.handleResultMessage(parsed, updateState);
          break;
        case "assistant":
          this.handleAssistantMessage(parsed, state, updateState);
          break;
      }

      // Claude Codeの実際の出力内容をDiscordに送信
      if (onProgress) {
        const outputMessage = streamProcessor.extractOutputMessage(parsed);
        if (outputMessage) {
          // 最後のアクティビティを記録
          this.lastActivityDescription = this.extractActivityDescription(
            parsed,
            outputMessage,
          );
          onProgress(this.formatter.formatResponse(outputMessage)).catch(
            console.error,
          );
        }
      }

      // セッションIDを更新
      if (parsed.session_id) {
        updateState({ newSessionId: parsed.session_id });
        this.logVerbose("新しいセッションID取得", {
          sessionId: parsed.session_id,
        });
      }
    } catch (parseError) {
      if (parseError instanceof ClaudeCodeRateLimitError) {
        throw parseError;
      }

      // エラーの種類に応じて詳細なログを出力
      if (parseError instanceof JsonParseError) {
        this.logVerbose("JSON解析エラー", {
          linePreview: parseError.line.substring(0, 100),
          cause: String(parseError.cause),
        });
        console.warn(`JSON解析エラー: ${parseError.message}`);
      } else if (parseError instanceof SchemaValidationError) {
        this.logVerbose("スキーマ検証エラー", {
          data: JSON.stringify(parseError.data).substring(0, 200),
          message: parseError.message,
        });
        console.warn(`スキーマ検証エラー: ${parseError.message}`);
      } else {
        this.logVerbose(`予期しないエラー: ${parseError}`, {
          line: line.substring(0, 100),
        });
        console.warn(`予期しないエラー: ${parseError}`);
      }

      // JSONとしてパースできなかった場合は全文を投稿
      if (onProgress && line.trim()) {
        onProgress(this.formatter.formatResponse(line)).catch(console.error);
      }
    }
  }

  private handleAssistantMessage(
    parsed: ClaudeStreamMessage,
    state: { result: string; newSessionId: string | null },
    updateState: (updates: { result?: string }) => void,
  ): void {
    if (parsed.type === "assistant" && parsed.message?.content) {
      let textResult = "";
      for (const content of parsed.message.content) {
        if (content.type === "text" && content.text) {
          textResult += content.text;
        }
      }
      if (textResult) {
        // 既存の結果に追加する形で更新
        updateState({ result: state.result + textResult });
      }
    }
  }

  private handleResultMessage(
    parsed: ClaudeStreamMessage,
    updateState: (updates: { result?: string }) => void,
  ): void {
    if (parsed.type === "result" && "result" in parsed && parsed.result) {
      updateState({ result: parsed.result });
      this.logVerbose("最終結果取得", {
        resultLength: parsed.result.length,
        subtype: parsed.subtype,
        isError: parsed.is_error,
      });

      // Claude Codeレートリミットの検出
      if (parsed.result.includes("Claude AI usage limit reached|")) {
        const match = parsed.result.match(
          /Claude AI usage limit reached\|(\d+)/,
        );
        if (match) {
          throw new ClaudeCodeRateLimitError(
            Number.parseInt(match[1], 10),
          );
        }
      }
    }
  }

  private handleErrorMessage(
    code: number,
    stderr: Uint8Array,
  ): Result<never, WorkerError> {
    const errorMessage = new TextDecoder().decode(stderr);

    // VERBOSEモードでstderrを詳細ログ出力
    if (this.configuration.isVerbose() && stderr.length > 0) {
      console.log(
        `[${
          new Date().toISOString()
        }] [Worker:${this.state.workerName}] Claude stderr:`,
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
    return err({
      type: "CLAUDE_EXECUTION_FAILED",
      error: `Claude実行失敗 (終了コード: ${code}): ${errorMessage}`,
    });
  }

  private async saveSessionData(
    newSessionId: string | null,
    allOutput: string,
  ): Promise<void> {
    // セッションIDを更新
    if (newSessionId) {
      this.state.sessionId = newSessionId;
      this.logVerbose("セッションID更新", {
        oldSessionId: this.state.sessionId,
        newSessionId,
      });

      // 非同期でWorker状態を保存
      this.saveAsync();
    }

    // 生のjsonlを保存
    if (this.state.repository?.fullName && allOutput.trim()) {
      this.logVerbose("生JSONLを保存", { outputLength: allOutput.length });
      const saveResult = await this.sessionLogger.saveRawJsonlOutput(
        this.state.repository.fullName,
        this.state.sessionId || undefined,
        allOutput,
      );
      if (saveResult.isErr()) {
        this.logVerbose("SessionLogger保存エラー", {
          error: saveResult.error,
        });
      }
    }
  }

  private handleStreamData(
    data: Uint8Array,
    decoder: TextDecoder,
    buffer: string,
    allOutput: string,
    processLine: (line: string) => void,
  ): { updatedBuffer: string; updatedAllOutput: string } {
    const chunk = decoder.decode(data, { stream: true });
    allOutput += chunk;
    buffer += chunk;

    // VERBOSEモードでstdoutを詳細ログ出力
    if (this.configuration.isVerbose() && chunk.trim()) {
      console.log(
        `[${
          new Date().toISOString()
        }] [Worker:${this.state.workerName}] Claude stdout:`,
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

    return { updatedBuffer: buffer, updatedAllOutput: allOutput };
  }

  private async finalizeStreamProcessing(
    result: string,
    newSessionId: string | null,
    allOutput: string,
  ): Promise<Result<string, WorkerError>> {
    await this.saveSessionData(newSessionId, allOutput);

    const finalResult = result.trim() ||
      "Claude からの応答を取得できませんでした。";
    this.logVerbose("ストリーミング処理完了", {
      finalResultLength: finalResult.length,
    });
    return ok(finalResult);
  }

  getName(): string {
    return this.state.workerName;
  }

  getRepository(): GitRepository | null {
    return this.state.repository
      ? {
        fullName: this.state.repository.fullName,
        org: this.state.repository.org,
        repo: this.state.repository.repo,
        localPath: this.state.repositoryLocalPath ||
          this.state.repository.fullName,
      }
      : null;
  }

  async setRepository(
    repository: GitRepository,
    localPath: string,
  ): Promise<Result<void, WorkerError>> {
    this.logVerbose("リポジトリ設定開始", {
      repositoryFullName: repository.fullName,
      localPath,
      hasThreadId: !!this.state.threadId,
      useDevcontainer: this.state.devcontainerConfig.useDevcontainer,
    });

    this.state.repository = {
      fullName: repository.fullName,
      org: repository.org,
      repo: repository.repo,
    };
    this.state.repositoryLocalPath = localPath;

    if (this.state.threadId) {
      try {
        this.logVerbose("worktree作成開始", { threadId: this.state.threadId });
        this.state.worktreePath = await this.workspaceManager.ensureWorktree(
          this.state.threadId,
          localPath,
        );
        this.logVerbose("worktree作成完了", {
          worktreePath: this.state.worktreePath,
        });

        // ThreadInfo更新は削除（WorkerStateで管理）
        this.logVerbose("worktree情報をWorkerStateで管理");
      } catch (error) {
        this.logVerbose("worktree作成失敗、localPathを使用", {
          error: (error as Error).message,
          fallbackPath: localPath,
        });
        console.error(`worktreeの作成に失敗しました: ${error}`);
        this.state.worktreePath = localPath;
      }
    } else {
      this.logVerbose("threadIdなし、localPathを直接使用");
      this.state.worktreePath = localPath;
    }

    // devcontainerが有効な場合はDevcontainerClaudeExecutorに切り替え
    if (
      this.state.devcontainerConfig.useDevcontainer && this.state.worktreePath
    ) {
      // リポジトリのPATを取得
      let ghToken: string | undefined;
      if (repository.fullName) {
        const patInfo = await this.workspaceManager.loadRepositoryPat(
          repository.fullName,
        );
        if (patInfo) {
          ghToken = patInfo.token;
          this.logVerbose("GitHub PAT取得（setRepository）", {
            repository: repository.fullName,
            hasToken: true,
          });
        }
      }

      this.logVerbose("DevcontainerClaudeExecutorに切り替え");
      this.claudeExecutor = new DevcontainerClaudeExecutor(
        this.state.worktreePath,
        this.configuration.isVerbose(),
        ghToken,
      );
    }

    // MessageFormatterのworktreePathを更新
    this.formatter = new MessageFormatter(this.state.worktreePath || undefined);

    this.state.sessionId = null;
    this.logVerbose("リポジトリ設定完了", {
      finalWorktreePath: this.state.worktreePath,
      executorType: this.state.devcontainerConfig.useDevcontainer
        ? "DevcontainerClaudeExecutor"
        : "DefaultClaudeCommandExecutor",
    });

    // Worker状態を保存
    const saveResult = await this.save();
    if (saveResult.isErr()) {
      return saveResult;
    }

    return ok(undefined);
  }

  setThreadId(threadId: string): void {
    this.state.threadId = threadId;
    // 非同期でWorker状態を保存
    this.saveAsync();
  }

  /**
   * 非同期で状態を保存し、エラーをログに記録する
   */
  private saveAsync(): void {
    this.save().then((result) => {
      if (result.isErr()) {
        this.logVerbose("Worker状態の保存に失敗", {
          error: result.error,
          threadId: this.state.threadId,
        });
        console.error("Worker状態の保存に失敗しました:", result.error);
      }
    });
  }

  /**
   * devcontainerの使用を設定する
   */
  setUseDevcontainer(useDevcontainer: boolean): void {
    this.state.devcontainerConfig.useDevcontainer = useDevcontainer;

    // devcontainerが有効で、worktreePathが設定されている場合はExecutorを切り替え
    if (useDevcontainer && this.state.worktreePath) {
      this.logVerbose("DevcontainerClaudeExecutorに切り替え（設定変更時）");
      this.claudeExecutor = new DevcontainerClaudeExecutor(
        this.state.worktreePath,
        this.configuration.isVerbose(),
      );
    } else if (!useDevcontainer && this.state.worktreePath) {
      // devcontainerを無効にした場合はDefaultに戻す
      this.logVerbose("DefaultClaudeCommandExecutorに切り替え（設定変更時）");
      this.claudeExecutor = new DefaultClaudeCommandExecutor(
        this.configuration.isVerbose(),
      );
    }

    // 非同期でWorker状態を保存
    this.saveAsync();
  }

  /**
   * devcontainerが使用されているかを取得
   */
  isUsingDevcontainer(): boolean {
    return this.state.devcontainerConfig.useDevcontainer;
  }

  /**
   * devcontainerが起動済みかを取得
   */
  isDevcontainerStarted(): boolean {
    return this.state.devcontainerConfig.isStarted;
  }

  /**
   * fallback devcontainerの使用を設定する
   */
  setUseFallbackDevcontainer(useFallback: boolean): void {
    this.state.devcontainerConfig.useFallbackDevcontainer = useFallback;
    this.logVerbose("fallback devcontainer設定変更", {
      useFallbackDevcontainer: useFallback,
    });

    // 非同期でWorker状態を保存
    this.saveAsync();
  }

  /**
   * fallback devcontainerが使用されているかを取得
   */
  isUsingFallbackDevcontainer(): boolean {
    return this.state.devcontainerConfig.useFallbackDevcontainer;
  }

  /**
   * verboseモードを設定する
   */
  setVerbose(verbose: boolean): void {
    this.configuration.setVerbose(verbose);
  }

  /**
   * verboseモードが有効かを取得
   */
  isVerbose(): boolean {
    return this.configuration.isVerbose();
  }

  /**
   * 設定が完了しているかを確認
   */
  isConfigurationComplete(): boolean {
    // devcontainerの選択が済んでいればtrue
    return this.state.devcontainerConfig.useDevcontainer !== undefined;
  }

  /**
   * 現在の設定状態を取得
   */
  getConfigurationStatus(): {
    devcontainerChoiceMade: boolean;
    useDevcontainer: boolean;
  } {
    return {
      devcontainerChoiceMade:
        this.state.devcontainerConfig.useDevcontainer !== undefined,
      useDevcontainer: this.state.devcontainerConfig.useDevcontainer,
    };
  }

  /**
   * verboseログを出力する
   */
  private logVerbose(
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.configuration.logVerbose(this.state.workerName, message, metadata);
  }

  /**
   * ストリームメッセージから最後のアクティビティの説明を抽出
   */
  private extractActivityDescription(
    parsed: ClaudeStreamMessage,
    outputMessage: string,
  ): string {
    // ツール使用の場合
    if (parsed.type === "assistant" && parsed.message?.content) {
      for (const item of parsed.message.content) {
        if (item.type === "tool_use" && item.name) {
          return `ツール使用: ${item.name}`;
        }
      }
    }

    // ツール結果の場合
    if (parsed.type === "user" && parsed.message?.content) {
      for (const item of parsed.message.content) {
        if (item.type === "tool_result") {
          return "ツール実行結果を処理";
        }
      }
    }

    // その他のメッセージの場合、最初の50文字を使用
    if (outputMessage) {
      const preview = outputMessage.substring(0, 50);
      return preview.length < outputMessage.length ? `${preview}...` : preview;
    }

    return "アクティビティ実行中";
  }

  /**
   * devcontainerを起動する
   */
  async startDevcontainer(
    onProgress?: (message: string) => Promise<void>,
  ): Promise<
    { success: boolean; containerId?: string; error?: string }
  > {
    if (!this.state.repository || !this.state.worktreePath) {
      return {
        success: false,
        error: "リポジトリが設定されていません",
      };
    }

    // リポジトリのPATを取得
    let ghToken: string | undefined;
    if (this.state.repository.fullName) {
      const patInfo = await this.workspaceManager.loadRepositoryPat(
        this.state.repository.fullName,
      );
      if (patInfo) {
        ghToken = patInfo.token;
        this.logVerbose("GitHub PAT取得", {
          repository: this.state.repository.fullName,
          hasToken: true,
        });
      }
    }

    const { startDevcontainer } = await import("../devcontainer.ts");
    const result = await startDevcontainer(
      this.state.worktreePath,
      onProgress,
      ghToken,
    );

    if (result.isOk()) {
      this.state.devcontainerConfig.isStarted = true;
      this.state.devcontainerConfig.containerId = result.value.containerId;

      // DevcontainerClaudeExecutorに切り替え
      if (
        this.state.devcontainerConfig.useDevcontainer && this.state.worktreePath
      ) {
        this.logVerbose(
          "DevcontainerClaudeExecutorに切り替え（startDevcontainer成功後）",
        );
        this.claudeExecutor = new DevcontainerClaudeExecutor(
          this.state.worktreePath,
          this.configuration.isVerbose(),
          ghToken,
        );
      }

      // Worker状態を保存
      const saveResult = await this.save();
      if (saveResult.isErr()) {
        const errorType = saveResult.error.type;
        const errorDetail = errorType === "WORKSPACE_ERROR"
          ? saveResult.error.error
          : errorType;
        return {
          success: false,
          error: `Worker状態の保存に失敗: ${errorDetail}`,
        };
      }

      return {
        success: true,
        containerId: result.value.containerId,
      };
    } else {
      const errorMessage = result.error.type === "CONTAINER_START_FAILED"
        ? result.error.error
        : `Devcontainer error: ${result.error.type}`;
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * fallback devcontainer起動後にClaudeExecutorを更新する
   */
  async updateClaudeExecutorForDevcontainer(): Promise<void> {
    if (
      !this.state.devcontainerConfig.useDevcontainer || !this.state.worktreePath
    ) {
      this.logVerbose("DevcontainerClaudeExecutor切り替えスキップ", {
        useDevcontainer: this.state.devcontainerConfig.useDevcontainer,
        hasWorktreePath: !!this.state.worktreePath,
      });
      return;
    }

    // リポジトリのPATを取得
    let ghToken: string | undefined;
    if (this.state.repository?.fullName) {
      const patInfo = await this.workspaceManager.loadRepositoryPat(
        this.state.repository.fullName,
      );
      if (patInfo) {
        ghToken = patInfo.token;
        this.logVerbose(
          "GitHub PAT取得（updateClaudeExecutorForDevcontainer）",
          {
            repository: this.state.repository.fullName,
            hasToken: true,
          },
        );
      }
    }

    this.logVerbose(
      "DevcontainerClaudeExecutorに切り替え（fallback devcontainer起動後）",
    );
    const { DevcontainerClaudeExecutor } = await import("./claude-executor.ts");
    this.claudeExecutor = new DevcontainerClaudeExecutor(
      this.state.worktreePath,
      this.configuration.isVerbose(),
      ghToken,
    );

    // devcontainerが起動済みとしてマーク
    this.state.devcontainerConfig.isStarted = true;

    // Worker状態を保存
    await this.save();
  }

  /**
   * Worker状態を永続化する
   */
  async save(): Promise<Result<void, WorkerError>> {
    if (!this.state.threadId) {
      this.logVerbose("Worker状態保存スキップ: threadId未設定");
      return ok(undefined);
    }

    try {
      this.state.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveWorkerState(this.state);
      this.logVerbose("Worker状態を永続化", {
        threadId: this.state.threadId,
        workerName: this.state.workerName,
      });
      return ok(undefined);
    } catch (error) {
      console.error("Worker状態の保存に失敗しました:", error);
      return err({
        type: "WORKSPACE_ERROR",
        operation: "saveWorkerState",
        error: (error as Error).message,
      });
    }
  }

  /**
   * Claude Code実行を中断する
   */
  async stopExecution(
    onProgress?: (content: string) => Promise<void>,
  ): Promise<boolean> {
    // 実行中でない場合は早期リターン
    if (!this.isExecuting) {
      this.logVerbose("実行中ではないため中断スキップ", {
        isExecuting: this.isExecuting,
      });
      return false;
    }

    // プロセスハンドルがない場合も早期リターン
    if (!this.claudeProcess) {
      this.logVerbose("プロセスハンドルがないため中断スキップ", {
        hasClaudeProcess: false,
      });
      return false;
    }

    this.logVerbose("Claude Code実行の中断開始", {
      workerName: this.state.workerName,
      sessionId: this.state.sessionId,
    });

    // 中断イベントをセッションログに記録
    const executionTime = this.executionStartTime
      ? Date.now() - this.executionStartTime
      : undefined;

    if (
      this.state.repository?.fullName &&
      this.state.sessionId
    ) {
      await this.sessionLogger.saveInterruptionEvent(
        this.state.repository.fullName,
        this.state.sessionId,
        {
          reason: "user_requested",
          executionTime,
          lastActivity: this.lastActivityDescription || undefined,
        },
      );
    }

    try {
      // まずAbortControllerで中断シグナルを送信
      if (this.abortController) {
        this.abortController.abort();
        this.logVerbose("AbortController.abort()実行");
      }

      // プロセスにSIGTERMを送信
      const processToKill = this.claudeProcess; // プロセス参照を保持
      let sigTermSent = false;

      try {
        processToKill.kill("SIGTERM");
        sigTermSent = true;
        this.logVerbose("SIGTERMシグナル送信");
      } catch (error) {
        this.logVerbose(
          "SIGTERM送信エラー（プロセスが既に終了している可能性）",
          {
            error: (error as Error).message,
          },
        );
      }

      // 5秒待機してプロセスが終了するか確認
      let forcefullyKilled = false;
      let timeoutId: number | undefined;

      if (sigTermSent) {
        timeoutId = setTimeout(() => {
          // プロセスがまだ存在する場合のみSIGKILLを送信
          if (this.claudeProcess === processToKill) {
            try {
              processToKill.kill("SIGKILL");
              forcefullyKilled = true;
              this.logVerbose("SIGKILLシグナル送信（強制終了）");
            } catch (error) {
              this.logVerbose("SIGKILL送信エラー", {
                error: (error as Error).message,
              });
            }
          }
        }, PROCESS.TERMINATION_TIMEOUT_MS);

        // プロセスの終了を待機
        try {
          await processToKill.status;
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          this.logVerbose("プロセス終了確認");
        } catch (error) {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          this.logVerbose("プロセス終了待機エラー", {
            error: (error as Error).message,
          });
        }
      }

      // 中断メッセージを送信
      if (onProgress) {
        if (forcefullyKilled) {
          await onProgress("⚠️ Claude Codeの実行を強制終了しました");
        } else {
          await onProgress("⛔ Claude Codeの実行を中断しました");
        }
        await onProgress("💡 新しい指示を送信して作業を続けることができます");
      }

      return true;
    } catch (error) {
      this.logVerbose("中断処理エラー", {
        error: (error as Error).message,
      });

      // エラーメッセージを送信
      if (onProgress) {
        const errorMessage = error instanceof Error
          ? error.message
          : "不明なエラー";
        await onProgress(
          `❌ 中断処理中にエラーが発生しました: ${errorMessage}`,
        );
        await onProgress("💡 新しい指示を送信して作業を続けることができます");
      }

      return false;
    } finally {
      // クリーンアップ
      this.claudeProcess = null;
      this.abortController = null;
      this.isExecuting = false;
      this.logVerbose("プロセス参照クリーンアップ完了");
    }
  }

  /**
   * Worker状態を復元する（静的メソッド）
   */
  static async fromState(
    workerState: WorkerState,
    workspaceManager: WorkspaceManager,
    verbose?: boolean,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ): Promise<Worker> {
    const worker = new Worker(
      workerState,
      workspaceManager,
      undefined,
      verbose,
      appendSystemPrompt,
      translatorUrl,
    );

    // devcontainerが使用されている場合はExecutorを切り替え
    if (
      workerState.devcontainerConfig.useDevcontainer &&
      workerState.worktreePath &&
      workerState.devcontainerConfig.isStarted
    ) {
      // リポジトリのPATを取得
      let ghToken: string | undefined;
      if (workerState.repository?.fullName) {
        const patInfo = await workspaceManager.loadRepositoryPat(
          workerState.repository.fullName,
        );
        if (patInfo) {
          ghToken = patInfo.token;
        }
      }

      worker.claudeExecutor = new DevcontainerClaudeExecutor(
        workerState.worktreePath,
        verbose || false,
        ghToken,
      );
    }

    return worker;
  }
}
