// Discord Embed 生成ヘルパー関数群
// セッション管理、コマンド応答、エラー表示で使用されるEmbed生成機能

import type { DiscordEmbed } from '../deps.ts';
import { EmbedColor } from '../types/discord.ts';
import type { EmbedOptions, ExecutionStats, SessionInfo } from '../types/discord.ts';

/**
 * Embed の最大フィールド数（Discord の制限）
 */
const MAX_EMBED_FIELDS = 25;

/**
 * 基本的な Embed を生成
 * @param options Embed のオプション
 * @returns 生成された Discord Embed
 */
export function createBaseEmbed(options: EmbedOptions): DiscordEmbed {
  const embed: DiscordEmbed = {};

  // タイトルの設定
  if (options.title) {
    embed.title = options.title;
  }

  // 説明の設定
  if (options.description) {
    embed.description = options.description;
  }

  // 色の設定
  if (options.color !== undefined) {
    embed.color = options.color;
  }

  // フィールドの設定（最大25個まで）
  if (options.fields && options.fields.length > 0) {
    embed.fields = options.fields.slice(0, MAX_EMBED_FIELDS);

    // フィールド数が制限を超えた場合の警告
    if (options.fields.length > MAX_EMBED_FIELDS) {
      console.warn(
        `Embed フィールド数が上限を超えています (${options.fields.length}/${MAX_EMBED_FIELDS})`,
      );
    }
  }

  // フッターの設定（デフォルトでタイムスタンプを含む）
  const footerText = options.footer?.text || 'Claude Bot';
  embed.footer = {
    text: footerText,
    ...(options.footer?.iconUrl && { icon_url: options.footer.iconUrl }),
  };

  // タイムスタンプの設定（フッターに表示される）
  embed.timestamp = (options.timestamp || new Date()).toISOString();

  // サムネイルの設定
  if (options.thumbnail) {
    embed.thumbnail = options.thumbnail;
  }

  return embed;
}

/**
 * 成功を示すEmbed（緑色）を生成
 * @param title タイトル
 * @param description 説明
 * @param additionalOptions 追加オプション
 * @returns 生成された Embed
 */
export function createSuccessEmbed(
  title: string,
  description: string,
  additionalOptions?: Partial<EmbedOptions>,
): DiscordEmbed {
  return createBaseEmbed({
    title,
    description,
    color: EmbedColor.SUCCESS,
    ...additionalOptions,
  });
}

/**
 * エラーを示すEmbed（赤色）を生成
 * @param title タイトル
 * @param description 説明
 * @param additionalOptions 追加オプション
 * @returns 生成された Embed
 */
export function createErrorEmbed(
  title: string,
  description: string,
  additionalOptions?: Partial<EmbedOptions>,
): DiscordEmbed {
  return createBaseEmbed({
    title,
    description,
    color: EmbedColor.ERROR,
    ...additionalOptions,
  });
}

/**
 * 情報を示すEmbed（青色）を生成
 * @param title タイトル
 * @param description 説明
 * @param additionalOptions 追加オプション
 * @returns 生成された Embed
 */
export function createInfoEmbed(
  title: string,
  description: string,
  additionalOptions?: Partial<EmbedOptions>,
): DiscordEmbed {
  return createBaseEmbed({
    title,
    description,
    color: EmbedColor.INFO,
    ...additionalOptions,
  });
}

/**
 * 実行中を示すEmbed（紫色）を生成
 * @param title タイトル
 * @param description 説明
 * @param additionalOptions 追加オプション
 * @returns 生成された Embed
 */
export function createRunningEmbed(
  title: string,
  description: string,
  additionalOptions?: Partial<EmbedOptions>,
): DiscordEmbed {
  return createBaseEmbed({
    title,
    description,
    color: EmbedColor.RUNNING,
    ...additionalOptions,
  });
}

/**
 * 警告を示すEmbed（黄色）を生成
 * @param title タイトル
 * @param description 説明
 * @param additionalOptions 追加オプション
 * @returns 生成された Embed
 */
export function createWarningEmbed(
  title: string,
  description: string,
  additionalOptions?: Partial<EmbedOptions>,
): DiscordEmbed {
  return createBaseEmbed({
    title,
    description,
    color: EmbedColor.WARNING,
    ...additionalOptions,
  });
}

/**
 * セッション開始を示すEmbedを生成
 * @param sessionInfo セッション情報
 * @returns 生成された Embed
 */
export function createSessionStartEmbed(sessionInfo: SessionInfo): DiscordEmbed {
  return createSuccessEmbed(
    'セッション開始 🚀',
    `リポジトリ **${sessionInfo.repository}** でのセッションを開始しました`,
    {
      fields: [
        {
          name: 'リポジトリ',
          value: sessionInfo.repository,
          inline: true,
        },
        {
          name: 'ステータス',
          value: sessionInfo.state,
          inline: true,
        },
        {
          name: 'Worktree パス',
          value: sessionInfo.worktreePath,
          inline: false,
        },
      ],
    },
  );
}

/**
 * セッション完了を示すEmbedを生成
 * @param sessionInfo セッション情報
 * @param stats 実行統計情報
 * @returns 生成された Embed
 */
export function createSessionCompleteEmbed(
  sessionInfo: SessionInfo,
  stats: ExecutionStats,
): DiscordEmbed {
  const durationText = stats.duration ? `${Math.round(stats.duration / 1000)}秒` : '不明';

  const fields = [
    {
      name: '実行時間',
      value: durationText,
      inline: true,
    },
    {
      name: 'ステータス',
      value: stats.success ? '✅ 成功' : '❌ 失敗',
      inline: true,
    },
  ];

  // 統計情報が利用可能な場合は追加
  if (stats.modifiedFiles !== undefined) {
    fields.push({
      name: '変更ファイル数',
      value: `${stats.modifiedFiles}個`,
      inline: true,
    });
  }

  if (stats.linesAdded !== undefined || stats.linesDeleted !== undefined) {
    const added = stats.linesAdded || 0;
    const deleted = stats.linesDeleted || 0;
    fields.push({
      name: '変更行数',
      value: `+${added} -${deleted}`,
      inline: true,
    });
  }

  return createBaseEmbed({
    title: stats.success ? 'セッション完了 ✅' : 'セッション失敗 ❌',
    description: `リポジトリ **${sessionInfo.repository}** での作業が${
      stats.success ? '完了' : '失敗'
    }しました`,
    color: stats.success ? EmbedColor.SUCCESS : EmbedColor.ERROR,
    fields,
  });
}

/**
 * セッション一覧を表示するEmbedを生成
 * @param sessions セッション一覧
 * @param activeCount アクティブセッション数
 * @param maxSessions 最大セッション数
 * @returns 生成された Embed
 */
export function createSessionListEmbed(
  sessions: SessionInfo[],
  activeCount: number,
  maxSessions: number,
): DiscordEmbed {
  if (sessions.length === 0) {
    return createInfoEmbed(
      'セッション一覧',
      'アクティブなセッションはありません',
    );
  }

  const fields = sessions.map((session) => {
    const statusEmoji = getStatusEmoji(session.state);
    const uptime = calculateUptime(new Date(session.createdAt));

    return {
      name: `${statusEmoji} ${session.repository}`,
      value: `ID: \`${session.threadId.slice(0, 8)}...\`\nUptime: ${uptime}`,
      inline: true,
    };
  });

  return createInfoEmbed(
    'セッション一覧',
    `アクティブセッション: ${activeCount}/${maxSessions}`,
    { fields },
  );
}

/**
 * キュー待機を示すEmbedを生成
 * @param repository リポジトリ名
 * @param queuePosition キュー位置
 * @param estimatedWaitTime 推定待機時間（秒）
 * @returns 生成された Embed
 */
export function createQueueEmbed(
  repository: string,
  queuePosition: number,
  estimatedWaitTime?: number,
): DiscordEmbed {
  const waitTimeText = estimatedWaitTime
    ? `約${Math.round(estimatedWaitTime / 60)}分`
    : '計算中...';

  return createWarningEmbed(
    'キュー待機中 ⏳',
    `リポジトリ **${repository}** のセッション開始を待機しています`,
    {
      fields: [
        {
          name: 'キュー位置',
          value: `${queuePosition}番目`,
          inline: true,
        },
        {
          name: '推定待機時間',
          value: waitTimeText,
          inline: true,
        },
      ],
    },
  );
}

/**
 * セッション状態に対応する絵文字を取得
 * @param state セッション状態
 * @returns 対応する絵文字
 */
function getStatusEmoji(state: string): string {
  switch (state) {
    case '初期化中':
      return '🔄';
    case '起動中':
      return '🚀';
    case '準備完了':
      return '🟢';
    case '実行中':
      return '🔵';
    case '待機中':
      return '⏸️';
    case 'エラー':
      return '❌';
    case '完了':
      return '✅';
    case 'キャンセル':
      return '⏹️';
    default:
      return '❓';
  }
}

/**
 * プログレスバーの設定
 */
export interface ProgressBarOptions {
  /** 進捗率（0-100） */
  progress: number;
  /** バーの長さ（文字数） */
  length?: number;
  /** 完了文字 */
  filledChar?: string;
  /** 未完了文字 */
  emptyChar?: string;
  /** 経過時間（秒） */
  elapsedTime?: number;
  /** 推定残り時間（秒） */
  estimatedTimeRemaining?: number;
}

/**
 * プログレスバーを生成
 * @param options プログレスバーのオプション
 * @returns フォーマットされたプログレスバー文字列
 */
export function createProgressBar(options: ProgressBarOptions): string {
  const {
    progress,
    length = 10,
    filledChar = '▓',
    emptyChar = '░',
    elapsedTime,
    estimatedTimeRemaining,
  } = options;

  // 進捗率を0-100の範囲に制限
  const normalizedProgress = Math.max(0, Math.min(100, progress));

  // プログレスバーの計算
  const filledLength = Math.round((normalizedProgress / 100) * length);
  const emptyLength = length - filledLength;

  const progressBar = filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength);
  const percentageText = `${Math.round(normalizedProgress)}%`;

  // 時間情報の組み立て
  let timeInfo = '';
  if (elapsedTime !== undefined) {
    const elapsedFormatted = formatDuration(elapsedTime);
    timeInfo = ` (${elapsedFormatted}`;

    if (estimatedTimeRemaining !== undefined) {
      const remainingFormatted = formatDuration(estimatedTimeRemaining);
      timeInfo += ` / 残り${remainingFormatted}`;
    }

    timeInfo += ')';
  }

  return `[${progressBar}] ${percentageText}${timeInfo}`;
}

/**
 * 実行中のセッションにプログレスバー付きEmbedを生成
 * @param sessionInfo セッション情報
 * @param progress 進捗率（0-100）
 * @param elapsedTime 経過時間（秒）
 * @param status 現在のステータスメッセージ
 * @param logs 最新のログ（最大5行）
 * @returns 生成された Embed
 */
export function createRunningSessionEmbed(
  sessionInfo: SessionInfo,
  progress: number,
  elapsedTime: number,
  status: string,
  logs?: string[],
): DiscordEmbed {
  const progressBar = createProgressBar({
    progress,
    elapsedTime,
    length: 15,
  });

  const fields = [
    {
      name: '進捗',
      value: `\`\`\`\n${progressBar}\n\`\`\``,
      inline: false,
    },
    {
      name: 'ステータス',
      value: status,
      inline: true,
    },
    {
      name: '稼働時間',
      value: formatDuration(elapsedTime),
      inline: true,
    },
  ];

  // ログがある場合は追加
  if (logs && logs.length > 0) {
    const logText = logs.slice(-5).join('\n'); // 最新5行
    fields.push({
      name: '最新ログ',
      value: `\`\`\`\n${logText}\n\`\`\``,
      inline: false,
    });
  }

  return createRunningEmbed(
    '実行中... 🔄',
    `リポジトリ **${sessionInfo.repository}** での作業を実行中`,
    { fields },
  );
}

/**
 * 時間（秒）を読みやすい形式にフォーマット
 * @param seconds 秒数
 * @returns フォーマットされた時間文字列（MM:SS または HH:MM:SS）
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${
      secs.toString().padStart(2, '0')
    }`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * 進捗更新間隔の制御クラス
 * Discord API rate limitを考慮した更新頻度制御
 */
export class ProgressUpdateController {
  private lastUpdateTime = 0;
  private readonly updateInterval = 5000; // 5秒間隔

  /**
   * 更新が必要かどうかを判定
   * @returns 更新すべき場合はtrue
   */
  shouldUpdate(): boolean {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    return timeSinceLastUpdate >= this.updateInterval;
  }

  /**
   * 更新時刻を記録
   */
  markUpdated(): void {
    this.lastUpdateTime = Date.now();
  }

  /**
   * 次回更新までの残り時間を取得
   * @returns 残り時間（ミリ秒）
   */
  getTimeUntilNextUpdate(): number {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    return Math.max(0, this.updateInterval - timeSinceLastUpdate);
  }
}

/**
 * セッション開始時刻からのUptime（稼働時間）を計算
 * @param startTime 開始時刻
 * @returns フォーマットされた稼働時間
 */
function calculateUptime(startTime: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${
      seconds.toString().padStart(2, '0')
    }`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}
