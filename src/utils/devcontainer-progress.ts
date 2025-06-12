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
