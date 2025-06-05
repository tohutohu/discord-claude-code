import { IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";
import { AuditEntry, ThreadInfo, WorkspaceManager } from "./workspace.ts";

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

  constructor(workspaceManager: WorkspaceManager) {
    this.workers = new Map();
    this.workspaceManager = workspaceManager;
  }

  async createWorker(threadId: string): Promise<IWorker> {
    // 既にWorkerが存在する場合はそれを返す
    const existingWorker = this.workers.get(threadId);
    if (existingWorker) {
      return existingWorker;
    }

    // 新しいWorkerを作成
    const workerName = generateWorkerName();
    const worker = new Worker(workerName, this.workspaceManager);
    worker.setThreadId(threadId);
    this.workers.set(threadId, worker);

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

    // 監査ログに記録
    await this.logAuditEntry(threadId, "worker_created", {
      workerName,
    });

    return worker;
  }

  getWorker(threadId: string): IWorker | null {
    return this.workers.get(threadId) || null;
  }

  async routeMessage(threadId: string, message: string): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      throw new Error(`Worker not found for thread: ${threadId}`);
    }

    // スレッドの最終アクティブ時刻を更新
    await this.workspaceManager.updateThreadLastActive(threadId);

    // 監査ログに記録
    await this.logAuditEntry(threadId, "message_received", {
      messageLength: message.length,
      hasRepository: worker.getRepository() !== null,
    });

    return worker.processMessage(message);
  }

  async handleButtonInteraction(
    threadId: string,
    customId: string,
  ): Promise<string> {
    if (customId === `terminate_${threadId}`) {
      await this.terminateThread(threadId);
      return "スレッドを終了しました。worktreeも削除されました。";
    }

    return "未知のボタンが押されました。";
  }

  createInitialMessage(threadId: string): DiscordMessage {
    return {
      content:
        "Claude Code Bot スレッドが開始されました。\n\n/start コマンドでリポジトリを指定してください。\n\n終了する場合は下のボタンを押してください。",
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
    const worker = this.workers.get(threadId);

    if (worker) {
      await this.workspaceManager.removeWorktree(threadId);
      this.workers.delete(threadId);

      const threadInfo = await this.workspaceManager.loadThreadInfo(threadId);
      if (threadInfo) {
        threadInfo.status = "archived";
        threadInfo.lastActiveAt = new Date().toISOString();
        await this.workspaceManager.saveThreadInfo(threadInfo);
      }

      await this.logAuditEntry(threadId, "thread_terminated", {
        workerName: worker.getName(),
        repository: worker.getRepository()?.fullName,
      });
    }
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
