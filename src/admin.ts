import { ClaudeCodeRateLimitError, IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";
import {
  AdminState,
  AuditEntry,
  QueuedMessage,
  ThreadInfo,
  WorkerState,
  WorkspaceManager,
} from "./workspace.ts";
import {
  checkDevcontainerCli,
  checkDevcontainerConfig,
} from "./devcontainer.ts";

export interface DiscordButtonComponent {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id: string;
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButtonComponent[];
}

export interface DiscordMessage {
  content: string;
  components?: DiscordActionRow[];
}

export interface IAdmin {
  createWorker(threadId: string): Promise<IWorker>;
  getWorker(threadId: string): IWorker | null;
  routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage>;
  handleButtonInteraction(threadId: string, customId: string): Promise<string>;
  createInitialMessage(threadId: string): DiscordMessage;
  createRateLimitMessage(threadId: string, timestamp: number): string;
  terminateThread(threadId: string): Promise<void>;
  restoreActiveThreads(): Promise<void>;
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void;
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void;
  save(): Promise<void>;
}

export class Admin implements IAdmin {
  private state: AdminState;
  private workers: Map<string, IWorker>;
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;
  private appendSystemPrompt?: string;
  private translatorUrl?: string;
  private autoResumeTimers: Map<string, number> = new Map();
  private onAutoResumeMessage?: (
    threadId: string,
    message: string,
  ) => Promise<void>;
  private onThreadClose?: (
    threadId: string,
  ) => Promise<void>;

  constructor(
    state: AdminState,
    workspaceManager: WorkspaceManager,
    verbose: boolean = false,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ) {
    this.state = state;
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

          await this.restoreThread(threadInfo);
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
   */
  private async restoreThread(threadInfo: ThreadInfo): Promise<void> {
    const { threadId } = threadInfo;

    this.logVerbose("スレッド復旧開始", {
      threadId,
      repositoryFullName: threadInfo.repositoryFullName,
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
          await this.archiveThread(threadId);
          return;
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.logVerbose("worktreeが存在しない、スレッド終了として処理", {
            threadId,
            worktreePath: threadInfo.worktreePath,
          });
          await this.archiveThread(threadId);
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
              await this.archiveThread(threadId);
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

    // WorkerStateを読み込む
    const workerState = await this.workspaceManager.loadWorkerState(threadId);

    if (workerState) {
      // 既存のWorkerStateから復元
      this.logVerbose("WorkerStateから復元", {
        threadId,
        workerName: workerState.workerName,
        hasRepository: !!workerState.repository,
      });

      const worker = await Worker.fromState(
        workerState,
        this.workspaceManager,
        this.verbose,
        this.appendSystemPrompt,
        this.translatorUrl,
      );

      // Workerを管理Mapに追加
      this.workers.set(threadId, worker);

      // 最終アクティブ時刻を更新
      await this.workspaceManager.updateThreadLastActive(threadId);

      // 監査ログに記録
      await this.logAuditEntry(threadId, "thread_restored", {
        workerName: workerState.workerName,
        repositoryFullName: workerState.repository?.fullName,
        fromWorkerState: true,
      });

      this.logVerbose("スレッド復旧完了（WorkerStateから）", {
        threadId,
        workerName: workerState.workerName,
        hasRepository: !!worker.getRepository(),
      });
    } else {
      // WorkerStateがない場合は従来の方法で復元
      this.logVerbose("WorkerStateが見つからない、ThreadInfoから復元", {
        threadId,
      });

      const workerName = generateWorkerName();
      const newWorkerState: WorkerState = {
        workerName,
        threadId,
        repository: threadInfo.repositoryFullName
          ? {
            fullName: threadInfo.repositoryFullName,
            org: threadInfo.repositoryFullName.split("/")[0],
            repo: threadInfo.repositoryFullName.split("/")[1],
          }
          : undefined,
        repositoryLocalPath: threadInfo.repositoryLocalPath || undefined,
        worktreePath: threadInfo.worktreePath,
        devcontainerConfig: {
          useDevcontainer: false,
          useFallbackDevcontainer: false,
          hasDevcontainerFile: false,
          hasAnthropicsFeature: false,
          isStarted: false,
        },
        status: "active",
        createdAt: threadInfo.createdAt,
        lastActiveAt: new Date().toISOString(),
      };

      const worker = new Worker(
        newWorkerState,
        this.workspaceManager,
        undefined,
        this.verbose,
        this.appendSystemPrompt,
        this.translatorUrl,
      );

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
        fromWorkerState: false,
      });

      this.logVerbose("スレッド復旧完了（ThreadInfoから）", {
        threadId,
        workerName,
        hasRepository: !!worker.getRepository(),
      });
    }
  }

  /**
   * スレッドをアーカイブ状態にする
   */
  private async archiveThread(threadId: string): Promise<void> {
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    if (workerState) {
      workerState.status = "archived";
      workerState.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveWorkerState(workerState);

      await this.logAuditEntry(
        threadId,
        "thread_archived_on_restore",
        {
          repositoryFullName: workerState.repository?.fullName,
          worktreePath: workerState.worktreePath,
          reason: "worktree_not_found",
        },
      );

      this.logVerbose("スレッドをアーカイブ状態に変更", {
        threadId,
        repositoryFullName: workerState.repository?.fullName,
      });
    }

    // ThreadInfoもアーカイブ状態に更新
    const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
    if (threadInfo) {
      threadInfo.status = "archived";
      threadInfo.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveThreadInfo(threadInfo);
    }

    // アクティブスレッドリストからも削除
    try {
      await this.removeActiveThread(threadId);
    } catch (error) {
      this.logVerbose("アクティブリストからの削除に失敗", {
        threadId,
        error: (error as Error).message,
      });
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

  /**
   * レートリミット情報をWorker状態に保存する
   */
  private async saveRateLimitInfo(
    threadId: string,
    timestamp: number,
  ): Promise<void> {
    try {
      const workerState = await this.workspaceManager.loadWorkerState(threadId);
      if (workerState) {
        workerState.rateLimitTimestamp = timestamp;
        workerState.lastActiveAt = new Date().toISOString();
        workerState.autoResumeAfterRateLimit = true; // 自動的に自動再開を有効にする
        await this.workspaceManager.saveWorkerState(workerState);

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

    const workerState: WorkerState = {
      workerName,
      threadId,
      devcontainerConfig: {
        useDevcontainer: false,
        useFallbackDevcontainer: false,
        hasDevcontainerFile: false,
        hasAnthropicsFeature: false,
        isStarted: false,
      },
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    const worker = new Worker(
      workerState,
      this.workspaceManager,
      undefined,
      this.verbose,
      this.appendSystemPrompt,
      this.translatorUrl,
    );
    this.workers.set(threadId, worker);

    this.logVerbose("Worker作成完了、管理Mapに追加", {
      threadId,
      workerName,
      totalWorkerCount: this.workers.size,
    });

    // アクティブスレッドリストに追加
    await this.addActiveThread(threadId);
    this.logVerbose("アクティブスレッドリストに追加完了", { threadId });

    // Worker状態を保存（statusを含む）
    await worker.save();
    this.logVerbose("Worker状態保存完了", { threadId });

    // ThreadInfoも作成・保存
    const threadInfo: ThreadInfo = {
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    };
    await this.workspaceManager.saveThreadInfo(threadInfo);
    this.logVerbose("ThreadInfo保存完了", { threadId });

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

  getWorker(threadId: string): IWorker | null {
    return this.workers.get(threadId) || null;
  }

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
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    if (workerState?.rateLimitTimestamp && messageId && authorId) {
      // レートリミット中のメッセージをキューに追加
      const queuedMessage: QueuedMessage = {
        messageId,
        content: message,
        timestamp: Date.now(),
        authorId,
      };

      if (!workerState.queuedMessages) {
        workerState.queuedMessages = [];
      }
      workerState.queuedMessages.push(queuedMessage);
      await this.workspaceManager.saveWorkerState(workerState);

      this.logVerbose("メッセージをキューに追加", {
        threadId,
        messageId,
        queueLength: workerState.queuedMessages.length,
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

    // 最終アクティブ時刻はWorkerのsaveStateで更新される
    this.logVerbose("Worker処理に委譲（最終アクティブ時刻は自動更新）", {
      threadId,
    });

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
   */
  private async handleRateLimitAutoButton(
    threadId: string,
    autoResume: boolean,
  ): Promise<string> {
    try {
      const workerState = await this.workspaceManager.loadWorkerState(threadId);
      if (!workerState || !workerState.rateLimitTimestamp) {
        return "レートリミット情報が見つかりません。";
      }

      if (autoResume) {
        // 自動継続を設定
        workerState.autoResumeAfterRateLimit = true;
        await this.workspaceManager.saveWorkerState(workerState);

        await this.logAuditEntry(threadId, "rate_limit_auto_resume_enabled", {
          timestamp: workerState.rateLimitTimestamp,
        });

        const resumeTime = new Date(
          workerState.rateLimitTimestamp * 1000 + 5 * 60 * 1000,
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
        this.scheduleAutoResume(threadId, workerState.rateLimitTimestamp);

        return `自動継続が設定されました。${resumeTimeStr}頃に「続けて」というプロンプトで自動的にセッションを再開します。`;
      } else {
        // 手動再開を選択
        workerState.autoResumeAfterRateLimit = false;
        await this.workspaceManager.saveWorkerState(workerState);

        await this.logAuditEntry(
          threadId,
          "rate_limit_manual_resume_selected",
          {
            timestamp: workerState.rateLimitTimestamp,
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
   */
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void {
    this.onAutoResumeMessage = callback;
  }

  /**
   * スレッドクローズコールバックを設定する
   */
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void {
    this.onThreadClose = callback;
  }

  /**
   * レートリミット後の自動再開をスケジュールする
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
   */
  private async executeAutoResume(threadId: string): Promise<void> {
    try {
      const workerState = await this.workspaceManager.loadWorkerState(threadId);
      if (!workerState || !workerState.autoResumeAfterRateLimit) {
        this.logVerbose(
          "自動再開がキャンセルされているか、Worker情報が見つかりません",
          { threadId },
        );
        return;
      }

      await this.logAuditEntry(threadId, "auto_resume_executed", {
        rateLimitTimestamp: workerState.rateLimitTimestamp,
        resumeTime: new Date().toISOString(),
      });

      // レートリミット情報をリセット
      workerState.rateLimitTimestamp = undefined;
      workerState.autoResumeAfterRateLimit = undefined;
      await this.workspaceManager.saveWorkerState(workerState);

      // キューに溜まったメッセージを処理
      const queuedMessages = workerState.queuedMessages || [];
      if (queuedMessages.length > 0) {
        // キューをクリア
        workerState.queuedMessages = [];
        await this.workspaceManager.saveWorkerState(workerState);
      }

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
   */
  private async restoreRateLimitTimers(): Promise<void> {
    this.logVerbose("レートリミットタイマー復旧開始");

    try {
      const allWorkerStates = await this.workspaceManager.getAllWorkerStates();
      const rateLimitWorkers = allWorkerStates.filter(
        (worker) =>
          worker.status === "active" &&
          worker.autoResumeAfterRateLimit === true &&
          worker.rateLimitTimestamp,
      );

      this.logVerbose("レートリミット復旧対象Worker発見", {
        totalWorkers: allWorkerStates.length,
        rateLimitWorkers: rateLimitWorkers.length,
      });

      for (const workerState of rateLimitWorkers) {
        try {
          await this.restoreRateLimitTimer(workerState);
        } catch (error) {
          this.logVerbose("レートリミットタイマー復旧失敗", {
            threadId: workerState.threadId,
            error: (error as Error).message,
          });
          console.error(
            `レートリミットタイマーの復旧に失敗しました (threadId: ${workerState.threadId}):`,
            error,
          );
        }
      }

      this.logVerbose("レートリミットタイマー復旧完了", {
        restoredTimerCount: rateLimitWorkers.length,
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
   */
  private async restoreRateLimitTimer(workerState: WorkerState): Promise<void> {
    if (!workerState.rateLimitTimestamp) {
      return;
    }

    const currentTime = Date.now();
    const resumeTime = workerState.rateLimitTimestamp * 1000 + 5 * 60 * 1000;

    // 既に時間が過ぎている場合は即座に実行
    if (currentTime >= resumeTime) {
      this.logVerbose("レートリミット時間が既に過ぎているため即座に実行", {
        threadId: workerState.threadId,
        rateLimitTimestamp: workerState.rateLimitTimestamp,
        currentTime: new Date(currentTime).toISOString(),
        resumeTime: new Date(resumeTime).toISOString(),
      });

      // 即座に自動再開を実行
      await this.executeAutoResume(workerState.threadId);

      await this.logAuditEntry(
        workerState.threadId,
        "rate_limit_timer_restored_immediate",
        {
          rateLimitTimestamp: workerState.rateLimitTimestamp,
          currentTime: new Date(currentTime).toISOString(),
        },
      );
    } else {
      // まだ時間が残っている場合はタイマーを再設定
      this.logVerbose("レートリミットタイマーを再設定", {
        threadId: workerState.threadId,
        rateLimitTimestamp: workerState.rateLimitTimestamp,
        resumeTime: new Date(resumeTime).toISOString(),
        delayMs: resumeTime - currentTime,
      });

      this.scheduleAutoResume(
        workerState.threadId,
        workerState.rateLimitTimestamp,
      );

      await this.logAuditEntry(
        workerState.threadId,
        "rate_limit_timer_restored",
        {
          rateLimitTimestamp: workerState.rateLimitTimestamp,
          resumeTime: new Date(resumeTime).toISOString(),
          delayMs: resumeTime - currentTime,
        },
      );
    }
  }

  createInitialMessage(_threadId: string): DiscordMessage {
    return {
      content:
        "Claude Code Bot スレッドが開始されました。\n\n/start コマンドでリポジトリを指定してください。\n\n**リポジトリ設定後の流れ:**\n1. devcontainer.jsonの存在確認\n2. devcontainer利用の可否選択\n3. Claude実行環境の準備",
      components: [],
    };
  }

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
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    if (workerState) {
      // 新しい構造に合わせて更新
      workerState.devcontainerConfig = {
        ...config,
        useFallbackDevcontainer:
          workerState.devcontainerConfig.useFallbackDevcontainer || false,
      };
      workerState.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveWorkerState(workerState);
      this.logVerbose("devcontainer設定保存完了", { threadId, config });
    }
  }

  /**
   * スレッドのdevcontainer設定を取得する
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
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    return workerState?.devcontainerConfig || null;
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
   * Admin状態を復元する（静的メソッド）
   */
  static async fromState(
    adminState: AdminState | null,
    workspaceManager: WorkspaceManager,
    verbose?: boolean,
    appendSystemPrompt?: string,
    translatorUrl?: string,
  ): Promise<Admin> {
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
}
