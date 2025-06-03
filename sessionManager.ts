// セッション管理機能
// Discord スレッドとリポジトリの Worktree、DevContainer を対応管理し、
// セッションの状態遷移とライフサイクルを厳密に管理する

import { exists, resolve } from './deps.ts';
import { SessionState } from './types/discord.ts';
import type { SessionInfo, SessionStorage } from './types/discord.ts';

/**
 * セッション状態変更イベント
 */
export interface SessionStateChangeEvent {
  /** セッションID */
  sessionId: string;
  /** 変更前の状態 */
  oldState: SessionState;
  /** 変更後の状態 */
  newState: SessionState;
  /** 変更時刻 */
  timestamp: Date;
  /** 追加データ */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * セッション作成イベント
 */
export interface SessionCreatedEvent {
  /** セッション情報 */
  session: SessionInfo;
  /** 作成時刻 */
  timestamp: Date;
}

/**
 * セッション削除イベント
 */
export interface SessionRemovedEvent {
  /** セッションID */
  sessionId: string;
  /** セッション情報（削除前） */
  session: SessionInfo;
  /** 削除時刻 */
  timestamp: Date;
}

/**
 * セッションエラーイベント
 */
export interface SessionErrorEvent {
  /** セッションID */
  sessionId: string;
  /** エラー内容 */
  error: Error;
  /** エラー発生時刻 */
  timestamp: Date;
}

/**
 * セッション管理のイベントタイプ
 */
export type SessionManagerEvent =
  | { type: 'stateChange'; data: SessionStateChangeEvent }
  | { type: 'sessionCreated'; data: SessionCreatedEvent }
  | { type: 'sessionRemoved'; data: SessionRemovedEvent }
  | { type: 'sessionError'; data: SessionErrorEvent };

/**
 * セッション状態遷移の妥当性を検証
 */
function isValidStateTransition(from: SessionState, to: SessionState): boolean {
  const validTransitions: Record<SessionState, SessionState[]> = {
    [SessionState.INITIALIZING]: [
      SessionState.STARTING,
      SessionState.ERROR,
      SessionState.CANCELLED,
    ],
    [SessionState.STARTING]: [SessionState.READY, SessionState.ERROR, SessionState.CANCELLED],
    [SessionState.READY]: [
      SessionState.RUNNING,
      SessionState.WAITING,
      SessionState.ERROR,
      SessionState.CANCELLED,
    ],
    [SessionState.RUNNING]: [SessionState.COMPLETED, SessionState.ERROR, SessionState.CANCELLED],
    [SessionState.WAITING]: [SessionState.RUNNING, SessionState.ERROR, SessionState.CANCELLED],
    [SessionState.ERROR]: [SessionState.CANCELLED],
    [SessionState.COMPLETED]: [],
    [SessionState.CANCELLED]: [],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * セッション管理クラス
 * Discord スレッドとリポジトリセッションのライフサイクルを管理
 */
export class SessionManager extends EventTarget {
  private sessions: Map<string, SessionInfo> = new Map();
  private storageFilePath: string;
  private recoveryInterval: number | undefined;

  constructor(storageFilePath: string = '~/.claude-bot/sessions.json') {
    super();
    this.storageFilePath = resolve(storageFilePath);
    this.startAutoRecovery();
  }

  /**
   * セッション作成
   */
  async createSession(
    threadId: string,
    repository: string,
    worktreePath: string,
    metadata: {
      userId: string;
      guildId: string;
    },
  ): Promise<SessionInfo> {
    if (this.sessions.has(threadId)) {
      throw new Error(`セッション ${threadId} は既に存在します`);
    }

    const now = new Date();
    const session: SessionInfo = {
      threadId,
      repository,
      worktreePath,
      state: SessionState.INITIALIZING,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata: {
        userId: metadata.userId,
        guildId: metadata.guildId,
        startedAt: now,
        updatedAt: now,
      },
    };

    this.sessions.set(threadId, session);
    await this.persistSessions();

    // セッション作成イベントを発火
    this.dispatchEvent(
      new CustomEvent('session-created', {
        detail: {
          type: 'sessionCreated',
          data: {
            session,
            timestamp: now,
          },
        } satisfies SessionManagerEvent,
      }),
    );

    return session;
  }

  /**
   * セッション状態変更
   */
  async changeSessionState(
    threadId: string,
    newState: SessionState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`セッション ${threadId} が見つかりません`);
    }

    const oldState = session.state;

    // 状態遷移の妥当性を検証
    if (!isValidStateTransition(oldState, newState)) {
      throw new Error(
        `不正な状態遷移: ${oldState} -> ${newState} (セッション: ${threadId})`,
      );
    }

    const now = new Date();
    session.state = newState;
    session.updatedAt = now.toISOString();
    session.metadata.updatedAt = now;

    this.sessions.set(threadId, session);
    await this.persistSessions();

    // 状態変更イベントを発火
    this.dispatchEvent(
      new CustomEvent('session-state-change', {
        detail: {
          type: 'stateChange',
          data: {
            sessionId: threadId,
            oldState,
            newState,
            timestamp: now,
            ...(metadata && { metadata }),
          },
        } satisfies SessionManagerEvent,
      }),
    );
  }

  /**
   * セッション取得
   */
  getSession(threadId: string): SessionInfo | undefined {
    return this.sessions.get(threadId);
  }

  /**
   * 全セッション取得
   */
  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * アクティブセッション取得
   */
  getActiveSessions(): SessionInfo[] {
    return this.getAllSessions().filter((session) =>
      ![SessionState.COMPLETED, SessionState.CANCELLED, SessionState.ERROR].includes(session.state)
    );
  }

  /**
   * セッション削除
   */
  async removeSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) {
      return;
    }

    this.sessions.delete(threadId);
    await this.persistSessions();

    // セッション削除イベントを発火
    this.dispatchEvent(
      new CustomEvent('session-removed', {
        detail: {
          type: 'sessionRemoved',
          data: {
            sessionId: threadId,
            session,
            timestamp: new Date(),
          },
        } satisfies SessionManagerEvent,
      }),
    );
  }

  /**
   * セッションのコンテナIDを更新
   */
  async updateContainerId(threadId: string, containerId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`セッション ${threadId} が見つかりません`);
    }

    session.containerId = containerId;
    session.updatedAt = new Date().toISOString();
    session.metadata.updatedAt = new Date();

    this.sessions.set(threadId, session);
    await this.persistSessions();
  }

  /**
   * セッションデータを永続化
   */
  private async persistSessions(): Promise<void> {
    try {
      const sessionStorage: SessionStorage = {
        sessions: Object.fromEntries(this.sessions),
      };

      const storageDir = this.storageFilePath.replace(/\/[^/]*$/, '');
      const dirExists = await exists(storageDir);
      if (!dirExists) {
        await Deno.mkdir(storageDir, { recursive: true });
      }

      await Deno.writeTextFile(
        this.storageFilePath,
        JSON.stringify(sessionStorage, null, 2),
      );
    } catch (error) {
      const errorEvent = new CustomEvent('session-error', {
        detail: {
          type: 'sessionError',
          data: {
            sessionId: 'system',
            error: error instanceof Error ? error : new Error(String(error)),
            timestamp: new Date(),
          },
        } satisfies SessionManagerEvent,
      });
      this.dispatchEvent(errorEvent);
    }
  }

  /**
   * セッションデータを復元
   */
  async loadSessions(): Promise<void> {
    try {
      const fileExists = await exists(this.storageFilePath);
      if (!fileExists) {
        return;
      }

      const content = await Deno.readTextFile(this.storageFilePath);
      const sessionStorage: SessionStorage = JSON.parse(content);

      this.sessions.clear();
      for (const [threadId, session] of Object.entries(sessionStorage.sessions)) {
        this.sessions.set(threadId, session);
      }
    } catch (error) {
      console.error('セッションデータの復元に失敗しました:', error);
    }
  }

  /**
   * 自動リカバリー機能を開始
   * 実行中状態で停止しているセッションを検出し、エラー状態に変更
   */
  private startAutoRecovery(): void {
    // 5分間隔でリカバリーチェックを実行
    this.recoveryInterval = setInterval(async () => {
      await this.performRecovery();
    }, 5 * 60 * 1000);
  }

  /**
   * リカバリー処理を実行
   */
  private async performRecovery(): Promise<void> {
    const activeSessions = this.getActiveSessions();
    const now = new Date();

    for (const session of activeSessions) {
      const updatedAt = new Date(session.updatedAt);
      const timeSinceUpdate = now.getTime() - updatedAt.getTime();

      // 30分間更新されていない実行中セッションをエラー状態に変更
      if (session.state === SessionState.RUNNING && timeSinceUpdate > 30 * 60 * 1000) {
        try {
          await this.changeSessionState(
            session.threadId,
            SessionState.ERROR,
            { recoveryReason: 'タイムアウトによる自動リカバリー' },
          );
        } catch (error) {
          console.error(`セッション ${session.threadId} のリカバリーに失敗:`, error);
        }
      }

      // 1時間以上初期化中の場合もエラー状態に変更
      if (
        (session.state === SessionState.INITIALIZING || session.state === SessionState.STARTING) &&
        timeSinceUpdate > 60 * 60 * 1000
      ) {
        try {
          await this.changeSessionState(
            session.threadId,
            SessionState.ERROR,
            { recoveryReason: '初期化タイムアウトによる自動リカバリー' },
          );
        } catch (error) {
          console.error(`セッション ${session.threadId} のリカバリーに失敗:`, error);
        }
      }
    }
  }

  /**
   * 自動リカバリーを停止
   */
  stopAutoRecovery(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = undefined;
    }
  }

  /**
   * リソースクリーンアップ
   */
  async dispose(): Promise<void> {
    this.stopAutoRecovery();
    await this.persistSessions();
  }
}

/**
 * セッション管理のシングルトンインスタンス
 */
let sessionManagerInstance: SessionManager | undefined;

/**
 * セッション管理インスタンスを取得
 */
export function getSessionManager(storageFilePath?: string): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(storageFilePath);
  }
  return sessionManagerInstance;
}

/**
 * セッション管理インスタンスを初期化
 */
export async function initializeSessionManager(storageFilePath?: string): Promise<SessionManager> {
  const manager = getSessionManager(storageFilePath);
  await manager.loadSessions();
  return manager;
}

/**
 * セッション管理インスタンスを破棄
 */
export async function disposeSessionManager(): Promise<void> {
  if (sessionManagerInstance) {
    await sessionManagerInstance.dispose();
    sessionManagerInstance = undefined;
  }
}
