import { IWorker, Worker } from "../worker.ts";
import { AdminState, AuditEntry, WorkspaceManager } from "../workspace.ts";
import { DiscordMessage, IAdmin } from "./types.ts";
import { WorkerManager } from "./worker-manager.ts";
import { RateLimitManager } from "./rate-limit-manager.ts";
import { DevcontainerManager } from "./devcontainer-manager.ts";
import { MessageRouter } from "./message-router.ts";

export class Admin implements IAdmin {
  private state: AdminState;
  private workspaceManager: WorkspaceManager;
  private workerManager: WorkerManager;
  private rateLimitManager: RateLimitManager;
  private devcontainerManager: DevcontainerManager;
  private messageRouter: MessageRouter;
  private verbose: boolean;
  private onThreadClose?: (threadId: string) => Promise<void>;

  constructor(
    state: AdminState,
    workspaceManager: WorkspaceManager,
    verbose: boolean = false,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ) {
    this.state = state;
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;

    // 各マネージャーを初期化
    this.workerManager = new WorkerManager(
      workspaceManager,
      verbose,
      appendSystemPrompt,
      translatorUrl,
    );
    this.rateLimitManager = new RateLimitManager(workspaceManager, verbose);
    this.devcontainerManager = new DevcontainerManager(
      workspaceManager,
      verbose,
    );
    this.messageRouter = new MessageRouter(
      this.workerManager,
      this.rateLimitManager,
      workspaceManager,
      verbose,
    );

    if (this.verbose) {
      this.logVerbose("Admin初期化完了", {
        verboseMode: this.verbose,
        workspaceBaseDir: workspaceManager.getBaseDir(),
        hasAppendSystemPrompt: !!appendSystemPrompt,
        hasTranslatorUrl: !!translatorUrl,
      });
    }
  }

  /**
   * 既存のアクティブなスレッドを復旧する
   */
  async restoreActiveThreads(): Promise<void> {
    this.logVerbose("アクティブスレッド復旧開始");

    try {
      if (this.state.activeThreadIds.length === 0) {
        this.logVerbose("アクティブスレッドリストが空");
        return;
      }

      this.logVerbose("復旧対象スレッド発見", {
        activeThreadCount: this.state.activeThreadIds.length,
        threadIds: this.state.activeThreadIds,
      });

      for (const threadId of [...this.state.activeThreadIds]) {
        try {
          // スレッド情報を読み込む
          const threadInfo = await this.workspaceManager.loadThreadInfo(
            threadId,
          );
          if (!threadInfo) {
            this.logVerbose("スレッド情報が見つからない", { threadId });
            // アクティブリストから削除（失敗しても復旧ループを止めない）
            try {
              await this.removeActiveThread(threadId);
            } catch (error) {
              this.logVerbose("アクティブリストからの削除に失敗", {
                threadId,
                error: (error as Error).message,
              });
            }
            continue;
          }

          // アーカイブ済みの場合はスキップ
          if (threadInfo.status === "archived") {
            this.logVerbose("アーカイブ済みスレッドをスキップ", { threadId });
            try {
              await this.removeActiveThread(threadId);
            } catch (error) {
              this.logVerbose("アクティブリストからの削除に失敗", {
                threadId,
                error: (error as Error).message,
              });
            }
            continue;
          }

          await this.workerManager.restoreThread(threadInfo);

          // 監査ログに記録
          const workerState = await this.workspaceManager.loadWorkerState(
            threadId,
          );
          if (workerState) {
            await this.logAuditEntry(threadId, "thread_restored", {
              workerName: workerState.workerName,
              repositoryFullName: workerState.repository?.fullName,
              fromWorkerState: true,
            });
          }
        } catch (error) {
          this.logVerbose("スレッド復旧失敗", {
            threadId,
            error: (error as Error).message,
          });
          console.error(
            `スレッド ${threadId} の復旧に失敗しました:`,
            error,
          );
        }
      }

      // レートリミット自動継続タイマーを復旧
      await this.rateLimitManager.restoreRateLimitTimers();

      this.logVerbose("アクティブスレッド復旧完了", {
        restoredCount: this.workerManager.getWorkerCount(),
      });
    } catch (error) {
      this.logVerbose("アクティブスレッド復旧でエラー", {
        error: (error as Error).message,
      });
      console.error("アクティブスレッドの復旧でエラーが発生しました:", error);
    }
  }

  async createWorker(threadId: string): Promise<IWorker> {
    const worker = await this.workerManager.createWorker(threadId);

    // アクティブスレッドリストに追加
    await this.addActiveThread(threadId);
    this.logVerbose("アクティブスレッドリストに追加完了", { threadId });

    // 監査ログに記録
    await this.logAuditEntry(threadId, "worker_created", {
      workerName: worker.getName(),
    });
    this.logVerbose("監査ログ記録完了", { threadId, action: "worker_created" });

    return worker;
  }

  getWorker(threadId: string): IWorker | null {
    return this.workerManager.getWorker(threadId);
  }

  async routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage> {
    return this.messageRouter.routeMessage(
      threadId,
      message,
      onProgress,
      onReaction,
      messageId,
      authorId,
    );
  }

  async handleButtonInteraction(
    threadId: string,
    customId: string,
  ): Promise<string> {
    // devcontainer関連のボタン処理
    if (customId.startsWith(`devcontainer_yes_${threadId}`)) {
      const worker = this.workerManager.getWorker(threadId);
      if (!worker) {
        return "Workerが見つかりません。";
      }
      return this.devcontainerManager.handleDevcontainerYesButton(
        threadId,
        worker as Worker,
      );
    }

    if (customId.startsWith(`devcontainer_no_${threadId}`)) {
      const worker = this.workerManager.getWorker(threadId);
      if (!worker) {
        return "Workerが見つかりません。";
      }
      return this.devcontainerManager.handleDevcontainerNoButton(
        threadId,
        worker as Worker,
      );
    }

    // レートリミット自動継続ボタン処理
    if (customId.startsWith(`rate_limit_auto_yes_${threadId}`)) {
      return this.rateLimitManager.handleRateLimitAutoButton(threadId, true);
    }

    if (customId.startsWith(`rate_limit_auto_no_${threadId}`)) {
      return this.rateLimitManager.handleRateLimitAutoButton(threadId, false);
    }

    // ローカル環境選択ボタン処理
    if (customId.startsWith(`local_env_${threadId}`)) {
      const worker = this.workerManager.getWorker(threadId);
      if (!worker) {
        return "Workerが見つかりません。";
      }
      return this.devcontainerManager.handleLocalEnvButton(
        threadId,
        worker as Worker,
      );
    }

    // fallback devcontainer選択ボタン処理
    if (customId.startsWith(`fallback_devcontainer_${threadId}`)) {
      const worker = this.workerManager.getWorker(threadId);
      if (!worker) {
        return "Workerが見つかりません。";
      }
      return this.devcontainerManager.handleFallbackDevcontainerButton(
        threadId,
        worker as Worker,
      );
    }

    return "未知のボタンが押されました。";
  }

  /**
   * devcontainerの起動を処理する
   */
  async startDevcontainerForWorker(
    threadId: string,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const worker = this.workerManager.getWorker(threadId);
    if (!worker) {
      return {
        success: false,
        message: "Workerが見つかりません。",
      };
    }

    return this.devcontainerManager.startDevcontainerForWorker(
      threadId,
      worker as Worker,
      onProgress,
    );
  }

  /**
   * fallback devcontainerの起動を処理する
   */
  async startFallbackDevcontainerForWorker(
    threadId: string,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const worker = this.workerManager.getWorker(threadId);
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

    return this.devcontainerManager.startFallbackDevcontainerForWorker(
      threadId,
      repositoryPath,
      onProgress,
    );
  }

  /**
   * リポジトリにdevcontainer.jsonが存在するかチェックし、存在する場合は起動確認を行う
   */
  async checkAndSetupDevcontainer(
    threadId: string,
    repositoryPath: string,
  ) {
    return this.devcontainerManager.checkAndSetupDevcontainer(
      threadId,
      repositoryPath,
    );
  }

  /**
   * 自動再開コールバックを設定する
   */
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void {
    this.rateLimitManager.setAutoResumeCallback(callback);
  }

  /**
   * スレッドクローズコールバックを設定する
   */
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void {
    this.onThreadClose = callback;
  }

  createInitialMessage(_threadId: string): DiscordMessage {
    return {
      content:
        "Claude Code Bot スレッドが開始されました。\n\n/start コマンドでリポジトリを指定してください。\n\n**リポジトリ設定後の流れ:**\n1. devcontainer.jsonの存在確認\n2. devcontainer利用の可否選択\n3. Claude実行環境の準備",
      components: [],
    };
  }

  createRateLimitMessage(threadId: string, timestamp: number): string {
    return this.rateLimitManager.createRateLimitMessage(threadId, timestamp);
  }

  async terminateThread(threadId: string): Promise<void> {
    this.logVerbose("スレッド終了処理開始", {
      threadId,
      currentWorkerCount: this.workerManager.getWorkerCount(),
    });

    const worker = this.workerManager.removeWorker(threadId);

    if (worker) {
      this.logVerbose("Worker発見、終了処理実行", {
        threadId,
        workerName: worker.getName(),
        hasRepository: !!worker.getRepository(),
        repositoryFullName: worker.getRepository()?.fullName,
      });

      this.logVerbose("worktree削除開始", { threadId });
      await this.workspaceManager.removeWorktree(threadId);

      this.logVerbose("自動再開タイマークリア", { threadId });
      this.rateLimitManager.clearAutoResumeTimer(threadId);

      // WorkerStateをアーカイブ状態に更新
      const workerState = await this.workspaceManager.loadWorkerState(threadId);
      if (workerState) {
        this.logVerbose("WorkerStateをアーカイブ状態に更新", { threadId });
        workerState.status = "archived";
        workerState.lastActiveAt = new Date().toISOString();
        await this.workspaceManager.saveWorkerState(workerState);
      }

      // ThreadInfoもアーカイブ状態に更新
      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (threadInfo) {
        this.logVerbose("ThreadInfoをアーカイブ状態に更新", { threadId });
        threadInfo.status = "archived";
        threadInfo.lastActiveAt = new Date().toISOString();
        await this.workspaceManager.saveThreadInfo(threadInfo);
      }

      // アクティブスレッドリストから削除
      await this.removeActiveThread(threadId);
      this.logVerbose("アクティブスレッドリストから削除完了", { threadId });

      await this.logAuditEntry(threadId, "thread_terminated", {
        workerName: worker.getName(),
        repository: worker.getRepository()?.fullName,
      });

      this.logVerbose("スレッド終了処理完了", {
        threadId,
        remainingWorkerCount: this.workerManager.getWorkerCount(),
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
   * アクティブスレッドリストに追加
   */
  private async addActiveThread(threadId: string): Promise<void> {
    if (!this.state.activeThreadIds.includes(threadId)) {
      this.state.activeThreadIds.push(threadId);
      await this.save();
    }
  }

  /**
   * アクティブスレッドリストから削除
   */
  private async removeActiveThread(threadId: string): Promise<void> {
    this.state.activeThreadIds = this.state.activeThreadIds.filter(
      (id) => id !== threadId,
    );
    await this.save();
  }

  /**
   * Admin状態を保存
   */
  async save(): Promise<void> {
    try {
      await this.workspaceManager.saveAdminState(this.state);
      this.logVerbose("Admin状態を永続化", {
        activeThreadCount: this.state.activeThreadIds.length,
      });
    } catch (error) {
      console.error("Admin状態の保存に失敗しました:", error);
    }
  }

  /**
   * スレッドのdevcontainer設定を保存する（後方互換性のため）
   */
  async saveDevcontainerConfig(
    threadId: string,
    config: {
      useDevcontainer: boolean;
      hasDevcontainerFile: boolean;
      hasAnthropicsFeature: boolean;
      containerId?: string;
      isStarted: boolean;
      useFallback?: boolean;
    },
  ): Promise<void> {
    await this.devcontainerManager.saveDevcontainerConfig(threadId, config);
  }

  /**
   * スレッドのdevcontainer設定を取得する（後方互換性のため）
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
    return this.devcontainerManager.getDevcontainerConfig(threadId);
  }

  /**
   * Admin状態を復元する（静的メソッド）
   */
  static fromState(
    adminState: AdminState | null,
    workspaceManager: WorkspaceManager,
    verbose?: boolean,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ): Admin {
    const state = adminState || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };

    return new Admin(
      state,
      workspaceManager,
      verbose,
      appendSystemPrompt,
      translatorUrl,
    );
  }

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

  /**
   * verboseログを出力する
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
}
