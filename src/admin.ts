import { ClaudeCodeRateLimitError, IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";
import {
  AuditEntry,
  QueuedMessage,
  ThreadInfo,
  WorkspaceManager,
} from "./workspace.ts";
import {
  checkDevcontainerCli,
  checkDevcontainerConfig,
} from "./devcontainer.ts";

/**
 * Discordボタンコンポーネントのインターフェース
 * Discord APIで使用されるインタラクティブボタンを表現します。
 * @see https://discord.com/developers/docs/interactions/message-components#button-object
 */
export interface DiscordButtonComponent {
  /** コンポーネントタイプ（2 = ボタン） */
  type: 2;
  /** ボタンスタイル（1: Primary, 2: Secondary, 3: Success, 4: Danger, 5: Link） */
  style: 1 | 2 | 3 | 4 | 5;
  /** ボタンに表示されるテキスト */
  label: string;
  /** ボタンクリック時に送信されるカスタムID */
  custom_id: string;
  /** ボタンが無効化されているかどうか */
  disabled?: boolean;
}

/**
 * Discordアクションロウのインターフェース
 * ボタンなどのコンポーネントを横一列に配置するコンテナです。
 * 1つのアクションロウには最大5つのボタンを配置できます。
 * @see https://discord.com/developers/docs/interactions/message-components#action-rows
 */
export interface DiscordActionRow {
  /** コンポーネントタイプ（1 = アクションロウ） */
  type: 1;
  /** 行内に配置されるボタンコンポーネントの配列（最大5個） */
  components: DiscordButtonComponent[];
}

/**
 * Discordメッセージのインターフェース
 * Discord APIで送信するメッセージの構造を定義します。
 * インタラクティブなボタンを含むメッセージを作成する際に使用されます。
 */
export interface DiscordMessage {
  /** メッセージの本文（最大2000文字） */
  content: string;
  /** メッセージに含まれるインタラクティブコンポーネント（ボタンなど） */
  components?: DiscordActionRow[];
}

/**
 * Adminモジュールのインターフェース
 * Worker管理とDiscordメッセージルーティングを担当する主要コンポーネントのインターフェースです。
 * 1つのAdminインスタンスが複数のWorker（1スレッド1Worker）を管理します。
 */
export interface IAdmin {
  /**
   * 指定されたスレッドIDに対してWorkerを作成または取得する
   *
   * 既にWorkerが存在する場合はそれを返し、存在しない場合は新規作成します。
   * 新規作成時は以下の処理を行います：
   * - ワーカー名の生成
   * - Workerインスタンスの作成と管理Mapへの追加
   * - スレッド情報の永続化（作成日時、最終アクティブ日時、ステータス）
   * - 監査ログへの記録
   *
   * @param threadId - Worker作成対象のスレッドID
   * @returns 作成または取得したWorkerインスタンス
   * @throws {Error} WorkspaceManagerの初期化エラーなど
   *
   * @example
   * ```typescript
   * const worker = await admin.createWorker("thread_123");
   * // workerを使用してメッセージ処理やリポジトリ設定を行う
   * ```
   */
  createWorker(threadId: string): Promise<IWorker>;

  /**
   * 指定されたスレッドIDのWorkerを取得する
   *
   * 管理しているWorkerのMapから指定されたスレッドIDに対応するWorkerを検索します。
   * Workerが存在しない場合はnullを返すため、呼び出し側でnullチェックが必要です。
   *
   * @param threadId - 取得するWorkerのスレッドID
   * @returns Workerインスタンス、存在しない場合はnull
   *
   * @example
   * ```typescript
   * const worker = admin.getWorker("thread_123");
   * if (worker) {
   *   // workerが存在する場合の処理
   * } else {
   *   // workerが存在しない場合の処理
   * }
   * ```
   */
  getWorker(threadId: string): IWorker | null;

  /**
   * スレッドIDに基づいてメッセージを適切なWorkerにルーティングする
   *
   * この関数はDiscordから受信したメッセージを処理する中核的な機能です。
   * 以下の処理フローを実行します：
   *
   * 1. メッセージ受信確認のリアクション（👀）を追加
   * 2. レートリミット状態の確認
   *    - レートリミット中の場合：メッセージをキューに追加して待機メッセージを返す
   *    - 通常時：Workerに処理を委譲
   * 3. スレッドの最終アクティブ時刻を更新
   * 4. 監査ログに記録
   * 5. Workerによるメッセージ処理（Claude実行など）
   * 6. レートリミットエラーの処理（発生時）
   *
   * @param threadId - メッセージの宛先スレッドID
   * @param message - 処理するメッセージ内容
   * @param onProgress - 進捗通知用コールバック関数（Claude実行中の中間結果を通知）
   * @param onReaction - リアクション追加用コールバック関数（処理状態を絵文字で通知）
   * @param messageId - DiscordメッセージID（レートリミット時のキュー管理用）
   * @param authorId - メッセージ送信者のID（レートリミット時のキュー管理用）
   * @returns 処理結果のメッセージまたはDiscordメッセージオブジェクト（ボタン付き）
   * @throws {Error} Workerが見つからない場合
   * @throws {ClaudeCodeRateLimitError} Claude Codeのレートリミットエラー
   *
   * @example
   * ```typescript
   * try {
   *   const result = await admin.routeMessage(
   *     "thread_123",
   *     "Claudeに質問したい内容",
   *     async (progress) => console.log(progress),
   *     async (emoji) => console.log(`リアクション: ${emoji}`)
   *   );
   *   console.log(result);
   * } catch (error) {
   *   console.error("メッセージ処理エラー:", error);
   * }
   * ```
   */
  routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage>;

  /**
   * Discordボタンのインタラクションを処理する
   *
   * customIdに基づいて適切なハンドラーを呼び出します。
   * 以下のボタンタイプをサポートしています：
   *
   * - `devcontainer_yes_${threadId}`: devcontainerを使用する
   * - `devcontainer_no_${threadId}`: ローカル環境を使用する
   * - `rate_limit_auto_yes_${threadId}`: レートリミット後の自動再開を有効化
   * - `rate_limit_auto_no_${threadId}`: レートリミット後の手動再開を選択
   * - `local_env_${threadId}`: ローカル環境を選択（devcontainer.jsonなし）
   * - `fallback_devcontainer_${threadId}`: fallback devcontainerを使用
   *
   * @param threadId - ボタンが押されたスレッドのID
   * @param customId - ボタンのカスタムID（ボタンタイプとスレッドIDを含む）
   * @returns ボタン処理結果のメッセージ
   *
   * @example
   * ```typescript
   * const message = await admin.handleButtonInteraction(
   *   "thread_123",
   *   "devcontainer_yes_thread_123"
   * );
   * // "devcontainer_start_with_progress" などの特殊な戻り値の場合、
   * // 呼び出し側で追加の処理が必要
   * ```
   */
  handleButtonInteraction(threadId: string, customId: string): Promise<string>;

  /**
   * スレッド開始時の初期メッセージを作成する
   *
   * 新しいスレッドが作成された際に表示する初期メッセージを生成します。
   * メッセージには以下の内容が含まれます：
   * - Claude Code Botスレッドの開始通知
   * - `/start`コマンドの使用方法
   * - リポジトリ設定後の処理フロー説明
   *
   * @param threadId - スレッドID（現在は使用されていないが、将来の拡張のため保持）
   * @returns 初期メッセージのDiscordメッセージオブジェクト（ボタンなし）
   *
   * @example
   * ```typescript
   * const initialMessage = admin.createInitialMessage("thread_123");
   * // Discord APIを使用してメッセージを送信
   * await sendMessage(initialMessage);
   * ```
   */
  createInitialMessage(threadId: string): DiscordMessage;

  /**
   * レートリミットメッセージを作成する
   *
   * Claude Codeのレートリミットが発生した際に表示するメッセージを生成します。
   * メッセージには以下の情報が含まれます：
   * - レートリミット発生の通知
   * - 制限解除予定時刻（日本時間、5分後）
   * - 自動処理の説明
   *
   * @param threadId - スレッドID（現在は使用されていないが、将来の拡張のため保持）
   * @param timestamp - レートリミットが発生したUnixタイムスタンプ（秒単位）
   * @returns レートリミットメッセージ（日本語）
   *
   * @example
   * ```typescript
   * const rateLimitMessage = admin.createRateLimitMessage(
   *   "thread_123",
   *   Math.floor(Date.now() / 1000)
   * );
   * // "Claude Codeのレートリミットに達しました...制限解除予定時刻：2024/01/01 12:34頃"
   * ```
   */
  createRateLimitMessage(threadId: string, timestamp: number): string;

  /**
   * スレッドを終了し、関連リソースをクリーンアップする
   *
   * スレッドの完全な終了処理を行います。以下の処理を順次実行します：
   * 1. Workerインスタンスの削除
   * 2. Git worktreeの削除（作業ディレクトリのクリーンアップ）
   * 3. レートリミット自動再開タイマーのクリア
   * 4. スレッド情報のステータスを"archived"に更新
   * 5. 監査ログへの記録
   * 6. Discordスレッドのクローズ（コールバックが設定されている場合）
   *
   * @param threadId - 終了するスレッドのID
   * @returns 終了処理の完了を待つPromise
   *
   * @example
   * ```typescript
   * // スレッドを終了
   * await admin.terminateThread("thread_123");
   * // すべてのリソースがクリーンアップされ、スレッドがアーカイブされる
   * ```
   */
  terminateThread(threadId: string): Promise<void>;

  /**
   * アプリケーション再起動時に既存のアクティブなスレッドを復旧する
   *
   * アプリケーションが再起動された際に、以前アクティブだったスレッドの状態を復元します。
   * 以下の処理を実行します：
   *
   * 1. 永続化されたスレッド情報から"active"ステータスのスレッドを検索
   * 2. 各アクティブスレッドに対して：
   *    - Git worktreeの有効性を確認（無効な場合はアーカイブ化）
   *    - Workerインスタンスを再作成
   *    - devcontainer設定を復元
   *    - リポジトリ情報を復元
   * 3. レートリミット自動再開タイマーを復旧
   *
   * @returns 復旧処理の完了を待つPromise
   * @throws {Error} スレッド情報の読み込みでエラーが発生した場合
   *
   * @example
   * ```typescript
   * const admin = new Admin(workspaceManager);
   * // アプリケーション起動時に実行
   * await admin.restoreActiveThreads();
   * // すべてのアクティブスレッドが復旧される
   * ```
   */
  restoreActiveThreads(): Promise<void>;

  /**
   * レートリミット解除後の自動再開コールバックを設定する
   *
   * Claude Codeのレートリミットが解除された後に、自動的にメッセージを送信するための
   * コールバック関数を設定します。このコールバックは以下の場面で呼び出されます：
   * - レートリミット解除後、キューに溜まったメッセージを処理する場合
   * - キューが空の場合、"続けて"というメッセージを送信する場合
   *
   * @param callback - 自動再開時に呼び出されるコールバック関数
   *                   第1引数: threadId（スレッドID）
   *                   第2引数: message（送信するメッセージ内容）
   *
   * @example
   * ```typescript
   * admin.setAutoResumeCallback(async (threadId, message) => {
   *   // Discord APIを使用してメッセージを送信
   *   await sendMessageToThread(threadId, message);
   * });
   * ```
   */
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void;

  /**
   * スレッドクローズ時のコールバックを設定する
   *
   * スレッド終了時にDiscordスレッドをクローズするためのコールバック関数を設定します。
   * このコールバックは`terminateThread`メソッドの最後に呼び出され、
   * Discord APIを使用してスレッドを閉じる処理を実装できます。
   *
   * @param callback - スレッドクローズ時に呼び出されるコールバック関数
   *                   引数: threadId（クローズするスレッドのID）
   *
   * @example
   * ```typescript
   * admin.setThreadCloseCallback(async (threadId) => {
   *   // Discord APIを使用してスレッドをクローズ
   *   await discordClient.closeThread(threadId);
   * });
   * ```
   */
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void;
}

/**
 * Adminクラス - Discord BotのWorker管理とメッセージルーティングを担当
 *
 * 主な責務:
 * - Worker（1スレッド1Worker）の作成・管理
 * - Discordからのメッセージを適切なWorkerへルーティング
 * - devcontainer設定の管理と起動制御
 * - レートリミット時の自動再開処理
 * - アプリケーション再起動時のスレッド復旧
 * - 監査ログとスレッド情報の永続化
 *
 * @example
 * ```typescript
 * const workspaceManager = new WorkspaceManager("/work");
 * await workspaceManager.initialize();
 * const admin = new Admin(workspaceManager, true);
 * await admin.restoreActiveThreads();
 * ```
 */
export class Admin implements IAdmin {
  /** スレッドIDとWorkerインスタンスのマッピング */
  private workers: Map<string, IWorker>;
  /** 作業ディレクトリとデータ永続化を管理するマネージャー */
  private workspaceManager: WorkspaceManager;
  /** 詳細ログ出力フラグ */
  private verbose: boolean;
  /** Claude実行時に追加するシステムプロンプト */
  private appendSystemPrompt?: string;
  /** PLaMo-2-translate APIのURL */
  private translatorUrl?: string;
  /** レートリミット自動再開タイマーのマッピング */
  private autoResumeTimers: Map<string, number> = new Map();
  /** レートリミット解除後の自動再開コールバック */
  private onAutoResumeMessage?: (
    threadId: string,
    message: string,
  ) => Promise<void>;
  /** スレッドクローズ時のコールバック */
  private onThreadClose?: (
    threadId: string,
  ) => Promise<void>;

  /**
   * Adminインスタンスを作成する
   * @param workspaceManager - 作業ディレクトリとデータ永続化を管理するマネージャー
   * @param verbose - 詳細ログを出力するかどうか（デフォルト: false）
   * @param appendSystemPrompt - Claude実行時に追加するシステムプロンプト（オプション）
   * @param translatorUrl - PLaMo-2-translate APIのURL（オプション）
   */
  constructor(
    workspaceManager: WorkspaceManager,
    verbose: boolean = false,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ) {
    this.workers = new Map();
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;
    this.appendSystemPrompt = appendSystemPrompt;
    this.translatorUrl = translatorUrl;

    if (this.verbose) {
      this.logVerbose("Admin初期化完了", {
        verboseMode: this.verbose,
        workspaceBaseDir: workspaceManager.getBaseDir(),
        hasAppendSystemPrompt: !!this.appendSystemPrompt,
        hasTranslatorUrl: !!this.translatorUrl,
      });
    }
  }

  /**
   * 既存のアクティブなスレッドを復旧する
   * アプリケーション再起動時に、以前アクティブだったスレッドのWorkerを再作成し、
   * devcontainer設定やリポジトリ情報を復元します。
   * @returns 復旧処理の完了を待つPromise
   * @throws {Error} スレッド情報の読み込みでエラーが発生した場合
   */
  async restoreActiveThreads(): Promise<void> {
    this.logVerbose("アクティブスレッド復旧開始");

    try {
      const allThreadInfos = await this.workspaceManager.getAllThreadInfos();
      const activeThreads = allThreadInfos.filter(
        (thread) => thread.status === "active",
      );

      this.logVerbose("復旧対象スレッド発見", {
        totalThreads: allThreadInfos.length,
        activeThreads: activeThreads.length,
      });

      for (const threadInfo of activeThreads) {
        try {
          await this.restoreThread(threadInfo);
        } catch (error) {
          this.logVerbose("スレッド復旧失敗", {
            threadId: threadInfo.threadId,
            error: (error as Error).message,
          });
          console.error(
            `スレッド ${threadInfo.threadId} の復旧に失敗しました:`,
            error,
          );
        }
      }

      // レートリミット自動継続タイマーを復旧
      await this.restoreRateLimitTimers();

      this.logVerbose("アクティブスレッド復旧完了", {
        restoredCount: this.workers.size,
      });
    } catch (error) {
      this.logVerbose("アクティブスレッド復旧でエラー", {
        error: (error as Error).message,
      });
      console.error("アクティブスレッドの復旧でエラーが発生しました:", error);
    }
  }

  /**
   * 単一のスレッドを復旧する
   * worktreeとgitの有効性を確認し、無効な場合はアーカイブ状態に変更します。
   * 有効な場合はWorkerを作成してdevcontainer設定とリポジトリ情報を復元します。
   *
   * @param threadInfo - 復旧するスレッドの情報
   * @returns 復旧処理の完了を待つPromise
   * @throws {Error} worktreeやリポジトリ情報の復旧でエラーが発生した場合
   */
  private async restoreThread(threadInfo: ThreadInfo): Promise<void> {
    const { threadId } = threadInfo;

    this.logVerbose("スレッド復旧開始", {
      threadId,
      repositoryFullName: threadInfo.repositoryFullName,
      hasDevcontainerConfig: !!threadInfo.devcontainerConfig,
    });

    // worktreeとディレクトリの存在確認
    if (threadInfo.worktreePath) {
      try {
        const stat = await Deno.stat(threadInfo.worktreePath);
        if (!stat.isDirectory) {
          this.logVerbose(
            "worktreeパスが通常ファイル、スレッド終了として処理",
            {
              threadId,
              worktreePath: threadInfo.worktreePath,
            },
          );
          await this.archiveThread(threadInfo);
          return;
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.logVerbose("worktreeが存在しない、スレッド終了として処理", {
            threadId,
            worktreePath: threadInfo.worktreePath,
          });
          await this.archiveThread(threadInfo);
          return;
        }
        throw error;
      }

      // git worktreeの有効性を確認
      if (threadInfo.repositoryLocalPath) {
        try {
          const command = new Deno.Command("git", {
            args: ["worktree", "list", "--porcelain"],
            cwd: threadInfo.repositoryLocalPath,
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stdout } = await command.output();
          if (success) {
            const output = new TextDecoder().decode(stdout);
            const worktreeExists = output.includes(threadInfo.worktreePath);
            if (!worktreeExists) {
              this.logVerbose(
                "worktreeがgitに登録されていない、スレッド終了として処理",
                {
                  threadId,
                  worktreePath: threadInfo.worktreePath,
                },
              );
              await this.archiveThread(threadInfo);
              return;
            }
          }
        } catch (error) {
          this.logVerbose("git worktree list失敗、復旧を継続", {
            threadId,
            error: (error as Error).message,
          });
        }
      }
    }

    // Workerを作成（ただし既存のWorker作成ロジックをスキップして直接作成）
    const workerName = generateWorkerName();
    const worker = new Worker(
      workerName,
      this.workspaceManager,
      undefined,
      this.verbose,
      this.appendSystemPrompt,
      this.translatorUrl,
    );
    worker.setThreadId(threadId);

    // devcontainer設定を復旧
    if (threadInfo.devcontainerConfig) {
      const config = threadInfo.devcontainerConfig;
      worker.setUseDevcontainer(config.useDevcontainer);

      this.logVerbose("devcontainer設定復旧", {
        threadId,
        useDevcontainer: config.useDevcontainer,
        hasContainerId: !!config.containerId,
        isStarted: config.isStarted,
      });
    }

    // リポジトリ情報を復旧
    if (
      threadInfo.repositoryFullName && threadInfo.repositoryLocalPath &&
      threadInfo.worktreePath
    ) {
      try {
        // リポジトリ情報を再構築
        const { parseRepository } = await import("./git-utils.ts");
        const repository = parseRepository(threadInfo.repositoryFullName);

        if (repository) {
          await worker.setRepository(
            repository,
            threadInfo.repositoryLocalPath,
          );
          this.logVerbose("リポジトリ情報復旧完了", {
            threadId,
            repositoryFullName: threadInfo.repositoryFullName,
            worktreePath: threadInfo.worktreePath,
          });
        }
      } catch (error) {
        this.logVerbose("リポジトリ情報復旧失敗", {
          threadId,
          repositoryFullName: threadInfo.repositoryFullName,
          error: (error as Error).message,
        });
        console.warn(
          `スレッド ${threadId} のリポジトリ情報復旧に失敗しました:`,
          error,
        );
      }
    }

    // Workerを管理Mapに追加
    this.workers.set(threadId, worker);

    // 最終アクティブ時刻を更新
    await this.workspaceManager.updateThreadLastActive(threadId);

    // 監査ログに記録
    await this.logAuditEntry(threadId, "thread_restored", {
      workerName,
      repositoryFullName: threadInfo.repositoryFullName,
      hasDevcontainerConfig: !!threadInfo.devcontainerConfig,
    });

    this.logVerbose("スレッド復旧完了", {
      threadId,
      workerName,
      hasRepository: !!worker.getRepository(),
    });
  }

  /**
   * スレッドをアーカイブ状態にする
   * worktreeが見つからないなどの理由でスレッドを無効化する際に使用します。
   * statusをarchivedに変更し、監査ログに記録します。
   *
   * @param threadInfo - アーカイブするスレッドの情報
   * @returns アーカイブ処理の完了を待つPromise
   */
  private async archiveThread(threadInfo: ThreadInfo): Promise<void> {
    threadInfo.status = "archived";
    threadInfo.lastActiveAt = new Date().toISOString();
    await this.workspaceManager.saveThreadInfo(threadInfo);

    await this.logAuditEntry(
      threadInfo.threadId,
      "thread_archived_on_restore",
      {
        repositoryFullName: threadInfo.repositoryFullName,
        worktreePath: threadInfo.worktreePath,
        reason: "worktree_not_found",
      },
    );

    this.logVerbose("スレッドをアーカイブ状態に変更", {
      threadId: threadInfo.threadId,
      repositoryFullName: threadInfo.repositoryFullName,
    });
  }

  /**
   * verboseログを出力する
   * verboseモードが有効な場合のみ、タイムスタンプ付きの詳細ログを出力します。
   * メタデータが提供された場合は、それも併せて出力します。
   *
   * @param message - ログメッセージ
   * @param metadata - 追加のメタデータ（オプション）
   */
  private logVerbose(
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [Admin] ${message}`;
      console.log(logMessage);

      if (metadata && Object.keys(metadata).length > 0) {
        console.log(`[${timestamp}] [Admin] メタデータ:`, metadata);
      }
    }
  }

  /**
   * レートリミット情報をスレッド情報に保存する
   * Claude Codeのレートリミットが発生した際に、タイムスタンプを保存し、
   * 自動再開タイマーを設定します。
   *
   * @param threadId - スレッドID
   * @param timestamp - レートリミットが発生したUnixタイムスタンプ（秒）
   * @returns 保存処理の完了を待つPromise
   */
  private async saveRateLimitInfo(
    threadId: string,
    timestamp: number,
  ): Promise<void> {
    try {
      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (threadInfo) {
        threadInfo.rateLimitTimestamp = timestamp;
        threadInfo.lastActiveAt = new Date().toISOString();
        threadInfo.autoResumeAfterRateLimit = true; // 自動的に自動再開を有効にする
        await this.workspaceManager.saveThreadInfo(threadInfo);

        // タイマーを設定
        this.scheduleAutoResume(threadId, timestamp);

        await this.logAuditEntry(threadId, "rate_limit_detected", {
          timestamp,
          resumeTime: new Date(timestamp * 1000 + 5 * 60 * 1000).toISOString(),
          autoResumeEnabled: true,
        });
      }
    } catch (error) {
      console.error("レートリミット情報の保存に失敗しました:", error);
    }
  }

  /**
   * レートリミットメッセージを作成する（ボタンなし）
   * レートリミットが発生した際に表示するメッセージを生成します。
   * 制限解除予定時刻を含む日本語メッセージを返します。
   *
   * @param _threadId - スレッドID（現在未使用）
   * @param timestamp - レートリミットが発生したUnixタイムスタンプ（秒）
   * @returns レートリミットメッセージ
   */
  createRateLimitMessage(_threadId: string, timestamp: number): string {
    const resumeTime = new Date(timestamp * 1000 + 5 * 60 * 1000);
    const resumeTimeStr = resumeTime.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    return `Claude Codeのレートリミットに達しました。利用制限により一時的に使用できない状態です。

制限解除予定時刻：${resumeTimeStr}頃

この時間までに送信されたメッセージは、制限解除後に自動的に処理されます。`;
  }

  /**
   * 指定されたスレッドIDに対してWorkerを作成する
   * 既にWorkerが存在する場合はそれを返し、存在しない場合は新規作成します。
   * 作成時にはスレッド情報を永続化し、監査ログに記録します。
   *
   * @param threadId - Worker作成対象のスレッドID
   * @returns 作成または取得したWorkerインスタンス
   */
  async createWorker(threadId: string): Promise<IWorker> {
    this.logVerbose("Worker作成要求", {
      threadId,
      currentWorkerCount: this.workers.size,
      hasExistingWorker: this.workers.has(threadId),
    });

    // 既にWorkerが存在する場合はそれを返す
    const existingWorker = this.workers.get(threadId);
    if (existingWorker) {
      this.logVerbose("既存Worker返却", {
        threadId,
        workerName: existingWorker.getName(),
        hasRepository: !!existingWorker.getRepository(),
      });
      return existingWorker;
    }

    // 新しいWorkerを作成
    const workerName = generateWorkerName();
    this.logVerbose("新規Worker作成開始", {
      threadId,
      workerName,
      verboseMode: this.verbose,
    });

    const worker = new Worker(
      workerName,
      this.workspaceManager,
      undefined,
      this.verbose,
      this.appendSystemPrompt,
      this.translatorUrl,
    );
    worker.setThreadId(threadId);
    this.workers.set(threadId, worker);

    this.logVerbose("Worker作成完了、管理Mapに追加", {
      threadId,
      workerName,
      totalWorkerCount: this.workers.size,
    });

    // スレッド情報を永続化
    const threadInfo: ThreadInfo = {
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
      devcontainerConfig: null,
    };

    await this.workspaceManager.saveThreadInfo(threadInfo);
    this.logVerbose("スレッド情報永続化完了", { threadId });

    // 監査ログに記録
    await this.logAuditEntry(threadId, "worker_created", {
      workerName,
    });
    this.logVerbose("監査ログ記録完了", { threadId, action: "worker_created" });

    this.logVerbose("Worker作成処理完了", {
      threadId,
      workerName,
      finalWorkerCount: this.workers.size,
    });

    return worker;
  }

  /**
   * 指定されたスレッドIDのWorkerを取得する
   *
   * @param threadId - 取得するWorkerのスレッドID
   * @returns Workerインスタンス、存在しない場合はnull
   */
  getWorker(threadId: string): IWorker | null {
    return this.workers.get(threadId) || null;
  }

  /**
   * スレッドIDに基づいてメッセージを適切なWorkerにルーティングする
   * レートリミット中の場合はメッセージをキューに追加し、
   * 通常時はWorkerに処理を委譲します。
   *
   * @param threadId - メッセージの宛先スレッドID
   * @param message - 処理するメッセージ内容
   * @param onProgress - 進捗通知用コールバック関数（オプション）
   * @param onReaction - リアクション追加用コールバック関数（オプション）
   * @param messageId - DiscordメッセージID（レートリミット時のキュー管理用、オプション）
   * @param authorId - メッセージ送信者のID（レートリミット時のキュー管理用、オプション）
   * @returns 処理結果のメッセージまたはDiscordメッセージオブジェクト
   * @throws {Error} Workerが見つからない場合
   * @throws {ClaudeCodeRateLimitError} Claude Codeのレートリミットエラー
   */
  async routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage> {
    this.logVerbose("メッセージルーティング開始", {
      threadId,
      messageLength: message.length,
      hasProgressCallback: !!onProgress,
      hasReactionCallback: !!onReaction,
      activeWorkerCount: this.workers.size,
    });

    // メッセージ受信確認のリアクションを追加
    if (onReaction) {
      try {
        await onReaction("👀");
        this.logVerbose("メッセージ受信リアクション追加完了", { threadId });
      } catch (error) {
        this.logVerbose("メッセージ受信リアクション追加エラー", {
          threadId,
          error: (error as Error).message,
        });
      }
    }

    // VERBOSEモードでDiscordユーザーメッセージの詳細ログ
    if (this.verbose) {
      console.log(
        `[${new Date().toISOString()}] [Admin] Discord受信メッセージ詳細:`,
      );
      console.log(`  スレッドID: ${threadId}`);
      console.log(`  メッセージ長: ${message.length}文字`);
      console.log(`  メッセージ内容:`);
      console.log(
        `    ${message.split("\n").map((line) => `    ${line}`).join("\n")}`,
      );
    }

    // レートリミット中か確認
    const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
    if (threadInfo?.rateLimitTimestamp && messageId && authorId) {
      // レートリミット中のメッセージをキューに追加
      const queuedMessage: QueuedMessage = {
        messageId,
        content: message,
        timestamp: Date.now(),
        authorId,
      };
      await this.workspaceManager.addMessageToQueue(threadId, queuedMessage);

      this.logVerbose("メッセージをキューに追加", {
        threadId,
        messageId,
        queueLength:
          (await this.workspaceManager.loadMessageQueue(threadId))?.messages
            .length || 0,
      });

      return "レートリミット中です。このメッセージは制限解除後に自動的に処理されます。";
    }

    const worker = this.workers.get(threadId);
    if (!worker) {
      this.logVerbose("Worker見つからず", {
        threadId,
        availableThreads: Array.from(this.workers.keys()),
      });
      throw new Error(`Worker not found for thread: ${threadId}`);
    }

    this.logVerbose("Worker発見、処理開始", {
      threadId,
      workerName: worker.getName(),
      hasRepository: !!worker.getRepository(),
      repositoryFullName: worker.getRepository()?.fullName,
    });

    // スレッドの最終アクティブ時刻を更新
    await this.workspaceManager.updateThreadLastActive(threadId);
    this.logVerbose("スレッド最終アクティブ時刻を更新", { threadId });

    // 監査ログに記録
    await this.logAuditEntry(threadId, "message_received", {
      messageLength: message.length,
      hasRepository: worker.getRepository() !== null,
    });

    this.logVerbose("Workerにメッセージ処理を委譲", { threadId });

    try {
      const result = await worker.processMessage(
        message,
        onProgress,
        onReaction,
      );

      this.logVerbose("メッセージ処理完了", {
        threadId,
        responseLength: result.length,
      });

      return result;
    } catch (error) {
      if (error instanceof ClaudeCodeRateLimitError) {
        this.logVerbose("Claude Codeレートリミット検出", {
          threadId,
          timestamp: error.timestamp,
        });

        // レートリミット情報をスレッド情報に保存
        await this.saveRateLimitInfo(threadId, error.timestamp);

        // 自動継続確認メッセージを返す
        return this.createRateLimitMessage(threadId, error.timestamp);
      }

      // その他のエラーは再投げ
      throw error;
    }
  }

  /**
   * Discordボタンのインタラクションを処理する
   *
   * customIdに基づいて適切なハンドラーを呼び出します。
   *
   * @param threadId - ボタンが押されたスレッドのID
   * @param customId - ボタンのカスタムID
   * @returns ボタン処理結果のメッセージ
   */
  async handleButtonInteraction(
    threadId: string,
    customId: string,
  ): Promise<string> {
    // devcontainer関連のボタン処理
    if (customId.startsWith(`devcontainer_yes_${threadId}`)) {
      return await this.handleDevcontainerYesButton(threadId);
    }

    if (customId.startsWith(`devcontainer_no_${threadId}`)) {
      return await this.handleDevcontainerNoButton(threadId);
    }

    // レートリミット自動継続ボタン処理
    if (customId.startsWith(`rate_limit_auto_yes_${threadId}`)) {
      return await this.handleRateLimitAutoButton(threadId, true);
    }

    if (customId.startsWith(`rate_limit_auto_no_${threadId}`)) {
      return await this.handleRateLimitAutoButton(threadId, false);
    }

    // ローカル環境選択ボタン処理
    if (customId.startsWith(`local_env_${threadId}`)) {
      return await this.handleLocalEnvButton(threadId);
    }

    // fallback devcontainer選択ボタン処理
    if (customId.startsWith(`fallback_devcontainer_${threadId}`)) {
      return await this.handleFallbackDevcontainerButton(threadId);
    }

    return "未知のボタンが押されました。";
  }

  /**
   * レートリミット自動継続ボタンのハンドラー
   *
   * ユーザーが自動継続または手動再開を選択した際の処理を行います。
   *
   * 自動継続が選択された場合：
   * - autoResumeAfterRateLimitをtrueに設定
   * - 5分後に自動再開するタイマーを設定
   * - 監査ログに"rate_limit_auto_resume_enabled"として記録
   *
   * 手動再開が選択された場合：
   * - autoResumeAfterRateLimitをfalseに設定
   * - 監査ログに"rate_limit_manual_resume_selected"として記録
   *
   * @param threadId - スレッドID
   * @param autoResume - true: 自動継続を有効化、false: 手動再開を選択
   * @returns 処理結果のメッセージ
   */
  private async handleRateLimitAutoButton(
    threadId: string,
    autoResume: boolean,
  ): Promise<string> {
    try {
      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (!threadInfo || !threadInfo.rateLimitTimestamp) {
        return "レートリミット情報が見つかりません。";
      }

      if (autoResume) {
        // 自動継続を設定
        threadInfo.autoResumeAfterRateLimit = true;
        await this.workspaceManager.saveThreadInfo(threadInfo);

        await this.logAuditEntry(threadId, "rate_limit_auto_resume_enabled", {
          timestamp: threadInfo.rateLimitTimestamp,
        });

        const resumeTime = new Date(
          threadInfo.rateLimitTimestamp * 1000 + 5 * 60 * 1000,
        );
        const resumeTimeStr = resumeTime.toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        // タイマーを設定
        this.scheduleAutoResume(threadId, threadInfo.rateLimitTimestamp);

        return `自動継続が設定されました。${resumeTimeStr}頃に「続けて」というプロンプトで自動的にセッションを再開します。`;
      } else {
        // 手動再開を選択
        threadInfo.autoResumeAfterRateLimit = false;
        await this.workspaceManager.saveThreadInfo(threadInfo);

        await this.logAuditEntry(
          threadId,
          "rate_limit_manual_resume_selected",
          {
            timestamp: threadInfo.rateLimitTimestamp,
          },
        );

        return "手動での再開が選択されました。制限解除後に手動でメッセージを送信してください。";
      }
    } catch (error) {
      console.error("レートリミットボタン処理でエラーが発生しました:", error);
      return "処理中にエラーが発生しました。";
    }
  }

  /**
   * 自動再開コールバックを設定する
   *
   * レートリミット解除後に自動的にメッセージを送信するためのコールバック関数を設定します。
   *
   * @param callback - 自動再開時に呼び出されるコールバック関数
   */
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void {
    this.onAutoResumeMessage = callback;
  }

  /**
   * スレッドクローズコールバックを設定する
   *
   * スレッド終了時にDiscordスレッドをクローズするためのコールバック関数を設定します。
   *
   * @param callback - スレッドクローズ時に呼び出されるコールバック関数
   */
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void {
    this.onThreadClose = callback;
  }

  /**
   * レートリミット後の自動再開をスケジュールする
   *
   * 5分後に自動的にセッションを再開するタイマーを設定します。
   * 既存のタイマーがある場合はクリアしてから新規設定します。
   *
   * タイマー設定のロジック：
   * 1. 既存タイマーのクリア
   * 2. 再開時刻の計算（レートリミットタイムスタンプ + 5分）
   * 3. 現在時刻から再開時刻までの遅延計算
   * 4. setTimeoutでタイマー設定
   * 5. タイマーIDをMapに保存
   *
   * @param threadId - スレッドID
   * @param rateLimitTimestamp - レートリミットが発生したUnixタイムスタンプ（秒単位）
   */
  private scheduleAutoResume(
    threadId: string,
    rateLimitTimestamp: number,
  ): void {
    // 既存のタイマーがあればクリア
    const existingTimer = this.autoResumeTimers.get(threadId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 5分後に再開するタイマーを設定
    const resumeTime = rateLimitTimestamp * 1000 + 5 * 60 * 1000;
    const currentTime = Date.now();
    const delay = Math.max(0, resumeTime - currentTime);

    this.logVerbose("自動再開タイマー設定", {
      threadId,
      rateLimitTimestamp,
      resumeTime: new Date(resumeTime).toISOString(),
      delayMs: delay,
    });

    const timerId = setTimeout(async () => {
      try {
        this.logVerbose("自動再開実行開始", { threadId });
        await this.executeAutoResume(threadId);
      } catch (error) {
        console.error(
          `自動再開の実行に失敗しました (threadId: ${threadId}):`,
          error,
        );
      } finally {
        this.autoResumeTimers.delete(threadId);
      }
    }, delay);

    this.autoResumeTimers.set(threadId, timerId);
  }

  /**
   * 自動再開を実行する
   *
   * レートリミット情報をリセットし、キューに溜まったメッセージを処理します。
   * キューが空の場合は「続けて」というメッセージを送信します。
   *
   * 実行フロー：
   * 1. スレッド情報の読み込みとautoResumeAfterRateLimitの確認
   * 2. 監査ログに"auto_resume_executed"を記録
   * 3. レートリミット情報のリセット
   * 4. キューのメッセージを取得してクリア
   * 5. キューにメッセージがある場合：最初のメッセージを処理
   * 6. キューが空の場合："続けて"を送信
   *
   * @param threadId - 自動再開するスレッドのID
   * @returns 自動再開処理の完了を待つPromise
   * @throws {Error} スレッド情報の読み込みやメッセージ処理でエラーが発生した場合
   */
  private async executeAutoResume(threadId: string): Promise<void> {
    try {
      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (!threadInfo || !threadInfo.autoResumeAfterRateLimit) {
        this.logVerbose(
          "自動再開がキャンセルされているか、スレッド情報が見つかりません",
          { threadId },
        );
        return;
      }

      await this.logAuditEntry(threadId, "auto_resume_executed", {
        rateLimitTimestamp: threadInfo.rateLimitTimestamp,
        resumeTime: new Date().toISOString(),
      });

      // レートリミット情報をリセット
      threadInfo.rateLimitTimestamp = undefined;
      threadInfo.autoResumeAfterRateLimit = undefined;
      await this.workspaceManager.saveThreadInfo(threadInfo);

      // キューに溜まったメッセージを処理
      const queuedMessages = await this.workspaceManager
        .getAndClearMessageQueue(threadId);

      if (queuedMessages.length > 0) {
        this.logVerbose("キューからメッセージを処理", {
          threadId,
          messageCount: queuedMessages.length,
        });

        // 最初のメッセージを処理
        if (this.onAutoResumeMessage) {
          const firstMessage = queuedMessages[0];
          await this.onAutoResumeMessage(threadId, firstMessage.content);

          // 監査ログに記録
          await this.logAuditEntry(threadId, "queued_message_processed", {
            messageId: firstMessage.messageId,
            authorId: firstMessage.authorId,
            queuePosition: 1,
            totalQueued: queuedMessages.length,
          });
        }
      } else {
        // キューが空の場合は「続けて」を送信
        if (this.onAutoResumeMessage) {
          this.logVerbose("キューが空のため「続けて」を送信", { threadId });
          await this.onAutoResumeMessage(threadId, "続けて");
        }
      }
    } catch (error) {
      this.logVerbose("自動再開の実行でエラー", {
        threadId,
        error: (error as Error).message,
      });
      console.error(
        `自動再開の実行でエラーが発生しました (threadId: ${threadId}):`,
        error,
      );
    }
  }

  /**
   * スレッド終了時に自動再開タイマーをクリアする
   *
   * 設定されている自動再開タイマーをクリアし、メモリから削除します。
   * このメソッドは`terminateThread`から呼び出され、スレッドの
   * クリーンアップ処理の一部として実行されます。
   *
   * @param threadId - タイマーをクリアするスレッドのID
   */
  private clearAutoResumeTimer(threadId: string): void {
    const timerId = this.autoResumeTimers.get(threadId);
    if (timerId) {
      clearTimeout(timerId);
      this.autoResumeTimers.delete(threadId);
      this.logVerbose("自動再開タイマーをクリア", { threadId });
    }
  }

  /**
   * レートリミット自動継続タイマーを復旧する
   *
   * アプリケーション再起動時に、レートリミット中で自動再開が有効なスレッドの
   * タイマーを再設定します。
   *
   * 復旧処理のフロー：
   * 1. すべてのスレッド情報を取得
   * 2. 以下の条件を満たすスレッドをフィルタリング：
   *    - statusが"active"
   *    - autoResumeAfterRateLimitがtrue
   *    - rateLimitTimestampが存在
   * 3. 各スレッドのタイマーを復旧
   *
   * @returns タイマー復旧処理の完了を待つPromise
   */
  private async restoreRateLimitTimers(): Promise<void> {
    this.logVerbose("レートリミットタイマー復旧開始");

    try {
      const allThreadInfos = await this.workspaceManager.getAllThreadInfos();
      const rateLimitThreads = allThreadInfos.filter(
        (thread) =>
          thread.status === "active" &&
          thread.autoResumeAfterRateLimit === true &&
          thread.rateLimitTimestamp,
      );

      this.logVerbose("レートリミット復旧対象スレッド発見", {
        totalThreads: allThreadInfos.length,
        rateLimitThreads: rateLimitThreads.length,
      });

      for (const threadInfo of rateLimitThreads) {
        try {
          await this.restoreRateLimitTimer(threadInfo);
        } catch (error) {
          this.logVerbose("レートリミットタイマー復旧失敗", {
            threadId: threadInfo.threadId,
            error: (error as Error).message,
          });
          console.error(
            `レートリミットタイマーの復旧に失敗しました (threadId: ${threadInfo.threadId}):`,
            error,
          );
        }
      }

      this.logVerbose("レートリミットタイマー復旧完了", {
        restoredTimerCount: rateLimitThreads.length,
      });
    } catch (error) {
      this.logVerbose("レートリミットタイマー復旧でエラー", {
        error: (error as Error).message,
      });
      console.error(
        "レートリミットタイマーの復旧でエラーが発生しました:",
        error,
      );
    }
  }

  /**
   * 単一スレッドのレートリミットタイマーを復旧する
   *
   * 既に時間が過ぎている場合は即座に自動再開を実行し、
   * まだ時間が残っている場合はタイマーを再設定します。
   *
   * 復旧ロジック：
   * - 現在時刻と再開予定時刻を比較
   * - 再開予定時刻を過ぎている場合：即座に自動再開を実行
   * - 再開予定時刻が未来の場合：残り時間でタイマーを再設定
   *
   * @param threadInfo - タイマーを復旧するスレッドの情報
   * @returns タイマー復旧処理の完了を待つPromise
   */
  private async restoreRateLimitTimer(threadInfo: ThreadInfo): Promise<void> {
    if (!threadInfo.rateLimitTimestamp) {
      return;
    }

    const currentTime = Date.now();
    const resumeTime = threadInfo.rateLimitTimestamp * 1000 + 5 * 60 * 1000;

    // 既に時間が過ぎている場合は即座に実行
    if (currentTime >= resumeTime) {
      this.logVerbose("レートリミット時間が既に過ぎているため即座に実行", {
        threadId: threadInfo.threadId,
        rateLimitTimestamp: threadInfo.rateLimitTimestamp,
        currentTime: new Date(currentTime).toISOString(),
        resumeTime: new Date(resumeTime).toISOString(),
      });

      // 即座に自動再開を実行
      await this.executeAutoResume(threadInfo.threadId);

      await this.logAuditEntry(
        threadInfo.threadId,
        "rate_limit_timer_restored_immediate",
        {
          rateLimitTimestamp: threadInfo.rateLimitTimestamp,
          currentTime: new Date(currentTime).toISOString(),
        },
      );
    } else {
      // まだ時間が残っている場合はタイマーを再設定
      this.logVerbose("レートリミットタイマーを再設定", {
        threadId: threadInfo.threadId,
        rateLimitTimestamp: threadInfo.rateLimitTimestamp,
        resumeTime: new Date(resumeTime).toISOString(),
        delayMs: resumeTime - currentTime,
      });

      this.scheduleAutoResume(
        threadInfo.threadId,
        threadInfo.rateLimitTimestamp,
      );

      await this.logAuditEntry(
        threadInfo.threadId,
        "rate_limit_timer_restored",
        {
          rateLimitTimestamp: threadInfo.rateLimitTimestamp,
          resumeTime: new Date(resumeTime).toISOString(),
          delayMs: resumeTime - currentTime,
        },
      );
    }
  }

  /**
   * スレッド開始時の初期メッセージを作成する
   *
   * /startコマンドの使用方法と実行環境の設定フローを説明するメッセージを生成します。
   *
   * @param _threadId - スレッドID（現在未使用）
   * @returns 初期メッセージのDiscordメッセージオブジェクト
   */
  createInitialMessage(_threadId: string): DiscordMessage {
    return {
      content:
        "Claude Code Bot スレッドが開始されました。\n\n/start コマンドでリポジトリを指定してください。\n\n**リポジトリ設定後の流れ:**\n1. devcontainer.jsonの存在確認\n2. devcontainer利用の可否選択\n3. Claude実行環境の準備",
      components: [],
    };
  }

  /**
   * スレッドを終了する
   *
   * Workerの削除、worktreeの削除、自動再開タイマーのクリア、
   * スレッド情報のアーカイブ化、Discordスレッドのクローズを行います。
   *
   * @param threadId - 終了するスレッドのID
   * @returns 終了処理の完了を待つPromise
   */
  async terminateThread(threadId: string): Promise<void> {
    this.logVerbose("スレッド終了処理開始", {
      threadId,
      hasWorker: this.workers.has(threadId),
      currentWorkerCount: this.workers.size,
    });

    const worker = this.workers.get(threadId);

    if (worker) {
      this.logVerbose("Worker発見、終了処理実行", {
        threadId,
        workerName: worker.getName(),
        hasRepository: !!worker.getRepository(),
        repositoryFullName: worker.getRepository()?.fullName,
      });

      this.logVerbose("worktree削除開始", { threadId });
      await this.workspaceManager.removeWorktree(threadId);

      this.logVerbose("Worker管理Mapから削除", { threadId });
      this.workers.delete(threadId);

      this.logVerbose("自動再開タイマークリア", { threadId });
      this.clearAutoResumeTimer(threadId);

      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (threadInfo) {
        this.logVerbose("スレッド情報をアーカイブ状態に更新", { threadId });
        threadInfo.status = "archived";
        threadInfo.lastActiveAt = new Date().toISOString();
        await this.workspaceManager.saveThreadInfo(threadInfo);
      }

      await this.logAuditEntry(threadId, "thread_terminated", {
        workerName: worker.getName(),
        repository: worker.getRepository()?.fullName,
      });

      this.logVerbose("スレッド終了処理完了", {
        threadId,
        remainingWorkerCount: this.workers.size,
      });
    } else {
      this.logVerbose("Worker見つからず、終了処理スキップ", { threadId });
    }

    // Discordスレッドをクローズ
    if (this.onThreadClose) {
      this.logVerbose("Discordスレッドクローズコールバック実行", { threadId });
      try {
        await this.onThreadClose(threadId);
        this.logVerbose("Discordスレッドクローズ成功", { threadId });
      } catch (error) {
        console.error(
          `Discordスレッドのクローズに失敗しました (${threadId}):`,
          error,
        );
      }
    }
  }

  /**
   * リポジトリにdevcontainer.jsonが存在するかチェックし、存在する場合は起動確認を行う
   *
   * devcontainer CLIの有無やanthropics featureの設定状況に応じて、
   * 適切な選択肢を提示します。
   *
   * 処理フロー：
   * 1. devcontainer.jsonの存在確認
   * 2. devcontainer.jsonが存在しない場合：
   *    - devcontainer CLIがない：ローカル実行の確認
   *    - devcontainer CLIがある：fallback devcontainerの選択肢を提供
   * 3. devcontainer.jsonが存在する場合：
   *    - devcontainer CLIの確認
   *    - anthropics featureの確認
   *    - 使用確認の選択肢を提示
   *
   * @param threadId - スレッドID
   * @param repositoryPath - リポジトリのパス
   * @returns devcontainerチェック結果
   * @returns returns.hasDevcontainer - devcontainer.jsonが存在するか
   * @returns returns.message - ユーザーに表示するメッセージ
   * @returns returns.components - 選択ボタン（オプション）
   * @returns returns.useDevcontainer - devcontainerを使用するか（オプション）
   * @returns returns.warning - 警告メッセージ（オプション）
   */
  async checkAndSetupDevcontainer(
    threadId: string,
    repositoryPath: string,
  ): Promise<{
    hasDevcontainer: boolean;
    message: string;
    components?: DiscordActionRow[];
    useDevcontainer?: boolean;
    warning?: string;
  }> {
    this.logVerbose("devcontainer設定チェック開始", {
      threadId,
      repositoryPath,
    });

    const devcontainerInfo = await checkDevcontainerConfig(repositoryPath);
    this.logVerbose("devcontainer.json存在確認完了", {
      threadId,
      configExists: devcontainerInfo.configExists,
      hasAnthropicsFeature: devcontainerInfo.hasAnthropicsFeature,
    });

    if (!devcontainerInfo.configExists) {
      this.logVerbose("devcontainer.json未発見", {
        threadId,
      });

      // devcontainer CLIの確認
      const hasDevcontainerCli = await checkDevcontainerCli();

      if (!hasDevcontainerCli) {
        // devcontainer CLI未インストールの場合は通常のローカル環境で実行
        const config = {
          useDevcontainer: false,
          hasDevcontainerFile: false,
          hasAnthropicsFeature: false,
          isStarted: false,
        };
        await this.saveDevcontainerConfig(threadId, config);

        return {
          hasDevcontainer: false,
          message:
            "devcontainer.jsonが見つかりませんでした。通常のローカル環境でClaudeを実行します。\n\n`--dangerously-skip-permissions`オプションを使用しますか？（権限チェックをスキップします。注意して使用してください）",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 1,
                  label: "権限チェックあり",
                  custom_id: `permissions_no_skip_${threadId}`,
                },
                {
                  type: 2,
                  style: 2,
                  label: "権限チェックスキップ",
                  custom_id: `permissions_skip_${threadId}`,
                },
              ],
            },
          ],
        };
      }

      // devcontainer CLIがインストールされている場合はfallback devcontainerの選択肢を提供
      return {
        hasDevcontainer: false,
        message:
          "devcontainer.jsonが見つかりませんでした。\n\n以下のオプションから選択してください：\n1. 通常のローカル環境でClaudeを実行\n2. fallback devcontainerを使用（標準的な開発環境をコンテナで提供）",
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                label: "ローカル環境で実行",
                custom_id: `local_env_${threadId}`,
              },
              {
                type: 2,
                style: 1,
                label: "fallback devcontainerを使用",
                custom_id: `fallback_devcontainer_${threadId}`,
              },
            ],
          },
        ],
      };
    }

    // devcontainer CLIの確認
    const hasDevcontainerCli = await checkDevcontainerCli();
    this.logVerbose("devcontainer CLI確認完了", {
      threadId,
      hasDevcontainerCli,
    });

    if (!hasDevcontainerCli) {
      this.logVerbose("devcontainer CLI未インストール、ローカル環境で実行", {
        threadId,
      });

      // devcontainer設定情報を保存（CLI未インストール）
      const config = {
        useDevcontainer: false,
        hasDevcontainerFile: true,
        hasAnthropicsFeature: devcontainerInfo.hasAnthropicsFeature ?? false,
        isStarted: false,
      };
      await this.saveDevcontainerConfig(threadId, config);

      return {
        hasDevcontainer: true,
        message:
          "devcontainer.jsonが見つかりましたが、devcontainer CLIがインストールされていません。通常のローカル環境でClaudeを実行します。\n\n`--dangerously-skip-permissions`オプションを使用しますか？（権限チェックをスキップします。注意して使用してください）",
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: "権限チェックあり",
                custom_id: `permissions_no_skip_${threadId}`,
              },
              {
                type: 2,
                style: 2,
                label: "権限チェックスキップ",
                custom_id: `permissions_skip_${threadId}`,
              },
            ],
          },
        ],
        warning:
          "devcontainer CLIをインストールしてください: npm install -g @devcontainers/cli",
      };
    }

    // anthropics featureの確認
    let warningMessage = "";
    if (!devcontainerInfo.hasAnthropicsFeature) {
      warningMessage =
        "⚠️ 警告: anthropics/devcontainer-featuresが設定に含まれていません。Claude CLIが正常に動作しない可能性があります。";
    }

    this.logVerbose("devcontainer設定チェック完了、選択肢を提示", {
      threadId,
      hasAnthropicsFeature: devcontainerInfo.hasAnthropicsFeature,
      hasWarning: !!warningMessage,
    });

    // devcontainer設定情報を保存（ファイル存在状況とfeature情報のみ）
    const config = {
      useDevcontainer: false, // まだ選択されていない
      hasDevcontainerFile: true,
      hasAnthropicsFeature: devcontainerInfo.hasAnthropicsFeature ?? false,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return {
      hasDevcontainer: true,
      message:
        `devcontainer.jsonが見つかりました。devcontainer内でClaudeを実行しますか？\n\n**確認事項:**\n- devcontainer CLI: ✅ 利用可能\n- Anthropics features: ${
          devcontainerInfo.hasAnthropicsFeature ? "✅" : "❌"
        }\n\n下のボタンで選択してください：`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: "devcontainer使用",
              custom_id: `devcontainer_yes_${threadId}`,
            },
            {
              type: 2,
              style: 2,
              label: "ローカル環境",
              custom_id: `devcontainer_no_${threadId}`,
            },
          ],
        },
      ],
      warning: warningMessage,
    };
  }

  /**
   * devcontainerの起動を処理する
   *
   * 指定されたWorkerのdevcontainerを起動し、起動状態を保存します。
   *
   * 処理フロー：
   * 1. Workerの存在確認
   * 2. WorkerにuseDevcontainerフラグを設定
   * 3. Workerにdevcontainer起動を委譲
   * 4. 起動成功時：
   *    - devcontainer設定情報を更新（containerId、isStarted）
   *    - 監査ログに"devcontainer_started"を記録
   * 5. 起動失敗時：
   *    - 監査ログに"devcontainer_start_failed"を記録
   *
   * @param threadId - スレッドID
   * @param onProgress - 進捗通知用コールバック関数（オプション）
   * @returns devcontainer起動結果
   * @returns returns.success - 起動に成功したか
   * @returns returns.message - 結果メッセージ
   */
  async startDevcontainerForWorker(
    threadId: string,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logVerbose("devcontainer起動処理開始", {
      threadId,
      hasProgressCallback: !!onProgress,
      hasWorker: this.workers.has(threadId),
    });

    const worker = this.workers.get(threadId);
    if (!worker) {
      this.logVerbose("Worker見つからず、devcontainer起動失敗", { threadId });
      return {
        success: false,
        message: "Workerが見つかりません。",
      };
    }

    this.logVerbose("Worker発見、devcontainer設定開始", {
      threadId,
      workerName: worker.getName(),
    });

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(true);

    this.logVerbose("Workerにdevcontainer起動を委譲", { threadId });
    const result = await workerTyped.startDevcontainer(onProgress);

    this.logVerbose("devcontainer起動結果", {
      threadId,
      success: result.success,
      hasContainerId: !!result.containerId,
      hasError: !!result.error,
    });

    if (result.success) {
      // devcontainer設定情報を更新（起動状態とcontainerId）
      const existingConfig = await this.getDevcontainerConfig(threadId);
      if (existingConfig) {
        const updatedConfig = {
          ...existingConfig,
          containerId: result.containerId || "unknown",
          isStarted: true,
        };
        await this.saveDevcontainerConfig(threadId, updatedConfig);
      }

      await this.logAuditEntry(threadId, "devcontainer_started", {
        containerId: result.containerId || "unknown",
      });

      this.logVerbose("devcontainer起動成功、監査ログ記録完了", {
        threadId,
        containerId: result.containerId,
      });

      return {
        success: true,
        message:
          "devcontainerが正常に起動しました。Claude実行環境が準備完了です。",
      };
    } else {
      await this.logAuditEntry(threadId, "devcontainer_start_failed", {
        error: result.error,
      });

      this.logVerbose("devcontainer起動失敗、監査ログ記録完了", {
        threadId,
        error: result.error,
      });

      return {
        success: false,
        message: `devcontainerの起動に失敗しました: ${result.error}`,
      };
    }
  }

  /**
   * devcontainer使用ボタンの処理
   *
   * Workerにdevcontainer使用フラグを設定し、設定情報を保存します。
   * このメソッドは"devcontainer_start_with_progress"を返し、
   * 呼び出し元（main.ts）でdevcontainer起動処理が実行されます。
   *
   * @param threadId - スレッドID
   * @returns 処理結果のメッセージ（"devcontainer_start_with_progress"を返す）
   */
  private async handleDevcontainerYesButton(threadId: string): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(true);

    // devcontainer設定情報を保存
    const existingConfig = await this.getDevcontainerConfig(threadId);
    const config = {
      useDevcontainer: true,
      hasDevcontainerFile: existingConfig?.hasDevcontainerFile ?? false,
      hasAnthropicsFeature: existingConfig?.hasAnthropicsFeature ?? false,
      containerId: existingConfig?.containerId,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    // devcontainerを起動 (進捗コールバックはmain.tsから渡される)
    return "devcontainer_start_with_progress";
  }

  /**
   * ローカル環境使用ボタンの処理
   *
   * Workerにローカル環境使用フラグを設定し、設定情報を保存します。
   * devcontainerを使用せずにローカル環境でClaudeを実行する設定を行います。
   *
   * @param threadId - スレッドID
   * @returns 処理結果のメッセージ
   */
  private async handleDevcontainerNoButton(threadId: string): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(false);

    // devcontainer設定情報を保存
    const existingConfig = await this.getDevcontainerConfig(threadId);
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: existingConfig?.hasDevcontainerFile ?? false,
      hasAnthropicsFeature: existingConfig?.hasAnthropicsFeature ?? false,
      containerId: existingConfig?.containerId,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return `通常のローカル環境でClaude実行を設定しました。\n\n準備完了です！何かご質問をどうぞ。`;
  }

  /**
   * ローカル環境選択ボタンの処理
   *
   * devcontainer.jsonが存在しない場合のローカル環境選択を処理します。
   * WorkerにuseDevcontainerをfalseに設定し、権限チェックオプションの
   * 選択を促すメッセージを返します。
   *
   * @param threadId - スレッドID
   * @returns 権限チェックオプションの選択を促すメッセージ
   */
  private async handleLocalEnvButton(threadId: string): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(false);

    // devcontainer設定情報を保存
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return `通常のローカル環境でClaudeを実行します。\n\n\`--dangerously-skip-permissions\`オプションを使用しますか？（権限チェックをスキップします。注意して使用してください）`;
  }

  /**
   * fallback devcontainer選択ボタンの処理
   *
   * 標準的な開発環境を提供するfallback devcontainerの使用を設定します。
   * fallback devcontainerはClaude Codeの提供するデフォルトの開発環境で、
   * anthropics featureが含まれているためClaude CLIが利用可能です。
   *
   * @param threadId - スレッドID
   * @returns 処理結果のメッセージ（"fallback_devcontainer_start_with_progress"を返す）
   */
  private async handleFallbackDevcontainerButton(
    threadId: string,
  ): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(true);
    workerTyped.setUseFallbackDevcontainer(true);

    // devcontainer設定情報を保存
    const config = {
      useDevcontainer: true,
      hasDevcontainerFile: false, // fallbackを使用
      hasAnthropicsFeature: true, // fallbackにはClaude Codeが含まれている
      useFallback: true,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    // fallback devcontainerを起動
    return "fallback_devcontainer_start_with_progress";
  }

  /**
   * 指定されたWorkerのfallback devcontainerを起動する
   *
   * リポジトリにfallback devcontainerをコピーしてから起動します。
   *
   * 処理フロー：
   * 1. Workerとリポジトリの存在確認
   * 2. リポジトリパスの取得
   * 3. fallback devcontainerの起動処理を呼び出し
   * 4. 起動成功時：
   *    - devcontainer設定情報を更新（containerId、isStarted）
   *    - 監査ログに"fallback_devcontainer_started"を記録
   * 5. 起動失敗時：
   *    - 監査ログに"fallback_devcontainer_start_failed"を記録
   *
   * @param threadId - スレッドID
   * @param onProgress - 進捗通知用コールバック関数（オプション）
   * @returns fallback devcontainer起動結果
   * @returns returns.success - 起動に成功したか
   * @returns returns.message - 結果メッセージ
   */
  async startFallbackDevcontainerForWorker(
    threadId: string,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return {
        success: false,
        message: "Workerが見つかりません。",
      };
    }

    const repository = worker.getRepository();
    if (!repository) {
      return {
        success: false,
        message: "リポジトリが設定されていません。",
      };
    }

    const repositoryPath = this.workspaceManager.getRepositoryPath(
      repository.org,
      repository.repo,
    );

    this.logVerbose("fallback devcontainer起動開始", {
      threadId,
      repositoryPath,
      hasOnProgress: !!onProgress,
    });

    // fallback devcontainerを起動
    const { startFallbackDevcontainer } = await import("./devcontainer.ts");
    const result = await startFallbackDevcontainer(
      repositoryPath,
      onProgress,
    );

    this.logVerbose("fallback devcontainer起動結果", {
      threadId,
      success: result.success,
      hasContainerId: !!result.containerId,
      hasError: !!result.error,
    });

    if (result.success) {
      // devcontainer設定情報を更新（起動状態とcontainerId）
      const existingConfig = await this.getDevcontainerConfig(threadId);
      if (existingConfig) {
        const updatedConfig = {
          ...existingConfig,
          containerId: result.containerId || "unknown",
          isStarted: true,
        };
        await this.saveDevcontainerConfig(threadId, updatedConfig);
      }

      await this.logAuditEntry(threadId, "fallback_devcontainer_started", {
        containerId: result.containerId || "unknown",
      });

      this.logVerbose("fallback devcontainer起動成功、監査ログ記録完了", {
        threadId,
        containerId: result.containerId,
      });

      return {
        success: true,
        message:
          "fallback devcontainerが正常に起動しました。Claude実行環境が準備完了です。",
      };
    } else {
      await this.logAuditEntry(threadId, "fallback_devcontainer_start_failed", {
        error: result.error,
      });

      this.logVerbose("fallback devcontainer起動失敗、監査ログ記録完了", {
        threadId,
        error: result.error,
      });

      return {
        success: false,
        message: `fallback devcontainerの起動に失敗しました: ${result.error}`,
      };
    }
  }

  /**
   * スレッドのdevcontainer設定を保存する
   *
   * スレッド情報にdevcontainer設定を追加し、永続化します。
   * この設定はアプリケーション再起動時の復旧に使用されます。
   *
   * @param threadId - スレッドID
   * @param config - devcontainer設定
   * @param config.useDevcontainer - devcontainerを使用するか
   * @param config.hasDevcontainerFile - devcontainer.jsonが存在するか
   * @param config.hasAnthropicsFeature - anthropics featureが設定されているか
   * @param config.containerId - 起動済みコンテナのID（オプション）
   * @param config.isStarted - devcontainerが起動済みか
   * @returns 保存処理の完了を待つPromise
   */
  async saveDevcontainerConfig(
    threadId: string,
    config: {
      useDevcontainer: boolean;
      hasDevcontainerFile: boolean;
      hasAnthropicsFeature: boolean;
      containerId?: string;
      isStarted: boolean;
    },
  ): Promise<void> {
    const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
    if (threadInfo) {
      threadInfo.devcontainerConfig = config;
      threadInfo.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveThreadInfo(threadInfo);
      this.logVerbose("devcontainer設定保存完了", { threadId, config });
    }
  }

  /**
   * スレッドのdevcontainer設定を取得する
   *
   * 保存されたスレッド情報からdevcontainer設定を取得します。
   * この設定はdevcontainerの使用状況、設定ファイルの存在、
   * 起動状態などの情報を含んでいます。
   *
   * @param threadId - スレッドID
   * @returns devcontainer設定オブジェクト、存在しない場合はnull
   * @returns returns.useDevcontainer - devcontainerを使用するか
   * @returns returns.hasDevcontainerFile - devcontainer.jsonが存在するか
   * @returns returns.hasAnthropicsFeature - anthropics featureが設定されているか
   * @returns returns.containerId - 起動済みコンテナのID（オプション）
   * @returns returns.isStarted - devcontainerが起動済みか
   */
  async getDevcontainerConfig(threadId: string): Promise<
    {
      useDevcontainer: boolean;
      hasDevcontainerFile: boolean;
      hasAnthropicsFeature: boolean;
      containerId?: string;
      isStarted: boolean;
    } | null
  > {
    const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
    return threadInfo?.devcontainerConfig || null;
  }

  /**
   * 監査ログエントリを記録する
   *
   * システムの重要なアクションを監査ログに記録します。
   * 監査ログはJSONL形式で保存され、システムの動作履歴の
   * 追跡や問題の調査に使用されます。
   *
   * 記録される主なアクション：
   * - worker_created: Workerの新規作成
   * - thread_terminated: スレッドの終了
   * - message_received: メッセージの受信
   * - rate_limit_detected: レートリミットの検出
   * - devcontainer_started: devcontainerの起動
   * - thread_restored: スレッドの復旧
   *
   * @param threadId - スレッドID
   * @param action - アクション名（例: "worker_created", "thread_terminated"）
   * @param details - アクションの詳細情報
   * @returns ログ記録の完了を待つPromise
   */
  private async logAuditEntry(
    threadId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const auditEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId,
      action,
      details,
    };

    try {
      await this.workspaceManager.appendAuditLog(auditEntry);
    } catch (error) {
      console.error("監査ログの記録に失敗しました:", error);
    }
  }
}
