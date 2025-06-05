import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";

export interface WorkspaceConfig {
  baseDir: string;
  repositoriesDir: string;
  threadsDir: string;
  sessionsDir: string;
  auditDir: string;
}

export interface ThreadInfo {
  threadId: string;
  repositoryFullName: string | null;
  repositoryLocalPath: string | null;
  createdAt: string;
  lastActiveAt: string;
  status: "active" | "inactive" | "archived";
}

export interface SessionLog {
  sessionId: string;
  threadId: string;
  timestamp: string;
  type: "command" | "response" | "error";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEntry {
  timestamp: string;
  threadId: string;
  action: string;
  details: Record<string, unknown>;
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
    };
  }

  async initialize(): Promise<void> {
    await ensureDir(this.config.repositoriesDir);
    await ensureDir(this.config.threadsDir);
    await ensureDir(this.config.sessionsDir);
    await ensureDir(this.config.auditDir);
  }

  getRepositoriesDir(): string {
    return this.config.repositoriesDir;
  }

  getRepositoryPath(org: string, repo: string): string {
    return join(this.config.repositoriesDir, org, repo);
  }

  private getThreadFilePath(threadId: string): string {
    return join(this.config.threadsDir, `${threadId}.json`);
  }

  private getSessionDirPath(threadId: string): string {
    return join(this.config.sessionsDir, threadId);
  }

  private getSessionFilePath(threadId: string, sessionId: string): string {
    return join(this.getSessionDirPath(threadId), `${sessionId}.json`);
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

  async saveSessionLog(sessionLog: SessionLog): Promise<void> {
    const sessionDirPath = this.getSessionDirPath(sessionLog.threadId);
    await ensureDir(sessionDirPath);

    const filePath = this.getSessionFilePath(
      sessionLog.threadId,
      sessionLog.sessionId,
    );
    await Deno.writeTextFile(filePath, JSON.stringify(sessionLog, null, 2));
  }

  async loadSessionLogs(threadId: string): Promise<SessionLog[]> {
    try {
      const sessionDirPath = this.getSessionDirPath(threadId);
      const sessionLogs: SessionLog[] = [];

      for await (const entry of Deno.readDir(sessionDirPath)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const filePath = join(sessionDirPath, entry.name);
          const content = await Deno.readTextFile(filePath);
          sessionLogs.push(JSON.parse(content) as SessionLog);
        }
      }

      return sessionLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
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
}
