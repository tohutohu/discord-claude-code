import { GitRepository } from "./git-utils.ts";
import { SessionLog, WorkspaceManager } from "./workspace.ts";

/**
 * Claude Codeのレートリミットエラーを表すカスタムエラークラス
 * Claude Codeが利用制限に達した際にスローされます。
 * タイムスタンプ情報を保持し、レートリミットの処理に使用されます。
 */
export class ClaudeCodeRateLimitError extends Error {
  /** レートリミットが発生したUnixタイムスタンプ（秒） */
  public readonly timestamp: number;

  /**
   * ClaudeCodeRateLimitErrorのインスタンスを作成する
   * @param timestamp - レートリミットが発生したUnixタイムスタンプ（秒）
   */
  constructor(timestamp: number) {
    super(`Claude AI usage limit reached|${timestamp}`);
    this.name = "ClaudeCodeRateLimitError";
    this.timestamp = timestamp;
  }
}

/**
 * stdoutとstderrストリームを並行して処理する
 *
 * プロセスの標準出力と標準エラー出力を同時に読み取ります。
 * stdoutデータはリアルタイムでonDataコールバックに渡され、
 * stderrは全て蓄積されて最後に返されます。
 *
 * Claude Codeレートリミットエラーは特別に処理してそのまま再スローします。
 * その他のエラーはログに記録して処理を継続します。
 *
 * @param stdout - 標準出力ストリーム
 * @param stderr - 標準エラー出力ストリーム
 * @param onData - stdoutデータをリアルタイムで処理するコールバック関数
 * @returns stderrの全内容をUint8Arrayとして返す
 * @throws {ClaudeCodeRateLimitError} Claude Codeの利用制限に達した場合
 *
 * @example
 * ```typescript
 * const { stdout, stderr } = process;
 * const stderrContent = await processStreams(
 *   stdout,
 *   stderr,
 *   (data) => console.log(new TextDecoder().decode(data))
 * );
 * ```
 */
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
      if (error instanceof ClaudeCodeRateLimitError) {
        throw error; // レートリミットエラーはそのまま投げる
      }

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

/**
 * Claude Codeのストリーミングメッセージ型定義
 * Claude Code SDKのメッセージスキーマに基づいています。
 * @see https://docs.anthropic.com/en/docs/claude-code/sdk#message-schema
 *
 * assistantメッセージ: Claude AIからの応答
 * userメッセージ: ツール実行結果などのユーザー側メッセージ
 * resultメッセージ: セッションの最終結果
 * systemメッセージ: システム初期化情報
 * errorメッセージ: エラー情報
 */
type ClaudeStreamMessage =
  | {
    type: "assistant";
    message: {
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
      }>;
      stop_reason: string;
      usage?: {
        input_tokens: number;
        output_tokens: number;
      };
    };
    session_id: string;
  }
  | {
    type: "user";
    message: {
      id: string;
      type: string;
      role: string;
      model: string;
      content: Array<{
        type: string;
        text?: string;
        tool_use_id?: string;
        content?: string | Array<{ type: string; text?: string }>;
        is_error?: boolean;
      }>;
      stop_reason: string;
      usage?: {
        input_tokens: number;
        output_tokens: number;
      };
    };
    session_id: string;
  }
  | {
    type: "result";
    subtype: "success" | "error_max_turns";
    cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
    is_error: boolean;
    num_turns?: number;
    result?: string;
    session_id: string;
  }
  | {
    type: "system";
    subtype: "init";
    session_id: string;
    tools?: string[];
    mcp_servers?: {
      name: string;
      status: string;
    }[];
  }
  | {
    type: "error";
    result?: string;
    is_error: boolean;
    session_id?: string;
  };

/**
 * Claudeコマンド実行戦略のインターフェース
 * Claude CLIの実行方法を抽象化し、異なる実行環境（ローカル、devcontainer等）を
 * サポートできるようにします。
 */
export interface ClaudeCommandExecutor {
  /**
   * Claudeコマンドをストリーミング形式で実行する
   * @param args - Claudeコマンドの引数配列
   * @param cwd - 作業ディレクトリ
   * @param onData - stdoutデータを受け取るコールバック関数
   * @returns 実行結果（終了コードとstderr内容）
   */
  executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }>;
}

/**
 * デフォルトのClaudeコマンド実行戦略
 * ローカル環境でClaude CLIを直接実行します。
 */
class DefaultClaudeCommandExecutor implements ClaudeCommandExecutor {
  /** 詳細ログ出力フラグ */
  private readonly verbose: boolean;

  /**
   * DefaultClaudeCommandExecutorのインスタンスを作成する
   * @param verbose - 詳細ログを出力するかどうか（デフォルト: false）
   */
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

/**
 * Devcontainer環境でのClaudeコマンド実行戦略
 * devcontainer内でClaude CLIを実行します。
 * GitHubトークンが設定されている場合は、コンテナ内に渡します。
 */
export class DevcontainerClaudeExecutor implements ClaudeCommandExecutor {
  /** リポジトリのパス */
  private readonly repositoryPath: string;
  /** 詳細ログ出力フラグ */
  private readonly verbose: boolean;
  /** GitHubトークン（オプション） */
  private readonly ghToken?: string;

  /**
   * DevcontainerClaudeExecutorのインスタンスを作成する
   * @param repositoryPath - リポジトリのパス
   * @param verbose - 詳細ログを出力するかどうか（デフォルト: false）
   * @param ghToken - GitHubトークン（オプション）
   */
  constructor(
    repositoryPath: string,
    verbose: boolean = false,
    ghToken?: string,
  ) {
    this.repositoryPath = repositoryPath;
    this.verbose = verbose;
    this.ghToken = ghToken;
  }

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const argsWithDefaults = [
      "exec",
      "--workspace-folder",
      this.repositoryPath,
      "claude",
      ...args,
    ];
    // VERBOSEモードでdevcontainerコマンド詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DevcontainerClaudeExecutor] devcontainerコマンド実行:`,
      );
      console.log(`  リポジトリパス: ${this.repositoryPath}`);
      console.log(`  引数: ${JSON.stringify(argsWithDefaults)}`);
    }

    // devcontainer内でclaudeコマンドをストリーミング実行
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    };

    // GitHub PATが提供されている場合は環境変数に設定
    if (this.ghToken) {
      env.GH_TOKEN = this.ghToken;
      env.GITHUB_TOKEN = this.ghToken; // 互換性のため両方設定
    }

    const devcontainerCommand = new Deno.Command("devcontainer", {
      args: argsWithDefaults,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      cwd: this.repositoryPath,
      env,
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

/**
 * Workerのインターフェース
 * 1つのDiscordスレッドを担当し、Claude Codeを実行して応答を生成する
 * Workerの公開インターフェースを定義します。
 */
export interface IWorker {
  /**
   * ユーザーからのメッセージを処理する
   * @param message - 処理するメッセージ内容
   * @param onProgress - 進捗通知コールバック（オプション）
   * @param onReaction - リアクション追加コールバック（オプション）
   * @returns Claude Codeの実行結果または設定エラーメッセージ
   * @throws {ClaudeCodeRateLimitError} Claude Codeのレートリミットエラー
   */
  processMessage(
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
  ): Promise<string>;

  /**
   * Workerの名前を取得する
   * @returns Worker名
   */
  getName(): string;

  /**
   * 設定されているリポジトリ情報を取得する
   * @returns リポジトリ情報、未設定の場合はnull
   */
  getRepository(): GitRepository | null;

  /**
   * リポジトリ情報を設定する
   * @param repository - リポジトリ情報
   * @param localPath - ローカルパス
   * @returns 設定処理の完了を待つPromise
   */
  setRepository(repository: GitRepository, localPath: string): Promise<void>;

  /**
   * スレッドIDを設定する
   * @param threadId - DiscordスレッドID
   */
  setThreadId(threadId: string): void;

  /**
   * devcontainerを使用しているかどうかを取得する
   * @returns devcontainer使用フラグ
   */
  isUsingDevcontainer(): boolean;
}

/**
 * Workerクラス - Discordスレッドを担当し、Claude Codeを実行する
 *
 * 主な責務:
 * - 1つのDiscordスレッドのメッセージを処理
 * - リポジトリのworktree管理
 * - Claude Codeの実行とストリーミング処理
 * - devcontainer環境の起動と管理
 * - セッションログの記録
 * - レートリミットエラーの検出と伝搬
 */
export class Worker implements IWorker {
  /** Workerの名前 */
  private readonly name: string;
  /** 担当しているリポジトリ情報 */
  private repository: GitRepository | null = null;
  /** worktreeのパス */
  private worktreePath: string | null = null;
  /** 現在のClaudeセッションID */
  private sessionId: string | null = null;
  /** 担当しているDiscordスレッドID */
  private threadId: string | null = null;
  /** Claudeコマンド実行戦略 */
  private claudeExecutor: ClaudeCommandExecutor;
  /** 作業ディレクトリとデータ永続化を管理するマネージャー */
  private readonly workspaceManager: WorkspaceManager;
  /** devcontainer使用フラグ */
  private useDevcontainer: boolean = false;
  /** devcontainer起動済みフラグ */
  private devcontainerStarted: boolean = false;
  /** 詳細ログ出力フラグ */
  private verbose: boolean = false;
  /** devcontainer選択完了フラグ */
  private devcontainerChoiceMade: boolean = false;
  /** Claude実行時に追加するシステムプロンプト */
  private appendSystemPrompt?: string;
  /** fallback devcontainer使用フラグ */
  private useFallbackDevcontainer: boolean = false;

  /**
   * Workerのインスタンスを作成する
   * @param name - Workerの名前
   * @param workspaceManager - 作業ディレクトリとデータ永続化を管理するマネージャー
   * @param claudeExecutor - Claudeコマンド実行戦略（オプション）
   * @param verbose - 詳細ログを出力するかどうか（オプション）
   * @param appendSystemPrompt - Claude実行時に追加するシステムプロンプト（オプション）
   */
  constructor(
    name: string,
    workspaceManager: WorkspaceManager,
    claudeExecutor?: ClaudeCommandExecutor,
    verbose?: boolean,
    appendSystemPrompt?: string,
  ) {
    this.name = name;
    this.workspaceManager = workspaceManager;
    this.verbose = verbose || false;
    this.claudeExecutor = claudeExecutor ||
      new DefaultClaudeCommandExecutor(this.verbose);
    this.appendSystemPrompt = appendSystemPrompt;
  }

  /**
   * ユーザーからのメッセージを処理する
   * リポジトリとdevcontainerの設定確認後、Claude Codeを実行してレスポンスを生成します。
   * 進捗通知とリアクションのコールバックをサポートします。
   *
   * @param message - 処理するメッセージ内容
   * @param onProgress - 進捗通知コールバック（デフォルト: 空関数）
   * @param onReaction - リアクション追加コールバック（オプション）
   * @returns Claude Codeの実行結果または設定エラーメッセージ
   * @throws {ClaudeCodeRateLimitError} Claude Codeのレートリミットエラー
   */
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

    // devcontainerの選択が完了していない場合は設定を促すメッセージを返す
    if (!this.devcontainerChoiceMade) {
      this.logVerbose("Claude Code設定が未完了", {
        devcontainerChoiceMade: this.devcontainerChoiceMade,
        useDevcontainer: this.useDevcontainer,
      });

      let message = "⚠️ **Claude Code実行環境の設定が必要です**\n\n";
      message += "**実行環境を選択してください:**\n";
      message +=
        "• `/config devcontainer on` - devcontainer環境で実行（推奨）\n";
      message += "• `/config devcontainer off` - ホスト環境で実行\n\n";
      message += "設定が完了すると、Claude Codeを実行できるようになります。";

      return message;
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
      if (error instanceof ClaudeCodeRateLimitError) {
        throw error; // レートリミットエラーはそのまま投げる
      }
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

  /**
   * Claude Codeコマンドを実行する
   * プロンプトを渡してClaude Codeを実行し、ストリーミング形式で結果を取得します。
   *
   * @param prompt - Claude Codeに渡すプロンプト
   * @param onProgress - 進捗通知コールバック
   * @returns Claude Codeの実行結果
   * @private
   */
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

    // 常に権限チェックをスキップ
    args.push("--dangerously-skip-permissions");
    this.logVerbose("権限チェックスキップを使用（デフォルト）");

    // append-system-promptが設定されている場合
    if (this.appendSystemPrompt) {
      args.push("--append-system-prompt", this.appendSystemPrompt);
      this.logVerbose("追加システムプロンプトを使用", {
        appendSystemPromptLength: this.appendSystemPrompt.length,
      });
    }

    this.logVerbose("Claudeコマンド実行", {
      args: args,
      cwd: this.worktreePath,
      useDevcontainer: this.useDevcontainer,
    });

    this.logVerbose("ストリーミング実行開始");
    return await this.executeClaudeStreaming(args, onProgress);
  }

  /**
   * Claude Codeをストリーミング形式で実行する
   * JSON形式の出力を1行ずつ処理し、進捗をリアルタイムで通知します。
   * セッションIDの管理、レートリミット検出、生JSONLの保存も行います。
   *
   * @param args - Claude Codeコマンドの引数
   * @param onProgress - 進捗通知コールバック
   * @returns Claude Codeの最終実行結果
   * @throws {ClaudeCodeRateLimitError} Claude Codeのレートリミットエラー
   * @throws {Error} Claude実行失敗エラー
   * @private
   */
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
          hasMessage:
            !!(parsed.type === "assistant" || parsed.type === "user") &&
            !!parsed.message,
        });

        // 最終結果を取得
        if (parsed.type === "result") {
          if ("result" in parsed && parsed.result) {
            result = parsed.result;
            this.logVerbose("最終結果取得", {
              resultLength: result.length,
              subtype: parsed.subtype,
              isError: parsed.is_error,
              cost: parsed.cost_usd,
              duration: parsed.duration_ms,
              turns: parsed.num_turns,
            });

            // Claude Codeレートリミットの検出
            if (this.isClaudeCodeRateLimit(parsed.result)) {
              const timestamp = this.extractRateLimitTimestamp(parsed.result);
              if (timestamp) {
                throw new ClaudeCodeRateLimitError(timestamp);
              }
            }
          }

          // メタデータをログに記録（オプション）
          if (this.verbose && "subtype" in parsed) {
            console.log(
              `[${
                new Date().toISOString()
              }] [Worker:${this.name}] Claude実行完了:`,
              {
                subtype: parsed.subtype,
                cost_usd: parsed.cost_usd,
                duration_ms: parsed.duration_ms,
                api_duration_ms: parsed.duration_api_ms,
                turns: parsed.num_turns,
                is_error: parsed.is_error,
              },
            );
          }
        }

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
      } catch (parseError) {
        if (parseError instanceof ClaudeCodeRateLimitError) {
          throw parseError;
        }
        this.logVerbose(`JSON解析エラー: ${parseError}`, {
          line: line.substring(0, 100),
        });
        console.warn(`JSON解析エラー: ${parseError}, 行: ${line}`);

        // JSONとしてパースできなかった場合は全文を投稿
        if (onProgress && line.trim()) {
          onProgress(this.formatResponse(line)).catch(console.error);
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

  /**
   * Claude Codeの生のJSONL出力を保存する
   * デバッグや監査目的で、セッションの全出力を保存します。
   *
   * @param output - 保存するJSONL形式の出力
   * @returns 保存処理の完了を待つPromise
   * @private
   */
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

  /**
   * Claude Codeのレスポンスをフォーマットする
   * Discordの文字数制限（2000文字）に収まるように調整し、ANSIエスケープコードを除去します。
   *
   * @param response - フォーマット対象のレスポンス
   * @returns フォーマット済みのレスポンス
   * @private
   */
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

  /**
   * ANSIエスケープコードを除去する
   * ターミナル制御用のANSIエスケープシーケンスをテキストから除去します。
   *
   * @param text - 処理対象のテキスト
   * @returns ANSIコードを除去したテキスト
   * @private
   */
  private stripAnsiCodes(text: string): string {
    // ANSIエスケープシーケンスを除去する正規表現
    // deno-lint-ignore no-control-regex
    return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
  }

  /**
   * Workerの名前を取得する
   * @returns Worker名
   */
  getName(): string {
    return this.name;
  }

  /**
   * 設定されているリポジトリ情報を取得する
   * @returns リポジトリ情報、未設定の場合はnull
   */
  getRepository(): GitRepository | null {
    return this.repository;
  }

  /**
   * リポジトリ情報を設定する
   * worktreeの作成とスレッド情報の更新も行います。
   *
   * @param repository - リポジトリ情報
   * @param localPath - ローカルパス
   * @returns 設定処理の完了を待つPromise
   */
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
        this.worktreePath = await this.workspaceManager.ensureWorktree(
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
        this.worktreePath,
        this.verbose,
        ghToken,
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

  /**
   * スレッドIDを設定する
   * @param threadId - DiscordスレッドID
   */
  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }

  /**
   * devcontainerの使用を設定する
   *
   * devcontainerの有効/無効を切り替えます。
   * 設定変更時には、現在のworktreePathに基づいて適切なClaude実行戦略
   * （DevcontainerClaudeExecutorまたはDefaultClaudeCommandExecutor）に切り替えます。
   * この設定により、devcontainerChoiceMadeフラグもtrueに設定されます。
   *
   * @param useDevcontainer - devcontainerを使用するかどうか
   *
   * @example
   * ```typescript
   * // devcontainerを有効にする
   * worker.setUseDevcontainer(true);
   *
   * // devcontainerを無効にする（ホスト環境で実行）
   * worker.setUseDevcontainer(false);
   * ```
   */
  setUseDevcontainer(useDevcontainer: boolean): void {
    this.useDevcontainer = useDevcontainer;
    this.devcontainerChoiceMade = true;

    // devcontainerが有効で、worktreePathが設定されている場合はExecutorを切り替え
    if (this.useDevcontainer && this.worktreePath) {
      this.logVerbose("DevcontainerClaudeExecutorに切り替え（設定変更時）");
      this.claudeExecutor = new DevcontainerClaudeExecutor(
        this.worktreePath,
        this.verbose,
      );
    } else if (!this.useDevcontainer && this.worktreePath) {
      // devcontainerを無効にした場合はDefaultに戻す
      this.logVerbose("DefaultClaudeCommandExecutorに切り替え（設定変更時）");
      this.claudeExecutor = new DefaultClaudeCommandExecutor(this.verbose);
    }
  }

  /**
   * devcontainerが使用されているかを取得する
   *
   * 現在のWorkerがdevcontainer環境で実行されるように設定されているかを返します。
   * この設定は`setUseDevcontainer()`メソッドで変更できます。
   *
   * @returns devcontainerを使用する設定になっている場合はtrue、そうでない場合はfalse
   *
   * @example
   * ```typescript
   * if (worker.isUsingDevcontainer()) {
   *   console.log("devcontainer環境で実行中");
   * } else {
   *   console.log("ホスト環境で実行中");
   * }
   * ```
   */
  isUsingDevcontainer(): boolean {
    return this.useDevcontainer;
  }

  /**
   * devcontainerが起動済みかを取得する
   *
   * devcontainerが実際に起動されているかどうかを返します。
   * `setUseDevcontainer(true)`で設定しても、実際にコンテナが起動されるまでは
   * このメソッドはfalseを返します。
   *
   * @returns devcontainerが起動済みの場合はtrue、そうでない場合はfalse
   *
   * @example
   * ```typescript
   * if (worker.isDevcontainerStarted()) {
   *   console.log("devcontainerは起動済み");
   * } else {
   *   console.log("devcontainerは未起動");
   * }
   * ```
   */
  isDevcontainerStarted(): boolean {
    return this.devcontainerStarted;
  }

  /**
   * fallback devcontainerの使用を設定する
   *
   * プロジェクトに.devcontainer設定がない場合に使用する
   * フォールバック用のdevcontainer設定の使用を切り替えます。
   * これにより、どのプロジェクトでもdevcontainer環境を利用できます。
   *
   * @param useFallback - fallback devcontainerを使用するかどうか
   *
   * @example
   * ```typescript
   * // .devcontainer設定がないプロジェクトでfallbackを使用
   * worker.setUseFallbackDevcontainer(true);
   * ```
   */
  setUseFallbackDevcontainer(useFallback: boolean): void {
    this.useFallbackDevcontainer = useFallback;
    this.logVerbose("fallback devcontainer設定変更", {
      useFallbackDevcontainer: useFallback,
    });
  }

  /**
   * fallback devcontainerが使用されているかを取得する
   *
   * 現在のWorkerがfallback devcontainer設定を使用するように
   * 設定されているかを返します。
   *
   * @returns fallback devcontainerを使用する設定の場合はtrue、そうでない場合はfalse
   *
   * @example
   * ```typescript
   * if (worker.isUsingFallbackDevcontainer()) {
   *   console.log("fallback devcontainer設定を使用中");
   * }
   * ```
   */
  isUsingFallbackDevcontainer(): boolean {
    return this.useFallbackDevcontainer;
  }

  /**
   * verboseモードを設定する
   *
   * 詳細なデバッグログの出力を有効/無効にします。
   * verboseモードが有効な場合、Claudeコマンドの実行詳細、
   * ストリーミング処理の進捗、エラーの詳細などが出力されます。
   *
   * @param verbose - 詳細ログを出力するかどうか
   *
   * @example
   * ```typescript
   * // デバッグ情報を出力する
   * worker.setVerbose(true);
   *
   * // 通常モードに戻す
   * worker.setVerbose(false);
   * ```
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * verboseモードが有効かを取得する
   *
   * 現在のWorkerが詳細ログを出力するように設定されているかを返します。
   *
   * @returns verboseモードが有効な場合はtrue、無効な場合はfalse
   *
   * @example
   * ```typescript
   * if (worker.isVerbose()) {
   *   console.log("詳細ログモードが有効");
   * }
   * ```
   */
  isVerbose(): boolean {
    return this.verbose;
  }

  /**
   * 設定が完了しているかを確認する
   *
   * devcontainerの使用に関する設定が完了しているかを確認します。
   * ユーザーが`/config devcontainer on/off`コマンドで選択を行うまでは
   * falseを返し、Claude Codeの実行はブロックされます。
   *
   * @returns devcontainerの設定が完了している場合はtrue、未完了の場合はfalse
   *
   * @example
   * ```typescript
   * if (!worker.isConfigurationComplete()) {
   *   return "設定が必要です: /config devcontainer on または off";
   * }
   * ```
   */
  isConfigurationComplete(): boolean {
    return this.devcontainerChoiceMade;
  }

  /**
   * 現在の設定状態を取得する
   *
   * Workerの現在のdevcontainer設定状態を取得します。
   * 設定が完了しているか、devcontainerを使用する設定になっているかを
   * 一度に確認できます。
   *
   * @returns 設定状態を表すオブジェクト
   * @returns returns.devcontainerChoiceMade - devcontainerの選択が完了しているか
   * @returns returns.useDevcontainer - devcontainerを使用する設定になっているか
   *
   * @example
   * ```typescript
   * const status = worker.getConfigurationStatus();
   * if (status.devcontainerChoiceMade) {
   *   if (status.useDevcontainer) {
   *     console.log("devcontainer環境を使用");
   *   } else {
   *     console.log("ホスト環境を使用");
   *   }
   * } else {
   *   console.log("設定が未完了");
   * }
   * ```
   */
  getConfigurationStatus(): {
    devcontainerChoiceMade: boolean;
    useDevcontainer: boolean;
  } {
    return {
      devcontainerChoiceMade: this.devcontainerChoiceMade,
      useDevcontainer: this.useDevcontainer,
    };
  }

  /**
   * JSONL行からClaude Codeの実際の出力メッセージを抽出する
   * assistant、user、system、resultメッセージから適切な内容を抽出します。
   *
   * @param parsed - パースされたClaudeストリームメッセージ
   * @returns 抽出されたメッセージ、またはnull
   * @private
   */
  private extractOutputMessage(parsed: ClaudeStreamMessage): string | null {
    // assistantメッセージの場合
    if (
      parsed.type === "assistant" && "message" in parsed &&
      parsed.message?.content
    ) {
      return this.extractAssistantMessage(parsed.message.content);
    }

    // userメッセージの場合（tool_result等）
    if (
      parsed.type === "user" && "message" in parsed && parsed.message?.content
    ) {
      return this.extractUserMessage(parsed.message.content);
    }

    // systemメッセージの場合（初期化情報）
    if (parsed.type === "system" && parsed.subtype === "init") {
      const tools = parsed.tools?.join(", ") || "なし";
      const mcpServers = parsed.mcp_servers?.map((s) =>
        `${s.name}(${s.status})`
      ).join(", ") || "なし";
      return `🔧 **システム初期化:** ツール: ${tools}, MCPサーバー: ${mcpServers}`;
    }

    // resultメッセージは最終結果として別途処理されるため、ここでは返さない
    if (parsed.type === "result") {
      return null;
    }

    // エラーメッセージの場合
    if (parsed.type === "error" && parsed.result) {
      return `❌ **エラー:** ${parsed.result}`;
    }

    return null;
  }

  /**
   * assistantメッセージのcontentを処理する
   * テキストやツール使用情報を抽出し、適切にフォーマットします。
   *
   * @param content - assistantメッセージのcontent配列
   * @returns 抽出・フォーマットされたメッセージ、またはnull
   * @private
   */
  private extractAssistantMessage(
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
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
   * ツール実行結果を抽出し、適切にフォーマットします。
   * TodoWrite成功メッセージはスキップします。
   *
   * @param content - userメッセージのcontent配列
   * @returns 抽出・フォーマットされたメッセージ、またはnull
   * @private
   */
  private extractUserMessage(
    content: Array<{
      type: string;
      text?: string;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
      is_error?: boolean;
    }>,
  ): string | null {
    for (const item of content) {
      if (item.type === "tool_result") {
        let resultContent = "";

        // contentが配列の場合（タスクエージェントなど）
        if (Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === "text" && contentItem.text) {
              resultContent += contentItem.text;
            }
          }
        } else {
          // contentが文字列の場合（通常のツール結果）
          resultContent = item.content || "";
        }

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
   * ツール実行結果を長さと内容に応じてフォーマットする
   * 500文字未満: 全文表示
   * 500-2000文字: 先頭・末尾表示
   * 2000文字以上: スマート要約
   * エラー結果は error/fatal 行を優先表示
   *
   * @param content - フォーマット対象のツール結果
   * @param isError - エラー結果かどうか
   * @returns フォーマットされた結果文字列
   * @private
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
   * error/failed/exception/fatalを含む行を優先的に抽出して表示します。
   *
   * @param content - エラー結果の内容
   * @param maxLength - 最大文字数
   * @returns フォーマットされたエラー結果
   * @private
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
   * 先頭10行と末尾5行を表示し、中間を省略します。
   *
   * @param content - ツール結果の内容
   * @param maxLength - 最大文字数
   * @returns フォーマットされた結果
   * @private
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
   * 結果の種類を判定し、重要な情報を抽出して要約します。
   *
   * @param content - 長い結果の内容
   * @param maxLength - 最大文字数
   * @returns スマート要約された結果
   * @private
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
   * gitコミット、テスト結果、ファイル操作などの重要情報を抽出します。
   *
   * @param content - 要約対象の内容
   * @returns 抽出された要約情報、またはnull
   * @private
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
   * ツール名に応じて適切なアイコンを付与し、TodoWriteは特別にフォーマットします。
   *
   * @param item - ツール使用情報
   * @returns フォーマットされたツール使用メッセージ、またはnull
   * @private
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
   * ファイルパスから作業ディレクトリを除外した相対パスを取得する
   *
   * フルパスから作業ディレクトリ部分を除去し、プロジェクト内の相対パスを返します。
   * worktreePath、リポジトリパス、threadsディレクトリのパターンを順に試します。
   *
   * @param filePath - 変換対象のフルパス
   * @returns プロジェクト内の相対パス。変換できない場合は元のパスをそのまま返す
   *
   * @example
   * ```typescript
   * // worktreePath = "/workspaces/123/repo"
   * getRelativePath("/workspaces/123/repo/src/index.ts") // "src/index.ts"
   * getRelativePath("/repositories/org/repo/src/index.ts") // "src/index.ts"
   * getRelativePath("/threads/123/worktree/src/index.ts") // "src/index.ts"
   * ```
   *
   * @private
   */
  private getRelativePath(filePath: string): string {
    if (!filePath) return "";

    // worktreePathが設定されている場合はそれを基準に
    if (this.worktreePath && filePath.startsWith(this.worktreePath)) {
      return filePath.slice(this.worktreePath.length).replace(/^\//, "");
    }

    // worktreePathがない場合は、リポジトリのパスパターンを探す
    const repoPattern = /\/repositories\/[^\/]+\/[^\/]+\//;
    const match = filePath.match(repoPattern);
    if (match && match.index !== undefined) {
      // リポジトリディレクトリ以降のパスを返す
      return filePath.slice(match.index + match[0].length);
    }

    // threadsディレクトリのパターンも探す
    const threadsPattern = /\/threads\/[^\/]+\/worktree\//;
    const threadsMatch = filePath.match(threadsPattern);
    if (threadsMatch && threadsMatch.index !== undefined) {
      // worktreeディレクトリ以降のパスを返す
      return filePath.slice(threadsMatch.index + threadsMatch[0].length);
    }

    return filePath;
  }

  /**
   * ツール名に対応するアイコンを取得
   *
   * @param toolName - ツール名
   * @returns 対応する絵文字アイコン
   * @private
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
   * ツール名と入力パラメータに基づいて、ユーザーに表示する説明文を生成します。
   *
   * @param toolName - ツール名
   * @param input - ツールの入力パラメータ
   * @returns ツールの説明文
   * @private
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
        return `ファイル読み込み: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Write":
        return `ファイル書き込み: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Edit":
        return `ファイル編集: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "MultiEdit":
        return `ファイル一括編集: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Glob":
        return `ファイル検索: ${input?.pattern || ""}`;
      case "Grep":
        return `コンテンツ検索: ${input?.pattern || ""}`;
      case "LS":
        return `ディレクトリ一覧: ${
          this.getRelativePath(input?.path as string || "")
        }`;
      case "Task":
        return `エージェントタスク: ${input?.description || ""}`;
      case "WebFetch":
        return `Web取得: ${input?.url || ""}`;
      case "WebSearch":
        return `Web検索: ${input?.query || ""}`;
      case "NotebookRead":
        return `ノートブック読み込み: ${
          this.getRelativePath(input?.notebook_path as string || "")
        }`;
      case "NotebookEdit":
        return `ノートブック編集: ${
          this.getRelativePath(input?.notebook_path as string || "")
        }`;
      case "TodoRead":
        return "TODOリスト確認";
      default:
        return `${toolName}実行`;
    }
  }

  /**
   * TODOリストをチェックマーク付きリスト形式でフォーマットする
   * ✅ 完了、⬜ 未完了、🔄 進行中のアイコンを使用します。
   *
   * @param todos - TODOアイテムの配列
   * @returns フォーマットされたTODOリスト
   * @private
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
   * TodoWriteツールの使用を検出し、JSONからTODOリストを抽出してフォーマットします。
   *
   * @param textContent - テキストコンテンツ
   * @returns フォーマットされたTODOリスト、またはnull
   * @private
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
   * TodoWrite成功時の定型文パターンを検出します。
   *
   * @param content - チェック対象のコンテンツ
   * @returns TodoWrite成功メッセージかどうか
   * @private
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
   * verboseモードが有効な場合のみ、タイムスタンプ付きの詳細ログを出力します。
   *
   * @param message - ログメッセージ
   * @param metadata - 追加のメタデータ（オプション）
   * @private
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
   *
   * @param result - チェック対象の結果文字列
   * @returns レートリミットメッセージかどうか
   * @private
   */
  private isClaudeCodeRateLimit(result: string): boolean {
    return result.includes("Claude AI usage limit reached|");
  }

  /**
   * レートリミットメッセージからタイムスタンプを抽出する
   *
   * @param result - レートリミットメッセージ
   * @returns Unixタイムスタンプ（秒）、またはnull
   * @private
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
   *
   * devcontainer CLIを使用してコンテナを起動します。
   * 起動に成功した場合は、Claude実行戦略をDevcontainerClaudeExecutorに切り替えます。
   * GitHub PATが設定されている場合は、コンテナ内でも利用可能にします。
   *
   * @param onProgress - 進捗状況を通知するためのコールバック関数（オプション）
   * @returns devcontainer起動結果オブジェクト
   * @returns returns.success - 起動に成功したかどうか
   * @returns returns.containerId - 起動したコンテナのID（成功時のみ）
   * @returns returns.error - エラーメッセージ（失敗時のみ）
   *
   * @example
   * ```typescript
   * const result = await worker.startDevcontainer(async (msg) => {
   *   console.log(`進捗: ${msg}`);
   * });
   *
   * if (result.success) {
   *   console.log(`コンテナID: ${result.containerId}`);
   * } else {
   *   console.error(`エラー: ${result.error}`);
   * }
   * ```
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

    // リポジトリのPATを取得
    let ghToken: string | undefined;
    if (this.repository.fullName) {
      const patInfo = await this.workspaceManager.loadRepositoryPat(
        this.repository.fullName,
      );
      if (patInfo) {
        ghToken = patInfo.token;
        this.logVerbose("GitHub PAT取得", {
          repository: this.repository.fullName,
          hasToken: true,
        });
      }
    }

    const { startDevcontainer } = await import("./devcontainer.ts");
    const result = await startDevcontainer(
      this.worktreePath,
      onProgress,
      ghToken,
    );

    if (result.success) {
      this.devcontainerStarted = true;

      // DevcontainerClaudeExecutorに切り替え
      if (this.useDevcontainer && this.worktreePath) {
        this.logVerbose(
          "DevcontainerClaudeExecutorに切り替え（startDevcontainer成功後）",
        );
        this.claudeExecutor = new DevcontainerClaudeExecutor(
          this.worktreePath,
          this.verbose,
          ghToken,
        );
      }
    }

    return result;
  }

  /**
   * セッションアクティビティをログに記録する
   * Claudeとのやり取りをWorkspaceManager経由で永続化します。
   *
   * @param type - アクティビティの種類（command/response/error）
   * @param content - ログ内容
   * @param metadata - 追加のメタデータ（オプション）
   * @returns ログ記録の完了を待つPromise
   * @private
   */
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
