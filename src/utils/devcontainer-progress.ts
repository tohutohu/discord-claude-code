import { ChatInputCommandInteraction, Message } from "discord.js";
import { ButtonInteraction } from "discord.js";

export interface DevcontainerProgressOptions {
  /** 初期メッセージ */
  initialMessage: string;
  /** 進行中のメッセージプレフィックス */
  progressPrefix: string;
  /** 成功時のメッセージ */
  successMessage: string;
  /** 失敗時のメッセージプレフィックス */
  failurePrefix: string;
  /** 最大ログ行数 */
  maxLogLines?: number;
  /** 更新間隔（ミリ秒） */
  updateInterval?: number;
  /** 初回起動の警告メッセージを表示するか */
  showFirstTimeWarning?: boolean;
}

export interface DevcontainerProgressHandler {
  /** 進捗更新関数 */
  onProgress: (message: string) => Promise<void>;
  /** 成功時の処理 */
  onSuccess: (logs: string[]) => Promise<void>;
  /** 失敗時の処理 */
  onFailure: (error: string, logs: string[]) => Promise<void>;
  /** クリーンアップ処理 */
  cleanup: () => void;
}

/**
 * devcontainer起動時の進捗表示を管理する共通関数
 */
export function createDevcontainerProgressHandler(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  progressMessage: Message | undefined,
  options: DevcontainerProgressOptions,
): DevcontainerProgressHandler {
  const {
    initialMessage,
    progressPrefix,
    successMessage,
    failurePrefix,
    maxLogLines = 20,
    updateInterval = 1000,
    showFirstTimeWarning = false,
  } = options;

  const logs: string[] = [];
  let lastUpdateTime = Date.now();
  let timerId: number | undefined;

  // 重要なイベントパターン
  const importantPatterns = [
    "pulling",
    "downloading",
    "extracting",
    "building",
    "creating",
    "starting",
    "waiting",
    "complete",
    "success",
    "error",
    "failed",
  ];

  /**
   * ログをフォーマットして返す
   */
  const formatLogs = (logLines: string[]): string => {
    const displayLogs = logLines.slice(-maxLogLines);
    return displayLogs.length > 0
      ? `\n\n**ログ:**\n\`\`\`\n${displayLogs.join("\n")}\n\`\`\``
      : "";
  };

  /**
   * 進捗メッセージを更新する
   */
  const updateProgress = async () => {
    try {
      const logContent = formatLogs(logs);
      const warningMessage = showFirstTimeWarning
        ? "\n\n⏳ 初回起動は数分かかる場合があります。"
        : "";

      const content = `${progressPrefix}${logContent}${warningMessage}`;

      if (progressMessage) {
        // 既存メッセージを編集（通常のdevcontainer）
        await progressMessage.edit({ content });
      } else {
        // interaction.editReplyを使用（fallback devcontainer）
        await interaction.editReply({ content });
      }
    } catch (error) {
      console.error("進捗更新エラー:", error);
    }
  };

  /**
   * 定期更新タイマーを開始
   */
  const startTimer = () => {
    timerId = setInterval(updateProgress, updateInterval);
  };

  /**
   * メッセージが重要かどうかを判定
   */
  const isImportantMessage = (message: string): boolean => {
    const lowercaseMessage = message.toLowerCase();
    return importantPatterns.some((pattern) =>
      lowercaseMessage.includes(pattern)
    );
  };

  /**
   * 進捗メッセージを処理
   */
  const onProgress = async (message: string) => {
    // ログに追加
    if (message.includes("```")) {
      // コードブロック内のログを抽出
      const match = message.match(/```\n([\s\S]*?)\n```/);
      if (match) {
        const logLines = match[1].split("\n").filter((line) => line.trim());
        logs.push(...logLines);
      }
    } else {
      // 通常のメッセージはそのまま追加
      logs.push(message);
    }

    // ログサイズを制限
    if (logs.length > maxLogLines * 2) {
      logs.splice(0, logs.length - maxLogLines);
    }

    // 重要なメッセージの場合は即座に更新
    if (isImportantMessage(message)) {
      const now = Date.now();
      if (now - lastUpdateTime >= updateInterval / 2) {
        lastUpdateTime = now;
        await updateProgress();
      }
    }
  };

  /**
   * 成功時の処理
   */
  const onSuccess = async (finalLogs: string[]) => {
    if (timerId) {
      clearInterval(timerId);
    }

    const logContent = formatLogs(finalLogs.length > 0 ? finalLogs : logs);
    const content = `${successMessage}${logContent}`;

    try {
      if (progressMessage) {
        await progressMessage.edit({ content });
      } else {
        await interaction.editReply({ content });
      }
    } catch (error) {
      console.error("成功メッセージ更新エラー:", error);
    }
  };

  /**
   * 失敗時の処理
   */
  const onFailure = async (error: string, failureLogs: string[]) => {
    if (timerId) {
      clearInterval(timerId);
    }

    const logContent = formatLogs(failureLogs.length > 0 ? failureLogs : logs);
    const content = `${failurePrefix}${error}${logContent}`;

    try {
      if (progressMessage) {
        await progressMessage.edit({ content });
      } else {
        await interaction.editReply({ content });
      }
    } catch (error) {
      console.error("失敗メッセージ更新エラー:", error);
    }
  };

  /**
   * クリーンアップ処理
   */
  const cleanup = () => {
    if (timerId) {
      clearInterval(timerId);
    }
  };

  // 初期メッセージを設定し、タイマーを開始
  if (progressMessage) {
    progressMessage.edit({ content: initialMessage }).catch(console.error);
  } else {
    interaction.editReply({ content: initialMessage }).catch(console.error);
  }
  startTimer();

  return {
    onProgress,
    onSuccess,
    onFailure,
    cleanup,
  };
}
