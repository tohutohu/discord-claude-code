import { IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";
import { AuditEntry, ThreadInfo, WorkspaceManager } from "./workspace.ts";
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
  routeMessage(threadId: string, message: string): Promise<string>;
  handleButtonInteraction(threadId: string, customId: string): Promise<string>;
  createInitialMessage(threadId: string): DiscordMessage;
  terminateThread(threadId: string): Promise<void>;
}

export class Admin implements IAdmin {
  private workers: Map<string, IWorker>;
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;

  constructor(workspaceManager: WorkspaceManager, verbose: boolean = false) {
    this.workers = new Map();
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;
    
    if (this.verbose) {
      this.logVerbose("Admin初期化完了", {
        verboseMode: this.verbose,
        workspaceBaseDir: workspaceManager.getBaseDir(),
      });
    }
  }

  /**
   * verboseログを出力する
   */
  private logVerbose(message: string, metadata?: Record<string, unknown>): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [Admin] ${message}`;
      console.log(logMessage);
      
      if (metadata && Object.keys(metadata).length > 0) {
        console.log(`[${timestamp}] [Admin] メタデータ:`, metadata);
      }
    }
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
    this.logVerbose("新規Worker作成開始", { threadId, workerName, verboseMode: this.verbose });
    
    const worker = new Worker(workerName, this.workspaceManager, undefined, this.verbose);
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

  getWorker(threadId: string): IWorker | null {
    return this.workers.get(threadId) || null;
  }

  async routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
  ): Promise<string> {
    this.logVerbose("メッセージルーティング開始", {
      threadId,
      messageLength: message.length,
      hasProgressCallback: !!onProgress,
      activeWorkerCount: this.workers.size,
    });

    const worker = this.workers.get(threadId);
    if (!worker) {
      this.logVerbose("Worker見つからず", { threadId, availableThreads: Array.from(this.workers.keys()) });
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
    const result = await worker.processMessage(message, onProgress);
    
    this.logVerbose("メッセージ処理完了", {
      threadId,
      responseLength: result.length,
    });

    return result;
  }

  async handleButtonInteraction(
    threadId: string,
    customId: string,
  ): Promise<string> {
    if (customId === `terminate_${threadId}`) {
      await this.terminateThread(threadId);
      return "スレッドを終了しました。worktreeも削除されました。";
    }

    // devcontainer関連のボタン処理
    if (customId.startsWith(`devcontainer_yes_${threadId}`)) {
      return await this.handleDevcontainerYesButton(threadId);
    }

    if (customId.startsWith(`devcontainer_no_${threadId}`)) {
      return await this.handleDevcontainerNoButton(threadId);
    }

    // 権限設定関連のボタン処理
    if (customId.startsWith(`permissions_skip_${threadId}`)) {
      return await this.handlePermissionsButton(threadId, true);
    }

    if (customId.startsWith(`permissions_no_skip_${threadId}`)) {
      return await this.handlePermissionsButton(threadId, false);
    }

    // devcontainer権限設定ボタン処理
    if (customId.startsWith(`devcontainer_permissions_`)) {
      const skipPermissions = customId.includes("_skip_");
      return await this.handleDevcontainerPermissionsButton(
        threadId,
        skipPermissions,
      );
    }

    return "未知のボタンが押されました。";
  }

  createInitialMessage(threadId: string): DiscordMessage {
    return {
      content:
        "Claude Code Bot スレッドが開始されました。\n\n/start コマンドでリポジトリを指定してください。\n\n**リポジトリ設定後の流れ:**\n1. devcontainer.jsonの存在確認\n2. devcontainer利用の可否選択\n3. 権限設定の選択\n4. Claude実行環境の準備\n\n終了する場合は下のボタンを押してください。",
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 4,
              label: "スレッドを終了",
              custom_id: `terminate_${threadId}`,
            },
          ],
        },
      ],
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
      this.logVerbose("devcontainer.json未発見、ローカル環境で実行", { threadId });
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

    // devcontainer CLIの確認
    const hasDevcontainerCli = await checkDevcontainerCli();
    this.logVerbose("devcontainer CLI確認完了", {
      threadId,
      hasDevcontainerCli,
    });

    if (!hasDevcontainerCli) {
      this.logVerbose("devcontainer CLI未インストール、ローカル環境で実行", { threadId });
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

    // 権限設定の選択ボタンを表示するため、返信メッセージで更新する必要がある
    // この処理は main.ts のhandleButtonInteractionで別途実装する
    return "devcontainer_permissions_choice";
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

    // 権限設定の選択ボタンを表示するため、返信メッセージで更新する必要がある
    return "local_permissions_choice";
  }

  /**
   * 権限設定ボタンの処理（devcontainer未使用時）
   */
  private async handlePermissionsButton(
    threadId: string,
    skipPermissions: boolean,
  ): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setSkipPermissions(skipPermissions);

    const permissionMsg = skipPermissions
      ? "権限チェックスキップを有効にしました。"
      : "権限チェックを有効にしました。";

    return `通常のローカル環境でClaude実行を設定しました。${permissionMsg}\n\n準備完了です！何かご質問をどうぞ。`;
  }

  /**
   * devcontainer権限設定ボタンの処理
   */
  private async handleDevcontainerPermissionsButton(
    threadId: string,
    skipPermissions: boolean,
  ): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return "Workerが見つかりません。";
    }

    const workerTyped = worker as Worker;
    workerTyped.setUseDevcontainer(true);
    workerTyped.setSkipPermissions(skipPermissions);

    // devcontainerを起動 (進捗コールバックはmain.tsから渡される)
    return "devcontainer_start_with_progress";
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
}
