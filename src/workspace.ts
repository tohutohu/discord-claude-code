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

/**
 * キューに格納されたメッセージのインターフェース
 * Worker処理中に受信したメッセージを一時的に保存します。
 * queued_messages/{thread_id}.jsonに永続化されます。
 */
export interface QueuedMessage {
  /** DiscordメッセージID */
  messageId: string;
  /** メッセージ内容 */
  content: string;
  /** メッセージ受信時刻（Unixタイムスタンプ、ミリ秒） */
  timestamp: number;
  /** メッセージ送信者のDiscordユーザーID */
  authorId: string;
}

/**
 * スレッドごとのメッセージキューのインターフェース
 * 特定のスレッドに関連するキューメッセージを管理します。
 */
export interface ThreadQueue {
  /** DiscordスレッドID */
  threadId: string;
  /** キューに格納されたメッセージの配列 */
  messages: QueuedMessage[];
}

/**
 * 作業ディレクトリとデータ永続化を管理するクラス
 *
 * Discord Botの全データを構造化されたディレクトリで管理し、
 * スレッド情報、セッションログ、監査ログなどを永続化します。
 * 再起動後もデータの継続性を保証します。
 *
 * @example
 * ```typescript
 * const workspaceManager = new WorkspaceManager("/path/to/work");
 * await workspaceManager.initialize();
 *
 * // スレッド情報の保存
 * await workspaceManager.saveThreadInfo(threadInfo);
 *
 * // セッションログの記録
 * await workspaceManager.saveSessionLog(sessionLog);
 * ```
 */
export class WorkspaceManager {
  private config: WorkspaceConfig;

  /**
   * WorkspaceManagerのインスタンスを作成します
   *
   * @param baseDir - 作業ディレクトリのベースパス
   */
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

  /**
   * 必要なディレクトリ構造を初期化します
   *
   * 以下のディレクトリを作成します：
   * - repositories/: Gitリポジトリの格納
   * - threads/: スレッド情報JSON
   * - sessions/: Claudeセッションログ
   * - audit/: 監査ログ
   * - worktrees/: Git worktree
   * - pats/: GitHub Personal Access Token
   * - queued_messages/: キューメッセージ
   *
   * @throws {Deno.errors.PermissionDenied} ディレクトリ作成権限がない場合
   */
  async initialize(): Promise<void> {
    await ensureDir(this.config.repositoriesDir);
    await ensureDir(this.config.threadsDir);
    await ensureDir(this.config.sessionsDir);
    await ensureDir(this.config.auditDir);
    await ensureDir(this.config.worktreesDir);
    await ensureDir(this.config.patsDir);
    await ensureDir(this.config.queuedMessagesDir);
  }

  /**
   * リポジトリディレクトリのパスを取得します
   *
   * @returns repositories/ディレクトリの絶対パス
   */
  getRepositoriesDir(): string {
    return this.config.repositoriesDir;
  }

  /**
   * ベースディレクトリのパスを取得します
   *
   * @returns 作業ディレクトリのベースパス
   */
  getBaseDir(): string {
    return this.config.baseDir;
  }

  /**
   * 特定のリポジトリのローカルパスを取得します
   *
   * @param org - GitHubのorganization名
   * @param repo - リポジトリ名
   * @returns repositories/{org}/{repo}の絶対パス
   *
   * @example
   * ```typescript
   * const path = workspaceManager.getRepositoryPath("facebook", "react");
   * // => "/work/repositories/facebook/react"
   * ```
   */
  getRepositoryPath(org: string, repo: string): string {
    return join(this.config.repositoriesDir, org, repo);
  }

  /**
   * 特定のスレッドのworktreeパスを取得します
   *
   * @param threadId - DiscordスレッドID
   * @returns worktrees/{threadId}の絶対パス
   */
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

  /**
   * スレッド情報をJSONファイルに保存します
   *
   * @param threadInfo - 保存するスレッド情報
   * @throws {Deno.errors.PermissionDenied} ファイル書き込み権限がない場合
   *
   * @example
   * ```typescript
   * const threadInfo: ThreadInfo = {
   *   threadId: "123456789",
   *   repositoryFullName: "facebook/react",
   *   // ...
   * };
   * await workspaceManager.saveThreadInfo(threadInfo);
   * ```
   */
  async saveThreadInfo(threadInfo: ThreadInfo): Promise<void> {
    const filePath = this.getThreadFilePath(threadInfo.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadInfo, null, 2));
  }

  /**
   * 指定されたスレッドIDの情報を読み込みます
   *
   * @param threadId - DiscordスレッドID
   * @returns スレッド情報、存在しない場合はnull
   * @throws {Error} ファイル読み込みエラー（NotFound以外）
   */
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

  /**
   * スレッドの最終アクティブ時刻を現在時刻に更新します
   *
   * @param threadId - DiscordスレッドID
   * @throws {Error} スレッド情報の読み込みまたは保存エラー
   */
  async updateThreadLastActive(threadId: string): Promise<void> {
    const threadInfo = await this.loadThreadInfo(threadId);
    if (threadInfo) {
      threadInfo.lastActiveAt = new Date().toISOString();
      await this.saveThreadInfo(threadInfo);
    }
  }

  /**
   * Claudeセッションログを保存します
   *
   * セッションログはsessions/{thread_id}/{session_id}.jsonに保存されます。
   * ディレクトリが存在しない場合は自動的に作成されます。
   *
   * @param sessionLog - 保存するセッションログ
   * @throws {Deno.errors.PermissionDenied} ファイル書き込み権限がない場合
   */
  async saveSessionLog(sessionLog: SessionLog): Promise<void> {
    const sessionDirPath = this.getSessionDirPath(sessionLog.threadId);
    await ensureDir(sessionDirPath);

    const filePath = this.getSessionFilePath(
      sessionLog.threadId,
      sessionLog.sessionId,
    );
    await Deno.writeTextFile(filePath, JSON.stringify(sessionLog, null, 2));
  }

  /**
   * 指定されたスレッドの全セッションログを読み込みます
   *
   * @param threadId - DiscordスレッドID
   * @returns セッションログの配列（タイムスタンプ順でソート済み）
   * @throws {Error} ファイル読み込みエラー（NotFound以外）
   */
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

  /**
   * 監査ログエントリを追記します
   *
   * 監査ログはaudit/{date}/activity.jsonlにJSONL形式で保存されます。
   * 日付ごとにファイルが分割され、追記モードで書き込まれます。
   *
   * @param auditEntry - 記録する監査ログエントリ
   * @throws {Error} ファイル書き込みエラー
   *
   * @example
   * ```typescript
   * await workspaceManager.appendAuditLog({
   *   timestamp: new Date().toISOString(),
   *   threadId: "123456789",
   *   action: "worker_created",
   *   details: { workerName: "worker-123" }
   * });
   * ```
   */
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

  /**
   * Claude実行の生のJSONL出力を保存します
   *
   * セッションIDが既存の場合は同じファイルに追記し、
   * 新規の場合は新しいファイルを作成します。
   * ファイル名フォーマット: {timestamp}_{session_id}.jsonl
   *
   * @param repositoryFullName - リポジトリのフルネーム（org/repo形式）
   * @param sessionId - ClaudeセッションID
   * @param rawJsonlContent - 保存するJSONL形式のコンテンツ
   * @throws {Error} ファイル書き込みエラー
   */
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

  /**
   * 全てのスレッド情報を取得します
   *
   * @returns 全スレッド情報の配列（最終アクティブ時刻の降順でソート済み）
   * @throws {Error} ディレクトリ読み込みエラー（NotFound以外）
   */
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

  /**
   * スレッド用のGit worktreeを確保します
   *
   * 既にworktreeが存在する場合はそのパスを返し、
   * 存在しない場合は新規作成します。
   *
   * @param threadId - DiscordスレッドID
   * @param repositoryPath - 元となるリポジトリのパス
   * @returns worktreeのパス
   * @throws {Error} worktree作成エラー
   */
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

  /**
   * 指定されたスレッドのworktreeを削除します
   *
   * worktreeが存在しない場合は何もしません。
   * 削除に失敗した場合は警告をログに出力しますが、エラーは投げません。
   *
   * @param threadId - DiscordスレッドID
   */
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

  /**
   * 指定されたスレッドのworktreeをクリーンアップします
   *
   * removeWorktreeと同様の動作ですが、エラー処理が若干異なります。
   * 主にテストやクリーンアップ処理で使用されます。
   *
   * @param threadId - DiscordスレッドID
   */
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

  /**
   * ローカルに存在する全リポジトリのリストを取得します
   *
   * repositories/ディレクトリをスキャンして、
   * org/repo形式のリポジトリ名のリストを返します。
   *
   * @returns リポジトリ名の配列（アルファベット順でソート済み）
   * @throws {Error} ディレクトリ読み込みエラー（NotFound以外）
   *
   * @example
   * ```typescript
   * const repos = await workspaceManager.getLocalRepositories();
   * // => ["facebook/react", "microsoft/vscode", ...]
   * ```
   */
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

  /**
   * リポジトリのPersonal Access Token情報を保存します
   *
   * PATはpats/{org}_{repo}.jsonに保存され、
   * 更新日時が自動的に設定されます。
   * 保存時に監査ログも記録されます。
   *
   * @param patInfo - 保存するPAT情報
   * @throws {Deno.errors.PermissionDenied} ファイル書き込み権限がない場合
   */
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

  /**
   * 指定されたリポジトリのPAT情報を読み込みます
   *
   * @param repositoryFullName - リポジトリのフルネーム（org/repo形式）
   * @returns PAT情報、存在しない場合はnull
   * @throws {Error} ファイル読み込みエラー（NotFound以外）
   */
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

  /**
   * 指定されたリポジトリのPAT情報を削除します
   *
   * 削除時に監査ログも記録されます。
   * PATが存在しない場合はエラーを投げません。
   *
   * @param repositoryFullName - リポジトリのフルネーム（org/repo形式）
   * @throws {Error} ファイル削除エラー（NotFound以外）
   */
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

  /**
   * 保存されている全てのPAT情報のリストを取得します
   *
   * @returns PAT情報の配列（リポジトリ名のアルファベット順でソート済み）
   * @throws {Error} ディレクトリ読み込みエラー（NotFound以外）
   */
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

  /**
   * スレッドのメッセージキューを保存します
   *
   * @param threadQueue - 保存するメッセージキュー
   * @throws {Deno.errors.PermissionDenied} ファイル書き込み権限がない場合
   */
  async saveMessageQueue(threadQueue: ThreadQueue): Promise<void> {
    const filePath = this.getQueueFilePath(threadQueue.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadQueue, null, 2));
  }

  /**
   * 指定されたスレッドのメッセージキューを読み込みます
   *
   * @param threadId - DiscordスレッドID
   * @returns メッセージキュー、存在しない場合はnull
   * @throws {Error} ファイル読み込みエラー（NotFound以外）
   */
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

  /**
   * メッセージをキューに追加します
   *
   * Worker処理中に受信したメッセージを一時的に保存し、
   * 後で処理できるようにします。
   * 追加時に監査ログも記録されます。
   *
   * @param threadId - DiscordスレッドID
   * @param message - キューに追加するメッセージ
   * @throws {Error} ファイル操作エラー
   *
   * @example
   * ```typescript
   * await workspaceManager.addMessageToQueue("123456789", {
   *   messageId: "987654321",
   *   content: "Hello, Claude!",
   *   timestamp: Date.now(),
   *   authorId: "111222333"
   * });
   * ```
   */
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

  /**
   * メッセージキューを取得してクリアします
   *
   * キューに格納されている全メッセージを取得し、
   * その後キューを削除します。
   * 操作は原子的で、取得とクリアが同時に行われます。
   *
   * @param threadId - DiscordスレッドID
   * @returns キューに格納されていたメッセージの配列
   * @throws {Error} ファイル操作エラー
   */
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

  /**
   * 指定されたスレッドのメッセージキューを削除します
   *
   * キューが存在しない場合はエラーを投げません。
   *
   * @param threadId - DiscordスレッドID
   * @throws {Error} ファイル削除エラー（NotFound以外）
   */
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
