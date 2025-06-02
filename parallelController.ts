/**
 * 並列実行制御とキューイング管理
 * @cli 並列Claude実行の制御
 */

import { SessionData, SessionState } from './types/session.ts';
import { Config } from './types/config.ts';
import { logger } from './logger.ts';

/** キューエントリ */
interface QueueEntry {
  /** セッションID */
  sessionId: string;
  /** 優先度（1が最高優先度） */
  priority: number;
  /** キューに入った時刻 */
  queuedAt: Date;
  /** 実行開始のコールバック */
  resolve: () => void;
  /** タイムアウト時のコールバック */
  reject: (error: Error) => void;
  /** タイムアウトハンドラ */
  timeoutHandle?: number;
}

/** デッドロック検出用のセッション状態 */
interface SessionContext {
  sessionId: string;
  state: SessionState;
  queuedAt?: Date;
  startedAt?: Date;
  dependencies: string[]; // 依存しているセッションID
}

/** 並列制御イベント */
export enum ParallelEventType {
  SESSION_QUEUED = 'sessionQueued',
  SESSION_STARTED = 'sessionStarted',
  SESSION_COMPLETED = 'sessionCompleted',
  SESSION_TIMEOUT = 'sessionTimeout',
  DEADLOCK_DETECTED = 'deadlockDetected',
  QUEUE_STATUS_CHANGED = 'queueStatusChanged',
}

/** 並列制御イベントデータ */
export interface ParallelEvent {
  type: ParallelEventType;
  sessionId: string;
  data?: Record<string, unknown>;
}

/** 並列制御イベントハンドラ */
export type ParallelEventHandler = (event: ParallelEvent) => void;

/** キュー統計情報 */
export interface QueueStats {
  /** 実行中のセッション数 */
  running: number;
  /** 待機中のセッション数 */
  waiting: number;
  /** 最大並列数 */
  maxSessions: number;
  /** 平均待機時間（秒） */
  avgWaitTime: number;
  /** 最長待機時間（秒） */
  maxWaitTime: number;
}

/**
 * 並列実行制御クラス
 * セマフォアによる並列実行制限とプライオリティキューによる待機管理を行う
 */
export class ParallelController {
  private config: Config;
  private runningCount = 0;
  private queue: QueueEntry[] = [];
  private eventHandlers = new Map<ParallelEventType, ParallelEventHandler[]>();
  private sessionContexts = new Map<string, SessionContext>();
  private deadlockCheckInterval?: number;

  constructor(config: Config) {
    this.config = config;
    this.startDeadlockDetection();
  }

  /**
   * セッションの実行を要求する
   * 空きがある場合は即座に実行、そうでなければキューに追加
   * @param sessionId セッションID
   * @param priority 優先度（1が最高優先度、デフォルト10）
   * @param dependencies 依存するセッションIDのリスト
   * @returns 実行開始を待つPromise
   */
  async requestExecution(
    sessionId: string,
    priority = 10,
    dependencies: string[] = [],
  ): Promise<void> {
    logger.info(`並列実行要求: ${sessionId}, 優先度: ${priority}`, { sessionId, priority });

    // セッションコンテキストを記録
    this.sessionContexts.set(sessionId, {
      sessionId,
      state: SessionState.WAITING,
      queuedAt: new Date(),
      dependencies,
    });

    // 依存関係チェック
    if (dependencies.length > 0) {
      const unresolved = dependencies.filter((depId) => {
        const context = this.sessionContexts.get(depId);
        return context && context.state !== SessionState.COMPLETED;
      });

      if (unresolved.length > 0) {
        logger.warn(`セッション ${sessionId} は依存関係待ち: ${unresolved.join(', ')}`);
        this.emitEvent({
          type: ParallelEventType.SESSION_QUEUED,
          sessionId,
          data: { reason: 'dependencies', unresolved },
        });
      }
    }

    // 実行枠が空いている場合は即座に実行
    if (this.runningCount < this.config.parallel.maxSessions && this.canExecute(sessionId)) {
      await this.startExecution(sessionId);
      return;
    }

    // キューに追加
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        sessionId,
        priority,
        queuedAt: new Date(),
        resolve,
        reject,
      };

      // タイムアウト設定
      if (this.config.parallel.queueTimeout > 0) {
        entry.timeoutHandle = setTimeout(() => {
          this.removeFromQueue(sessionId);
          const error = new Error(`キュー待機タイムアウト: ${this.config.parallel.queueTimeout}秒`);
          this.emitEvent({
            type: ParallelEventType.SESSION_TIMEOUT,
            sessionId,
            data: { timeout: this.config.parallel.queueTimeout },
          });
          reject(error);
        }, this.config.parallel.queueTimeout * 1000);
      }

      // 優先度順で挿入
      this.insertToQueue(entry);

      this.emitEvent({
        type: ParallelEventType.SESSION_QUEUED,
        sessionId,
        data: { priority, position: this.getQueuePosition(sessionId) },
      });

      logger.debug(
        `セッション ${sessionId} をキューに追加 (位置: ${this.getQueuePosition(sessionId)})`,
      );
    });
  }

  /**
   * セッションの実行完了を通知
   * @param sessionId セッションID
   */
  async completeExecution(sessionId: string): Promise<void> {
    logger.info(`実行完了: ${sessionId}`, { sessionId });

    // 実行中カウントを減らす
    if (this.runningCount > 0) {
      this.runningCount--;
    }

    // セッションコンテキストを更新
    const context = this.sessionContexts.get(sessionId);
    if (context) {
      context.state = SessionState.COMPLETED;
    }

    this.emitEvent({
      type: ParallelEventType.SESSION_COMPLETED,
      sessionId,
      data: { runningCount: this.runningCount },
    });

    // 次のセッションを開始
    await this.processQueue();
  }

  /**
   * セッションの実行をキャンセル
   * @param sessionId セッションID
   */
  async cancelExecution(sessionId: string): Promise<void> {
    logger.info(`実行キャンセル: ${sessionId}`, { sessionId });

    // キューから削除
    this.removeFromQueue(sessionId);

    // 実行中の場合はカウントを減らす
    const context = this.sessionContexts.get(sessionId);
    if (context && context.state === SessionState.RUNNING) {
      this.runningCount--;
    }

    // セッションコンテキストを削除
    this.sessionContexts.delete(sessionId);

    // 次のセッションを開始
    await this.processQueue();
  }

  /**
   * キューの状況を取得
   * @returns キュー統計情報
   */
  getQueueStats(): QueueStats {
    const now = new Date();
    const waitTimes = this.queue.map((entry) => (now.getTime() - entry.queuedAt.getTime()) / 1000);

    return {
      running: this.runningCount,
      waiting: this.queue.length,
      maxSessions: this.config.parallel.maxSessions,
      avgWaitTime: waitTimes.length > 0
        ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
        : 0,
      maxWaitTime: waitTimes.length > 0 ? Math.max(...waitTimes) : 0,
    };
  }

  /**
   * セッションのキュー内位置を取得
   * @param sessionId セッションID
   * @returns キュー内位置（1-indexed、キューにない場合は-1）
   */
  getQueuePosition(sessionId: string): number {
    const index = this.queue.findIndex((entry) => entry.sessionId === sessionId);
    return index >= 0 ? index + 1 : -1;
  }

  /**
   * イベントハンドラを登録
   * @param type イベントタイプ
   * @param handler ハンドラ関数
   */
  on(type: ParallelEventType, handler: ParallelEventHandler): void {
    const handlers = this.eventHandlers.get(type) || [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);
  }

  /**
   * イベントハンドラを削除
   * @param type イベントタイプ
   * @param handler ハンドラ関数
   */
  off(type: ParallelEventType, handler: ParallelEventHandler): void {
    const handlers = this.eventHandlers.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
      this.eventHandlers.set(type, handlers);
    }
  }

  /**
   * リソースを解放
   */
  dispose(): void {
    // デッドロック検出を停止
    if (this.deadlockCheckInterval) {
      clearInterval(this.deadlockCheckInterval);
    }

    // 全てのキューエントリのタイムアウトをクリア
    this.queue.forEach((entry) => {
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
    });

    // キューをクリア
    this.queue.length = 0;
    this.sessionContexts.clear();
    this.eventHandlers.clear();
  }

  /**
   * セッションが実行可能かどうかを判定
   * @param sessionId セッションID
   * @returns 実行可能かどうか
   */
  private canExecute(sessionId: string): boolean {
    const context = this.sessionContexts.get(sessionId);
    if (!context) return false;

    // 依存関係がすべて完了しているかチェック
    return context.dependencies.every((depId) => {
      const depContext = this.sessionContexts.get(depId);
      return !depContext || depContext.state === SessionState.COMPLETED;
    });
  }

  /**
   * セッションの実行を開始
   * @param sessionId セッションID
   */
  private startExecution(sessionId: string): void {
    this.runningCount++;

    // セッションコンテキストを更新
    const context = this.sessionContexts.get(sessionId);
    if (context) {
      context.state = SessionState.RUNNING;
      context.startedAt = new Date();
    }

    this.emitEvent({
      type: ParallelEventType.SESSION_STARTED,
      sessionId,
      data: { runningCount: this.runningCount },
    });

    logger.info(
      `セッション実行開始: ${sessionId} (実行中: ${this.runningCount}/${this.config.parallel.maxSessions})`,
    );
  }

  /**
   * キューを処理して次のセッションを開始
   */
  private async processQueue(): Promise<void> {
    // 実行枠がない場合は何もしない
    if (this.runningCount >= this.config.parallel.maxSessions) {
      return;
    }

    // 実行可能なセッションを探す
    const executableIndex = this.queue.findIndex((entry) => this.canExecute(entry.sessionId));
    if (executableIndex < 0) {
      return;
    }

    // キューから取り出して実行
    const entry = this.queue.splice(executableIndex, 1)[0];
    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
    }

    await this.startExecution(entry.sessionId);
    entry.resolve();

    this.emitEvent({
      type: ParallelEventType.QUEUE_STATUS_CHANGED,
      sessionId: entry.sessionId,
      data: this.getQueueStats(),
    });

    // 再帰的に次のセッションも処理
    await this.processQueue();
  }

  /**
   * 優先度順でキューに挿入
   * @param entry キューエントリ
   */
  private insertToQueue(entry: QueueEntry): void {
    const insertIndex = this.queue.findIndex((existing) => existing.priority > entry.priority);
    if (insertIndex >= 0) {
      this.queue.splice(insertIndex, 0, entry);
    } else {
      this.queue.push(entry);
    }
  }

  /**
   * キューからセッションを削除
   * @param sessionId セッションID
   */
  private removeFromQueue(sessionId: string): void {
    const index = this.queue.findIndex((entry) => entry.sessionId === sessionId);
    if (index >= 0) {
      const entry = this.queue.splice(index, 1)[0];
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
    }
  }

  /**
   * イベントを発火
   * @param event イベントデータ
   */
  private emitEvent(event: ParallelEvent): void {
    const handlers = this.eventHandlers.get(event.type) || [];
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        logger.error(`並列制御イベントハンドラエラー: ${error}`, { event, error });
      }
    });
  }

  /**
   * デッドロック検出を開始
   */
  private startDeadlockDetection(): void {
    // 30秒ごとにデッドロック検出を実行
    this.deadlockCheckInterval = setInterval(() => {
      this.detectDeadlocks();
    }, 30000);
  }

  /**
   * デッドロックを検出
   */
  private detectDeadlocks(): void {
    const waitingSessions = Array.from(this.sessionContexts.values())
      .filter((context) => context.state === SessionState.WAITING);

    for (const session of waitingSessions) {
      if (this.hasCircularDependency(session.sessionId, new Set())) {
        logger.error(`デッドロック検出: ${session.sessionId}`, { sessionId: session.sessionId });

        this.emitEvent({
          type: ParallelEventType.DEADLOCK_DETECTED,
          sessionId: session.sessionId,
          data: { dependencies: session.dependencies },
        });

        // デッドロックを解決（最も古い依存関係を削除）
        this.resolveDeadlock(session.sessionId);
      }
    }
  }

  /**
   * 循環依存関係をチェック
   * @param sessionId セッションID
   * @param visited 訪問済みセッションのSet
   * @returns 循環依存があるかどうか
   */
  private hasCircularDependency(sessionId: string, visited: Set<string>): boolean {
    if (visited.has(sessionId)) {
      return true; // 循環を検出
    }

    const context = this.sessionContexts.get(sessionId);
    if (!context) return false;

    visited.add(sessionId);

    for (const depId of context.dependencies) {
      const depContext = this.sessionContexts.get(depId);
      if (depContext && depContext.state === SessionState.WAITING) {
        if (this.hasCircularDependency(depId, new Set(visited))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * デッドロックを解決
   * @param sessionId セッションID
   */
  private resolveDeadlock(sessionId: string): void {
    const context = this.sessionContexts.get(sessionId);
    if (!context) return;

    // 最も古い依存関係を削除
    if (context.dependencies.length > 0) {
      const oldestDep = context.dependencies.reduce((oldest, depId) => {
        const depContext = this.sessionContexts.get(depId);
        const oldestContext = this.sessionContexts.get(oldest);
        if (!depContext || !oldestContext) return oldest;

        return (depContext.queuedAt?.getTime() || 0) < (oldestContext.queuedAt?.getTime() || 0)
          ? depId
          : oldest;
      });

      context.dependencies = context.dependencies.filter((depId) => depId !== oldestDep);
      logger.warn(`デッドロック解決: ${sessionId} から依存関係 ${oldestDep} を削除`);

      // 実行可能になった場合はキューを処理
      this.processQueue();
    }
  }
}

// テスト @parallel
Deno.test('ParallelController - 基本的なセマフォア制御', async () => {
  const config = {
    parallel: { maxSessions: 2, queueTimeout: 10 },
  } as Config;

  const controller = new ParallelController(config);

  let startedCount = 0;
  controller.on(ParallelEventType.SESSION_STARTED, () => startedCount++);

  // 3つのセッションを要求（2つは即座に開始、1つはキュー待ち）
  const promises = [
    controller.requestExecution('session1'),
    controller.requestExecution('session2'),
    controller.requestExecution('session3'),
  ];

  // 少し待って最初の2つが開始されることを確認
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertEquals(startedCount, 2);
  assertEquals(controller.getQueueStats().running, 2);
  assertEquals(controller.getQueueStats().waiting, 1);

  // 1つのセッションを完了
  await controller.completeExecution('session1');

  // 3つ目のセッションが開始されることを確認
  await Promise.all(promises);
  assertEquals(startedCount, 3);

  controller.dispose();
});

Deno.test('ParallelController - 優先度キュー', async () => {
  const config = {
    parallel: { maxSessions: 1, queueTimeout: 10 },
  } as Config;

  const controller = new ParallelController(config);

  const startOrder: string[] = [];
  controller.on(ParallelEventType.SESSION_STARTED, (event) => {
    startOrder.push(event.sessionId);
  });

  // 最初のセッションを開始
  const promise1 = controller.requestExecution('session1', 10);

  // 優先度の異なるセッションをキューに追加
  const promise2 = controller.requestExecution('session2', 5); // 高優先度
  const promise3 = controller.requestExecution('session3', 15); // 低優先度

  // 少し待ってから最初のセッションを完了
  await new Promise((resolve) => setTimeout(resolve, 100));
  await controller.completeExecution('session1');

  await Promise.all([promise1, promise2, promise3]);

  // 優先度順で実行されることを確認
  assertEquals(startOrder, ['session1', 'session2', 'session3']);

  controller.dispose();
});

Deno.test('ParallelController - キューポジション取得', async () => {
  const config = {
    parallel: { maxSessions: 1, queueTimeout: 10 },
  } as Config;

  const controller = new ParallelController(config);

  // 最初のセッションを開始
  await controller.requestExecution('session1');

  // 3つのセッションをキューに追加
  controller.requestExecution('session2');
  controller.requestExecution('session3');
  controller.requestExecution('session4');

  assertEquals(controller.getQueuePosition('session1'), -1); // 実行中
  assertEquals(controller.getQueuePosition('session2'), 1);
  assertEquals(controller.getQueuePosition('session3'), 2);
  assertEquals(controller.getQueuePosition('session4'), 3);

  controller.dispose();
});

Deno.test('ParallelController - デッドロック検出', () => {
  const config = {
    parallel: { maxSessions: 1, queueTimeout: 30 },
  } as Config;

  const controller = new ParallelController(config);

  let deadlockDetected = false;
  controller.on(ParallelEventType.DEADLOCK_DETECTED, () => {
    deadlockDetected = true;
  });

  // 循環依存を作成
  controller.requestExecution('session1', 10, ['session2']);
  controller.requestExecution('session2', 10, ['session1']);

  // デッドロック検出を手動で実行
  // Private method access for testing
  (controller as unknown as { detectDeadlocks(): void }).detectDeadlocks();

  assertEquals(deadlockDetected, true);

  controller.dispose();
});
