import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { ThreadManager } from "./workspace/thread-manager.ts";
import { SessionManager } from "./workspace/session-manager.ts";
import { AuditLogger } from "./workspace/audit-logger.ts";
import { PatManager } from "./workspace/pat-manager.ts";
import { QueueManager } from "./workspace/queue-manager.ts";

export interface WorkspaceConfig {
  baseDir: string;
  repositoriesDir: string;
  threadsDir: string;
  sessionsDir: string;
  auditDir: string;
  worktreesDir: string;
  patsDir: string;
  queuedMessagesDir: string;
  adminDir: string;
  workersDir: string;
}

export interface ThreadInfo {
  threadId: string;
  repositoryFullName: string | null;
  repositoryLocalPath: string | null;
  worktreePath: string | null;
  createdAt: string;
  lastActiveAt: string;
  status: "active" | "inactive" | "archived";
}

export interface AuditEntry {
  timestamp: string;
  threadId: string;
  action: string;
  details: Record<string, unknown>;
}

export interface RepositoryPatInfo {
  repositoryFullName: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface QueuedMessage {
  messageId: string;
  content: string;
  timestamp: number;
  authorId: string;
}

export interface ThreadQueue {
  threadId: string;
  messages: QueuedMessage[];
}

export interface AdminState {
  activeThreadIds: string[];
  lastUpdated: string;
}

export interface WorkerState {
  workerName: string;
  threadId: string;
  threadName?: string;
  repository?: {
    fullName: string;
    org: string;
    repo: string;
  };
  repositoryLocalPath?: string;
  worktreePath?: string | null;
  devcontainerConfig: {
    useDevcontainer: boolean;
    useFallbackDevcontainer: boolean;
    hasDevcontainerFile: boolean;
    hasAnthropicsFeature: boolean;
    containerId?: string;
    isStarted: boolean;
  };
  sessionId?: string | null;
  status: "active" | "inactive" | "archived";
  rateLimitTimestamp?: number;
  autoResumeAfterRateLimit?: boolean;
  queuedMessages?: QueuedMessage[];
  createdAt: string;
  lastActiveAt: string;
}

export class WorkspaceManager {
  private readonly config: WorkspaceConfig;
  private readonly threadManager: ThreadManager;
  private readonly sessionManager: SessionManager;
  private readonly auditLogger: AuditLogger;
  private readonly patManager: PatManager;
  private readonly queueManager: QueueManager;

  constructor(baseDir: string) {
    this.config = {
      baseDir,
      repositoriesDir: join(baseDir, "repositories"),
      threadsDir: join(baseDir, "threads"),
      sessionsDir: join(baseDir, "sessions"),
      auditDir: join(baseDir, "audit"),
      worktreesDir: join(baseDir, "worktrees"),
      patsDir: join(baseDir, "pats"),
      queuedMessagesDir: join(baseDir, "queued_messages"),
      adminDir: join(baseDir, "admin"),
      workersDir: join(baseDir, "workers"),
    };

    // Initialize manager instances
    this.threadManager = new ThreadManager(baseDir);
    this.sessionManager = new SessionManager(baseDir);
    this.auditLogger = new AuditLogger(baseDir);
    this.patManager = new PatManager(baseDir);
    this.queueManager = new QueueManager(baseDir);
  }

  async initialize(): Promise<void> {
    // Initialize base directories
    await ensureDir(this.config.repositoriesDir);
    await ensureDir(this.config.adminDir);
    await ensureDir(this.config.workersDir);

    // Initialize all managers
    await this.threadManager.initialize();
    await this.sessionManager.initialize();
    await this.auditLogger.initialize();
    await this.patManager.initialize();
    await this.queueManager.initialize();
  }

  getRepositoriesDir(): string {
    return this.config.repositoriesDir;
  }

  getBaseDir(): string {
    return this.config.baseDir;
  }

  getRepositoryPath(org: string, repo: string): string {
    return join(this.config.repositoriesDir, org, repo);
  }

  getWorktreePath(threadId: string): string {
    return this.threadManager.getWorktreePath(threadId);
  }

  // Private path methods removed - now handled by individual managers

  async saveThreadInfo(threadInfo: ThreadInfo): Promise<void> {
    await this.threadManager.saveThreadInfo(threadInfo);
  }

  async loadThreadInfo(threadId: string): Promise<ThreadInfo | null> {
    return await this.threadManager.loadThreadInfo(threadId);
  }

  async updateThreadLastActive(threadId: string): Promise<void> {
    await this.threadManager.updateThreadLastActive(threadId);
  }

  async appendAuditLog(auditEntry: AuditEntry): Promise<void> {
    await this.auditLogger.appendAuditLog(auditEntry);
  }

  async saveRawSessionJsonl(
    repositoryFullName: string,
    sessionId: string,
    rawJsonlContent: string,
  ): Promise<void> {
    await this.sessionManager.saveRawSessionJsonl(
      repositoryFullName,
      sessionId,
      rawJsonlContent,
    );
  }

  async getAllThreadInfos(): Promise<ThreadInfo[]> {
    return await this.threadManager.getAllThreadInfos();
  }

  async ensureWorktree(
    threadId: string,
    repositoryPath: string,
  ): Promise<string> {
    return await this.threadManager.ensureWorktree(threadId, repositoryPath);
  }

  async removeWorktree(threadId: string): Promise<void> {
    await this.threadManager.removeWorktree(threadId);
  }

  async cleanupWorktree(threadId: string): Promise<void> {
    await this.threadManager.cleanupWorktree(threadId);
  }

  async getLocalRepositories(): Promise<string[]> {
    try {
      const repositories: string[] = [];

      for await (const orgEntry of Deno.readDir(this.config.repositoriesDir)) {
        if (orgEntry.isDirectory) {
          const orgPath = join(this.config.repositoriesDir, orgEntry.name);

          try {
            for await (const repoEntry of Deno.readDir(orgPath)) {
              if (repoEntry.isDirectory) {
                repositories.push(`${orgEntry.name}/${repoEntry.name}`);
              }
            }
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              console.warn(
                `リポジトリディレクトリの読み取りに失敗しました (${orgPath}): ${error}`,
              );
            }
          }
        }
      }

      return repositories.sort();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  // PAT file path method removed - now handled by PatManager

  async saveRepositoryPat(patInfo: RepositoryPatInfo): Promise<void> {
    await this.patManager.saveRepositoryPat(patInfo);

    // 監査ログに記録
    try {
      await this.appendAuditLog({
        timestamp: new Date().toISOString(),
        threadId: "system",
        action: "save_repository_pat",
        details: {
          repository: patInfo.repositoryFullName,
          description: patInfo.description,
        },
      });
    } catch (error) {
      console.error("監査ログの記録に失敗しました:", error);
      // 監査ログの失敗は主要操作に影響を与えないようにする
    }
  }

  async loadRepositoryPat(
    repositoryFullName: string,
  ): Promise<RepositoryPatInfo | null> {
    return await this.patManager.loadRepositoryPat(repositoryFullName);
  }

  async deleteRepositoryPat(repositoryFullName: string): Promise<void> {
    await this.patManager.deleteRepositoryPat(repositoryFullName);

    // 監査ログに記録
    try {
      await this.appendAuditLog({
        timestamp: new Date().toISOString(),
        threadId: "system",
        action: "delete_repository_pat",
        details: {
          repository: repositoryFullName,
        },
      });
    } catch (error) {
      console.error("監査ログの記録に失敗しました:", error);
      // 監査ログの失敗は主要操作に影響を与えないようにする
    }
  }

  async listRepositoryPats(): Promise<RepositoryPatInfo[]> {
    return await this.patManager.listRepositoryPats();
  }

  // Queue file path method removed - now handled by QueueManager

  async saveMessageQueue(threadQueue: ThreadQueue): Promise<void> {
    await this.queueManager.saveMessageQueue(threadQueue);
  }

  async loadMessageQueue(threadId: string): Promise<ThreadQueue | null> {
    return await this.queueManager.loadMessageQueue(threadId);
  }

  async addMessageToQueue(
    threadId: string,
    message: QueuedMessage,
  ): Promise<void> {
    await this.queueManager.addMessageToQueue(threadId, message);

    // 監査ログに記録
    try {
      await this.appendAuditLog({
        timestamp: new Date().toISOString(),
        threadId,
        action: "message_queued",
        details: {
          messageId: message.messageId,
          authorId: message.authorId,
        },
      });
    } catch (error) {
      console.error("監査ログの記録に失敗しました:", error);
      // 監査ログの失敗は主要操作に影響を与えないようにする
    }
  }

  async getAndClearMessageQueue(threadId: string): Promise<QueuedMessage[]> {
    const messages = await this.queueManager.getAndClearMessageQueue(threadId);

    // 監査ログに記録
    if (messages.length > 0) {
      try {
        await this.appendAuditLog({
          timestamp: new Date().toISOString(),
          threadId,
          action: "message_queue_cleared",
          details: {
            messageCount: messages.length,
          },
        });
      } catch (error) {
        console.error("監査ログの記録に失敗しました:", error);
        // 監査ログの失敗は主要操作に影響を与えないようにする
      }
    }

    return messages;
  }

  async deleteMessageQueue(threadId: string): Promise<void> {
    await this.queueManager.deleteMessageQueue(threadId);
  }

  // Admin State Management
  private getAdminStateFilePath(): string {
    return join(this.config.adminDir, "active_threads.json");
  }

  async saveAdminState(adminState: AdminState): Promise<void> {
    const filePath = this.getAdminStateFilePath();
    adminState.lastUpdated = new Date().toISOString();
    await Deno.writeTextFile(filePath, JSON.stringify(adminState, null, 2));
  }

  async loadAdminState(): Promise<AdminState | null> {
    try {
      const filePath = this.getAdminStateFilePath();
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as AdminState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async addActiveThread(threadId: string): Promise<void> {
    let adminState = await this.loadAdminState();
    if (!adminState) {
      adminState = {
        activeThreadIds: [],
        lastUpdated: new Date().toISOString(),
      };
    }

    if (!adminState.activeThreadIds.includes(threadId)) {
      adminState.activeThreadIds.push(threadId);
      await this.saveAdminState(adminState);
    }
  }

  async removeActiveThread(threadId: string): Promise<void> {
    const adminState = await this.loadAdminState();
    if (adminState) {
      adminState.activeThreadIds = adminState.activeThreadIds.filter(
        (id) => id !== threadId,
      );
      await this.saveAdminState(adminState);
    }
  }

  // Worker State Management
  private getWorkerStateFilePath(threadId: string): string {
    return join(this.config.workersDir, `${threadId}.json`);
  }

  async saveWorkerState(workerState: WorkerState): Promise<void> {
    const filePath = this.getWorkerStateFilePath(workerState.threadId);
    workerState.lastActiveAt = new Date().toISOString();
    await Deno.writeTextFile(filePath, JSON.stringify(workerState, null, 2));
  }

  async loadWorkerState(threadId: string): Promise<WorkerState | null> {
    try {
      const filePath = this.getWorkerStateFilePath(threadId);
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as WorkerState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async deleteWorkerState(threadId: string): Promise<void> {
    const filePath = this.getWorkerStateFilePath(threadId);
    try {
      await Deno.remove(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async getAllWorkerStates(): Promise<WorkerState[]> {
    try {
      const workerStates: WorkerState[] = [];

      for await (const entry of Deno.readDir(this.config.workersDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const threadId = entry.name.replace(".json", "");
          const workerState = await this.loadWorkerState(threadId);
          if (workerState) {
            workerStates.push(workerState);
          }
        }
      }

      return workerStates.sort((a, b) =>
        b.lastActiveAt.localeCompare(a.lastActiveAt)
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }
}
