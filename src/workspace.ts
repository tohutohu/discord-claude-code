import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";

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
  private config: WorkspaceConfig;

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
  }

  async initialize(): Promise<void> {
    await ensureDir(this.config.repositoriesDir);
    await ensureDir(this.config.threadsDir);
    await ensureDir(this.config.sessionsDir);
    await ensureDir(this.config.auditDir);
    await ensureDir(this.config.worktreesDir);
    await ensureDir(this.config.patsDir);
    await ensureDir(this.config.queuedMessagesDir);
    await ensureDir(this.config.adminDir);
    await ensureDir(this.config.workersDir);
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
    return join(this.config.worktreesDir, threadId);
  }

  private getThreadFilePath(threadId: string): string {
    return join(this.config.threadsDir, `${threadId}.json`);
  }

  private getRepositorySessionDirPath(repositoryFullName: string): string {
    return join(this.config.sessionsDir, repositoryFullName);
  }

  private getRawSessionFilePath(
    repositoryFullName: string,
    timestamp: string,
    sessionId: string,
  ): string {
    return join(
      this.getRepositorySessionDirPath(repositoryFullName),
      `${timestamp}_${sessionId}.jsonl`,
    );
  }

  private getAuditFilePath(date: string): string {
    return join(this.config.auditDir, date, "activity.jsonl");
  }

  async saveThreadInfo(threadInfo: ThreadInfo): Promise<void> {
    const filePath = this.getThreadFilePath(threadInfo.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadInfo, null, 2));
  }

  async loadThreadInfo(threadId: string): Promise<ThreadInfo | null> {
    try {
      const filePath = this.getThreadFilePath(threadId);
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as ThreadInfo;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async updateThreadLastActive(threadId: string): Promise<void> {
    const threadInfo = await this.loadThreadInfo(threadId);
    if (threadInfo) {
      threadInfo.lastActiveAt = new Date().toISOString();
      await this.saveThreadInfo(threadInfo);
    }
  }

  async appendAuditLog(auditEntry: AuditEntry): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    const auditDir = join(this.config.auditDir, date);
    await ensureDir(auditDir);

    const filePath = this.getAuditFilePath(date);
    const logLine = JSON.stringify(auditEntry) + "\n";

    try {
      await Deno.writeTextFile(filePath, logLine, { append: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.writeTextFile(filePath, logLine);
      } else {
        throw error;
      }
    }
  }

  async saveRawSessionJsonl(
    repositoryFullName: string,
    sessionId: string,
    rawJsonlContent: string,
  ): Promise<void> {
    const repositorySessionDir = this.getRepositorySessionDirPath(
      repositoryFullName,
    );
    await ensureDir(repositorySessionDir);

    // 既存のファイルを探す
    let existingFilePath: string | null = null;
    try {
      for await (const entry of Deno.readDir(repositorySessionDir)) {
        if (entry.isFile && entry.name.endsWith(`_${sessionId}.jsonl`)) {
          existingFilePath = join(repositorySessionDir, entry.name);
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    let filePath: string;
    if (existingFilePath) {
      // 既存ファイルに追記
      filePath = existingFilePath;
      await Deno.writeTextFile(filePath, "\n" + rawJsonlContent, {
        append: true,
      });
    } else {
      // 新規ファイル作成
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      filePath = this.getRawSessionFilePath(
        repositoryFullName,
        timestamp,
        sessionId,
      );
      await Deno.writeTextFile(filePath, rawJsonlContent);
    }
  }

  async getAllThreadInfos(): Promise<ThreadInfo[]> {
    try {
      const threadInfos: ThreadInfo[] = [];

      for await (const entry of Deno.readDir(this.config.threadsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const threadId = entry.name.replace(".json", "");
          const threadInfo = await this.loadThreadInfo(threadId);
          if (threadInfo) {
            threadInfos.push(threadInfo);
          }
        }
      }

      return threadInfos.sort((a, b) =>
        b.lastActiveAt.localeCompare(a.lastActiveAt)
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async ensureWorktree(
    threadId: string,
    repositoryPath: string,
  ): Promise<string> {
    const { createWorktreeCopy, isWorktreeCopyExists } = await import(
      "./git-utils.ts"
    );

    // WorkspaceManagerのgetWorktreePathを使用してパスを取得
    const worktreePath = this.getWorktreePath(threadId);
    // worktreeコピーが既に存在する場合は何もしない
    const exists = await isWorktreeCopyExists(worktreePath);
    if (exists) {
      return worktreePath;
    }

    await createWorktreeCopy(repositoryPath, threadId, worktreePath);
    return worktreePath;
  }

  async removeWorktree(threadId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(threadId);

    try {
      const stat = await Deno.stat(worktreePath);
      if (!stat.isDirectory) {
        return;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }

    // worktreeコピーを削除
    try {
      await Deno.remove(worktreePath, { recursive: true });
    } catch (removeError) {
      console.warn(
        `ディレクトリの強制削除に失敗しました (${threadId}): ${removeError}`,
      );
    }
  }

  async cleanupWorktree(threadId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(threadId);

    // worktreeコピーを削除
    try {
      await Deno.remove(worktreePath, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(
          `worktreeコピーディレクトリの削除に失敗しました: ${error}`,
        );
      }
    }
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

  private getPatFilePath(repositoryFullName: string): string {
    const safeName = repositoryFullName.replace(/\//g, "_");
    return join(this.config.patsDir, `${safeName}.json`);
  }

  async saveRepositoryPat(patInfo: RepositoryPatInfo): Promise<void> {
    const filePath = this.getPatFilePath(patInfo.repositoryFullName);
    patInfo.updatedAt = new Date().toISOString();
    await Deno.writeTextFile(filePath, JSON.stringify(patInfo, null, 2));

    // 監査ログに記録
    await this.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "system",
      action: "save_repository_pat",
      details: {
        repository: patInfo.repositoryFullName,
        description: patInfo.description,
      },
    });
  }

  async loadRepositoryPat(
    repositoryFullName: string,
  ): Promise<RepositoryPatInfo | null> {
    try {
      const filePath = this.getPatFilePath(repositoryFullName);
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as RepositoryPatInfo;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async deleteRepositoryPat(repositoryFullName: string): Promise<void> {
    const filePath = this.getPatFilePath(repositoryFullName);
    try {
      await Deno.remove(filePath);

      // 監査ログに記録
      await this.appendAuditLog({
        timestamp: new Date().toISOString(),
        threadId: "system",
        action: "delete_repository_pat",
        details: {
          repository: repositoryFullName,
        },
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async listRepositoryPats(): Promise<RepositoryPatInfo[]> {
    try {
      const pats: RepositoryPatInfo[] = [];

      for await (const entry of Deno.readDir(this.config.patsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const filePath = join(this.config.patsDir, entry.name);
          const content = await Deno.readTextFile(filePath);
          pats.push(JSON.parse(content) as RepositoryPatInfo);
        }
      }

      return pats.sort((a, b) =>
        a.repositoryFullName.localeCompare(b.repositoryFullName)
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  private getQueueFilePath(threadId: string): string {
    return join(this.config.queuedMessagesDir, `${threadId}.json`);
  }

  async saveMessageQueue(threadQueue: ThreadQueue): Promise<void> {
    const filePath = this.getQueueFilePath(threadQueue.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadQueue, null, 2));
  }

  async loadMessageQueue(threadId: string): Promise<ThreadQueue | null> {
    try {
      const filePath = this.getQueueFilePath(threadId);
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as ThreadQueue;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async addMessageToQueue(
    threadId: string,
    message: QueuedMessage,
  ): Promise<void> {
    let queue = await this.loadMessageQueue(threadId);
    if (!queue) {
      queue = {
        threadId,
        messages: [],
      };
    }

    queue.messages.push(message);
    await this.saveMessageQueue(queue);

    // 監査ログに記録
    await this.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId,
      action: "message_queued",
      details: {
        messageId: message.messageId,
        authorId: message.authorId,
      },
    });
  }

  async getAndClearMessageQueue(threadId: string): Promise<QueuedMessage[]> {
    const queue = await this.loadMessageQueue(threadId);
    if (!queue || queue.messages.length === 0) {
      return [];
    }

    const messages = queue.messages;

    // キューをクリア
    await this.deleteMessageQueue(threadId);

    // 監査ログに記録
    await this.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId,
      action: "message_queue_cleared",
      details: {
        messageCount: messages.length,
      },
    });

    return messages;
  }

  async deleteMessageQueue(threadId: string): Promise<void> {
    const filePath = this.getQueueFilePath(threadId);
    try {
      await Deno.remove(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
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
