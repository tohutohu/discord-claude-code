/**
 * セッション管理クラス
 * セッションの作成、更新、削除、永続化を行う
 */

import { fs, path } from './deps.ts';
import { logger } from './logger.ts';
import {
  CreateSessionOptions,
  isActiveState,
  isTerminalState,
  isValidTransition,
  SessionData,
  SessionEvent,
  SessionEventHandler,
  SessionEventType,
  SessionFilter,
  SessionState,
  SessionStats,
  SessionUpdate,
} from './types/session.ts';

/** セッション永続化ファイルのパス */
const SESSIONS_FILE_PATH = path.join(
  Deno.env.get('HOME') || '~',
  '.claude-bot',
  'sessions.json',
);

/** セッション永続化データの形式 */
interface SessionPersistData {
  sessions: Record<string, SessionData>;
  lastUpdated: string;
  version: string;
}

/**
 * セッション管理クラス
 */
export class SessionManager {
  private sessions = new Map<string, SessionData>();
  private eventHandlers = new Map<SessionEventType, SessionEventHandler[]>();
  private saveTimer?: number;
  private autoRecoveryTimer?: number;

  constructor() {
    // プロセス終了時の自動保存
    Deno.addSignalListener('SIGINT', () => this.saveSync());
    Deno.addSignalListener('SIGTERM', () => this.saveSync());

    // 定期的な自動保存（5分間隔）
    this.saveTimer = setInterval(() => {
      this.save().catch((error) => {
        logger.error('定期保存エラー:', { error: error.message });
      });
    }, 300000);

    // 自動リカバリー（10分間隔）
    this.autoRecoveryTimer = setInterval(() => {
      this.performAutoRecovery().catch((error) => {
        logger.error('自動リカバリーエラー:', { error: error.message });
      });
    }, 600000);
  }

  /**
   * セッション管理を初期化する
   */
  async init(): Promise<void> {
    try {
      await this.load();
      logger.info(`セッションマネージャーを初期化しました（${this.sessions.size}個のセッション）`);

      // 自動リカバリーを実行
      await this.performAutoRecovery();
    } catch (error) {
      logger.error('セッション管理の初期化エラー:', { error: error.message });
      throw error;
    }
  }

  /**
   * 新しいセッションを作成する
   * @param threadId Discord スレッドID
   * @param userId Discord ユーザーID
   * @param guildId Discord ギルドID
   * @param channelId Discord チャンネルID
   * @param options セッション作成オプション
   * @returns 作成されたセッション
   */
  createSession(
    threadId: string,
    userId: string,
    guildId: string,
    channelId: string,
    options: CreateSessionOptions,
  ): Promise<SessionData> {
    // 既存のセッションチェック
    if (this.sessions.has(threadId)) {
      throw new Error(`セッション ${threadId} は既に存在します`);
    }

    const now = new Date();
    const sessionId = this.generateSessionId();

    const session: SessionData = {
      id: sessionId,
      threadId,
      repository: options.repository,
      branch: options.branch,
      state: SessionState.INITIALIZING,
      metadata: {
        userId,
        guildId,
        channelId,
        createdAt: now,
        updatedAt: now,
        priority: options.priority ?? 5,
      },
    };

    this.sessions.set(threadId, session);

    // イベント発行
    this.emitEvent({
      type: SessionEventType.CREATED,
      sessionId: session.id,
      session,
    });

    logger.info('セッションを作成しました', {
      sessionId,
      threadId,
      repository: options.repository,
      userId,
    });

    // 非同期で保存
    this.save().catch((error) => {
      logger.error('セッション保存エラー:', { error: error.message });
    });

    return session;
  }

  /**
   * セッションを更新する
   * @param threadId スレッドID
   * @param update 更新データ
   * @returns 更新されたセッション
   */
  updateSession(threadId: string, update: SessionUpdate): SessionData {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`セッション ${threadId} が見つかりません`);
    }

    const previousState = session.state;

    // 状態遷移の検証
    if (update.state && update.state !== session.state) {
      if (!isValidTransition(session.state, update.state)) {
        throw new Error(
          `無効な状態遷移: ${session.state} -> ${update.state}`,
        );
      }
      session.state = update.state;
    }

    // その他のフィールドを更新
    if (update.error !== undefined) {
      session.error = update.error;
    }
    if (update.worktreePath !== undefined) {
      session.worktreePath = update.worktreePath;
    }
    if (update.containerId !== undefined) {
      session.containerId = update.containerId;
    }

    // ログの更新
    if (update.clearLogs) {
      session.logs = [];
    }
    if (update.addLogs && update.addLogs.length > 0) {
      session.logs = session.logs || [];
      session.logs.push(...update.addLogs);
      // ログは最新100件まで保持
      if (session.logs.length > 100) {
        session.logs = session.logs.slice(-100);
      }
    }

    session.metadata.updatedAt = new Date();

    // イベント発行
    this.emitEvent({
      type: SessionEventType.UPDATED,
      sessionId: session.id,
      session,
      previousState: update.state ? previousState : undefined,
    });

    if (update.state && update.state !== previousState) {
      this.emitEvent({
        type: SessionEventType.STATE_CHANGED,
        sessionId: session.id,
        session,
        previousState,
      });
    }

    if (update.addLogs && update.addLogs.length > 0) {
      this.emitEvent({
        type: SessionEventType.LOG_ADDED,
        sessionId: session.id,
        session,
        data: { logs: update.addLogs },
      });
    }

    if (update.error) {
      this.emitEvent({
        type: SessionEventType.ERROR_OCCURRED,
        sessionId: session.id,
        session,
        data: { error: update.error },
      });
    }

    logger.debug('セッションを更新しました', {
      sessionId: session.id,
      threadId,
      previousState,
      newState: session.state,
    });

    // 非同期で保存
    this.save().catch((error) => {
      logger.error('セッション保存エラー:', { error: error.message });
    });

    return session;
  }

  /**
   * セッションを削除する
   * @param threadId スレッドID
   */
  deleteSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`セッション ${threadId} が見つかりません`);
    }

    this.sessions.delete(threadId);

    // イベント発行
    this.emitEvent({
      type: SessionEventType.DELETED,
      sessionId: session.id,
      session,
    });

    logger.info('セッションを削除しました', {
      sessionId: session.id,
      threadId,
    });

    // 非同期で保存
    this.save().catch((error) => {
      logger.error('セッション保存エラー:', { error: error.message });
    });
  }

  /**
   * セッションを取得する
   * @param threadId スレッドID
   * @returns セッション（見つからない場合はundefined）
   */
  getSession(threadId: string): SessionData | undefined {
    return this.sessions.get(threadId);
  }

  /**
   * すべてのセッションを取得する
   * @param filter フィルター条件
   * @returns セッション配列
   */
  getAllSessions(filter?: SessionFilter): SessionData[] {
    let sessions = Array.from(this.sessions.values());

    if (filter) {
      if (filter.states) {
        sessions = sessions.filter((s) => filter.states!.includes(s.state));
      }
      if (filter.userId) {
        sessions = sessions.filter((s) => s.metadata.userId === filter.userId);
      }
      if (filter.repository) {
        sessions = sessions.filter((s) => s.repository === filter.repository);
      }
      if (filter.createdAfter) {
        sessions = sessions.filter((s) => s.metadata.createdAt >= filter.createdAfter!);
      }
      if (filter.createdBefore) {
        sessions = sessions.filter((s) => s.metadata.createdAt <= filter.createdBefore!);
      }
    }

    // 作成日時の降順でソート
    return sessions.sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime());
  }

  /**
   * アクティブなセッションを取得する
   * @returns アクティブなセッション配列
   */
  getActiveSessions(): SessionData[] {
    return this.getAllSessions({
      states: [
        SessionState.INITIALIZING,
        SessionState.STARTING,
        SessionState.READY,
        SessionState.RUNNING,
        SessionState.WAITING,
      ],
    });
  }

  /**
   * セッション統計を取得する
   * @returns 統計情報
   */
  getStats(): SessionStats {
    const sessions = Array.from(this.sessions.values());
    const byState: Record<SessionState, number> = {} as Record<SessionState, number>;

    // 状態別カウント初期化
    Object.values(SessionState).forEach((state) => {
      byState[state] = 0;
    });

    // 統計計算
    let totalDuration = 0;
    let completedCount = 0;
    let errorCount = 0;

    for (const session of sessions) {
      byState[session.state]++;

      if (session.state === SessionState.ERROR) {
        errorCount++;
      }

      if (session.state === SessionState.COMPLETED) {
        completedCount++;
        const duration = session.metadata.updatedAt.getTime() -
          session.metadata.createdAt.getTime();
        totalDuration += duration;
      }
    }

    const active = byState[SessionState.INITIALIZING] +
      byState[SessionState.STARTING] +
      byState[SessionState.READY] +
      byState[SessionState.RUNNING] +
      byState[SessionState.WAITING];

    return {
      total: sessions.length,
      byState,
      active,
      avgDuration: completedCount > 0 ? totalDuration / completedCount / 60000 : undefined, // 分
      errorRate: sessions.length > 0 ? (errorCount / sessions.length) * 100 : 0,
    };
  }

  /**
   * イベントハンドラを登録する
   * @param eventType イベントタイプ
   * @param handler ハンドラ関数
   */
  on(eventType: SessionEventType, handler: SessionEventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * イベントハンドラを削除する
   * @param eventType イベントタイプ
   * @param handler ハンドラ関数
   */
  off(eventType: SessionEventType, handler: SessionEventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * セッションデータを保存する
   */
  async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(SESSIONS_FILE_PATH));

      const data: SessionPersistData = {
        sessions: Object.fromEntries(this.sessions),
        lastUpdated: new Date().toISOString(),
        version: '1.0.0',
      };

      await Deno.writeTextFile(SESSIONS_FILE_PATH, JSON.stringify(data, null, 2));
      logger.trace(`セッションデータを保存しました: ${SESSIONS_FILE_PATH}`);
    } catch (error) {
      logger.error('セッションデータ保存エラー:', { error: error.message });
      throw error;
    }
  }

  /**
   * セッションデータを同期的に保存する（プロセス終了時用）
   */
  private saveSync(): void {
    try {
      const data: SessionPersistData = {
        sessions: Object.fromEntries(this.sessions),
        lastUpdated: new Date().toISOString(),
        version: '1.0.0',
      };

      Deno.writeTextFileSync(SESSIONS_FILE_PATH, JSON.stringify(data, null, 2));
      logger.info('セッションデータを同期保存しました');
    } catch (error) {
      console.error('セッションデータ同期保存エラー:', error);
    }
  }

  /**
   * セッションデータを読み込む
   */
  private async load(): Promise<void> {
    try {
      if (!await fs.exists(SESSIONS_FILE_PATH)) {
        logger.info('セッションファイルが存在しません。新規作成します。');
        return;
      }

      const content = await Deno.readTextFile(SESSIONS_FILE_PATH);
      const data: SessionPersistData = JSON.parse(content);

      // データの復元
      for (const [threadId, sessionData] of Object.entries(data.sessions)) {
        // 日付の復元
        sessionData.metadata.createdAt = new Date(sessionData.metadata.createdAt);
        sessionData.metadata.updatedAt = new Date(sessionData.metadata.updatedAt);

        this.sessions.set(threadId, sessionData);
      }

      logger.info(`セッションデータを読み込みました: ${this.sessions.size}個`);
    } catch (error) {
      logger.error('セッションデータ読み込みエラー:', { error: error.message });
      throw error;
    }
  }

  /**
   * 自動リカバリーを実行する
   */
  private async performAutoRecovery(): Promise<void> {
    const activeSessions = this.getActiveSessions();
    let recoveredCount = 0;

    for (const session of activeSessions) {
      try {
        // 長時間 INITIALIZING 状態のセッションをエラーに遷移
        if (session.state === SessionState.INITIALIZING) {
          const duration = Date.now() - session.metadata.createdAt.getTime();
          if (duration > 600000) { // 10分
            await this.updateSession(session.threadId, {
              state: SessionState.ERROR,
              error: '初期化がタイムアウトしました',
            });
            recoveredCount++;
          }
        }

        // 長時間 STARTING 状態のセッションをエラーに遷移
        if (session.state === SessionState.STARTING) {
          const duration = Date.now() - session.metadata.updatedAt.getTime();
          if (duration > 900000) { // 15分
            await this.updateSession(session.threadId, {
              state: SessionState.ERROR,
              error: 'コンテナ起動がタイムアウトしました',
            });
            recoveredCount++;
          }
        }

        // 長時間 RUNNING 状態のセッションを確認
        if (session.state === SessionState.RUNNING) {
          const duration = Date.now() - session.metadata.updatedAt.getTime();
          if (duration > 3600000) { // 1時間
            logger.warn('長時間実行中のセッションを検出:', {
              sessionId: session.id,
              threadId: session.threadId,
              duration: `${Math.floor(duration / 60000)}分`,
            });
          }
        }
      } catch (error) {
        logger.error('セッションリカバリーエラー:', {
          sessionId: session.id,
          error: error.message,
        });
      }
    }

    if (recoveredCount > 0) {
      logger.info(`自動リカバリーを実行しました: ${recoveredCount}個のセッション`);
    }
  }

  /**
   * セッションIDを生成する
   * @returns 一意のセッションID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * イベントを発行する
   * @param event セッションイベント
   */
  private emitEvent(event: SessionEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          logger.error('セッションイベントハンドラエラー:', {
            eventType: event.type,
            sessionId: event.sessionId,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * リソースをクリーンアップする
   */
  async cleanup(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    if (this.autoRecoveryTimer) {
      clearInterval(this.autoRecoveryTimer);
    }

    await this.save();
    logger.info('セッションマネージャーをクリーンアップしました');
  }
}

// シングルトンインスタンス
export const sessionManager = new SessionManager();
