import { IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";
import { AuditEntry, ThreadInfo, WorkspaceManager } from "./workspace.ts";

export interface IAdmin {
  createWorker(threadId: string): Promise<IWorker>;
  getWorker(threadId: string): IWorker | null;
  routeMessage(threadId: string, message: string): Promise<string>;
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
