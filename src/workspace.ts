import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";

/**
 * ワークスペース設定のインターフェース
 * 作業ディレクトリ構造のパス情報を管理します。
 */
export interface WorkspaceConfig {
  /** ベースディレクトリ */
  baseDir: string;
  /** リポジトリディレクトリ（repositories/） */
  repositoriesDir: string;
  /** スレッド情報ディレクトリ（threads/） */
  threadsDir: string;
  /** セッションログディレクトリ（sessions/） */
  sessionsDir: string;
  /** 監査ログディレクトリ（audit/） */
  auditDir: string;
  /** worktreeディレクトリ（threads/{thread_id}/worktree/） */
  worktreesDir: string;
  /** PAT情報ディレクトリ（pats/） */
  patsDir: string;
  /** キューメッセージディレクトリ（queued_messages/） */
  queuedMessagesDir: string;
}

/**
 * スレッド情報のインターフェース
 * Discordスレッドの状態や関連情報を管理します。
 * threads/{thread_id}.jsonに永続化されます。
 */
export interface ThreadInfo {
  /** DiscordスレッドID */
  threadId: string;
  /** リポジトリのフルネーム（org/repo形式） */
  repositoryFullName: string | null;
  /** リポジトリのローカルパス */
  repositoryLocalPath: string | null;
  /** worktreeのパス */
  worktreePath: string | null;
  /** スレッド作成日時（ISO 8601形式） */
  createdAt: string;
  /** 最終アクティブ日時（ISO 8601形式） */
  lastActiveAt: string;
  /** スレッドの状態 */
  status: "active" | "inactive" | "archived";
  /** devcontainer設定情報 */
  devcontainerConfig: {
    /** devcontainerを使用するか */
    useDevcontainer: boolean;
    /** devcontainer.jsonが存在するか */
    hasDevcontainerFile: boolean;
    /** anthropics featureが設定されているか */
    hasAnthropicsFeature: boolean;
    /** 起動済みコンテナID */
    containerId?: string;
    /** devcontainerが起動済みか */
    isStarted: boolean;
  } | null;
  /** レートリミット発生タイムスタンプ（Unixタイムスタンプ、秒） */
  rateLimitTimestamp?: number;
  /** レートリミット後の自動再開を有効にするか */
  autoResumeAfterRateLimit?: boolean;
}

/**
 * セッションログのインターフェース
 * Claudeとのやり取りを記録します。
 * sessions/{thread_id}/{session_id}.jsonに永続化されます。
 */
export interface SessionLog {
  /** ClaudeセッションID */
  sessionId: string;
  /** DiscordスレッドID */
  threadId: string;
  /** ログタイムスタンプ（ISO 8601形式） */
  timestamp: string;
  /** ログタイプ */
  type: "command" | "response" | "error";
  /** ログ内容 */
  content: string;
  /** 追加のメタデータ */
  metadata?: Record<string, unknown>;
}

/**
 * 監査ログエントリのインターフェース
 * システムの重要なアクションを記録します。
 * audit/{date}/activity.jsonlにJSONL形式で永続化されます。
 */
export interface AuditEntry {
  /** エントリタイムスタンプ（ISO 8601形式） */
  timestamp: string;
  /** DiscordスレッドID */
  threadId: string;
  /** アクション名（例: worker_created, message_received） */
  action: string;
  /** アクションの詳細情報 */
  details: Record<string, unknown>;
}

/**
 * リポジトリPAT情報のインターフェース
 * GitHub Personal Access Tokenの情報を管理します。
 * pats/{org}_{repo}.jsonに永続化されます。
 */
export interface RepositoryPatInfo {
  /** リポジトリのフルネーム（org/repo形式） */
  repositoryFullName: string;
  /** GitHub Personal Access Token */
  token: string;
  /** 作成日時（ISO 8601形式） */
  createdAt: string;
  /** 更新日時（ISO 8601形式） */
  updatedAt: string;
  /** PATの説明（オプション） */
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

  private getSessionDirPath(threadId: string): string {
    return join(this.config.sessionsDir, threadId);
  }

  private getSessionFilePath(threadId: string, sessionId: string): string {
    return join(this.getSessionDirPath(threadId), `${sessionId}.json`);
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
}
