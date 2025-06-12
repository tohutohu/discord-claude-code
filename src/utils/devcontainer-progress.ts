/**
 * Devcontainerの進捗状況を管理するためのユーティリティ
 */

/** 進捗状況を通知するコールバック関数の型 */
export type ProgressCallback = (
  message: string,
  logs: string[],
) => void | Promise<void>;

/** DevcontainerProgressHandlerの型定義 */
export interface DevcontainerProgressHandler {
  (log: string): void;
  cleanup: () => void;
}

/** ログの最大保持行数 */
const MAX_LOG_LINES = 30;

/** 進捗更新の間隔（ミリ秒） */
const PROGRESS_INTERVAL = 2000;

/**
 * DevcontainerProgressTrackerのデフォルトログ最大行数
 */
const DEFAULT_MAX_LOG_LINES = 20;

/**
 * DevcontainerProgressTrackerのデフォルト更新間隔（ミリ秒）
 */
const DEFAULT_UPDATE_INTERVAL = 1000;

/**
 * 即時更新をトリガーする閾値（ミリ秒）
 * updateIntervalの半分の値として計算される
 */
const IMMEDIATE_UPDATE_THRESHOLD_RATIO = 0.5;

/** 即時更新をトリガーするログパターン */
const IMPORTANT_PATTERNS = [
  /Step \d+\/\d+:/i, // "Step 1/5:" のようなパターン
  /\[\d+\/\d+\].*CACHED/i, // Docker buildのCACHEDレイヤー
  /\[\d+\/\d+\].*FINISHED/i, // Docker buildのFINISHEDレイヤー
  /\[\d+\/\d+\].*RUN/i, // Docker buildのRUNコマンド
];

/**
 * Devcontainerの進捗ハンドラーを作成する
 * @param progressCallback 進捗を通知するコールバック関数
 * @param progressMessage 進捗メッセージ（指定時は定期的に進捗更新を行う）
 * @returns ログを処理するハンドラー関数とクリーンアップ関数
 */
export function createDevcontainerProgressHandler(
  progressCallback: ProgressCallback,
  progressMessage?: string,
): DevcontainerProgressHandler {
  const logs: string[] = [];
  let intervalId: number | undefined;
  let isCleanedUp = false;

  // 進捗更新を実行する内部関数
  const sendProgress = () => {
    if (isCleanedUp || !progressMessage) return;

    try {
      // 最後のMAX_LOG_LINES行のみを送信
      const recentLogs = logs.slice(-MAX_LOG_LINES);
      progressCallback(progressMessage, recentLogs);
    } catch (error) {
      // エラーが発生してもログは継続
      console.error("Progress callback error:", error);
    }
  };

  // progressMessageが指定されている場合は定期的な進捗更新を設定
  if (progressMessage) {
    // 初回の進捗メッセージを送信
    setTimeout(() => sendProgress(), 0);

    // 定期的な進捗更新を設定
    intervalId = setInterval(() => sendProgress(), PROGRESS_INTERVAL);
  }

  // ログハンドラー関数
  const handler = (log: string) => {
    if (isCleanedUp) return;

    // ログを追加
    logs.push(log);

    // 重要なパターンにマッチする場合は即座に更新
    if (
      progressMessage && IMPORTANT_PATTERNS.some((pattern) => pattern.test(log))
    ) {
      sendProgress();
    }
  };

  // クリーンアップ関数
  handler.cleanup = () => {
    isCleanedUp = true;
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  return handler as DevcontainerProgressHandler;
}

/**
 * Devcontainerの進捗を追跡するトラッカークラス
 */
export class DevcontainerProgressTracker {
  private logs: string[] = [];
  private lastUpdateTime = 0;
  private intervalId?: number;
  private currentMessage?: string;
  private isCleanedUp = false;

  constructor(
    private progressCallback: ProgressCallback,
    private maxLogLines: number = DEFAULT_MAX_LOG_LINES,
    private updateInterval: number = DEFAULT_UPDATE_INTERVAL,
  ) {}

  /**
   * ログを追加し、必要に応じて進捗を更新する
   */
  addLog(log: string, message?: string): void {
    if (this.isCleanedUp) return;

    this.logs.push(log);

    // ログバッファのサイズを制限
    if (this.logs.length > this.maxLogLines) {
      this.logs = this.logs.slice(-this.maxLogLines);
    }

    // メッセージが提供された場合は保存
    if (message) {
      this.currentMessage = message;
    }

    // 即時更新の閾値を計算
    const immediateUpdateThreshold = this.updateInterval *
      IMMEDIATE_UPDATE_THRESHOLD_RATIO;
    const now = Date.now();

    // 前回の更新から閾値以上経過している場合は即座に更新
    // ただし、初回（lastUpdateTime === 0）の場合は更新しない
    if (
      this.currentMessage &&
      this.lastUpdateTime !== 0 &&
      now - this.lastUpdateTime > immediateUpdateThreshold
    ) {
      this.sendProgress();
    }
  }

  /**
   * 定期的な更新を開始する
   */
  startPeriodicUpdates(message: string): void {
    if (this.isCleanedUp) return;

    this.currentMessage = message;
    this.lastUpdateTime = Date.now(); // 初期時刻を設定
    this.stopPeriodicUpdates();
    this.intervalId = setInterval(() => {
      if (!this.isCleanedUp) {
        this.sendProgress();
      }
    }, this.updateInterval);
  }

  /**
   * 定期的な更新を停止する
   */
  stopPeriodicUpdates(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * 進捗を送信する
   */
  private sendProgress(): void {
    if (!this.currentMessage) return;

    try {
      this.progressCallback(this.currentMessage, [...this.logs]);
      this.lastUpdateTime = Date.now();
    } catch (error) {
      console.error("Progress callback error:", error);
    }
  }

  /**
   * トラッカーをクリーンアップする
   */
  cleanup(): void {
    this.isCleanedUp = true;
    this.stopPeriodicUpdates();
    this.logs = [];
    this.currentMessage = undefined;
    this.lastUpdateTime = 0;
  }
}
