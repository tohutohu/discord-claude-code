/**
 * Discord Embed生成ヘルパー
 */

import { discord } from '../deps.ts';

/** Embedの色定義 */
export const Colors = {
  Success: 0x57f287, // 緑
  Error: 0xed4245, // 赤
  Warning: 0xfee75c, // 黄
  Info: 0x5865f2, // 青（Discord Blurple）
  Running: 0x5865f2, // 青
  Waiting: 0xfee75c, // 黄
} as const;

/**
 * セッション作成のEmbedを生成する
 * @param repository リポジトリ名
 * @param threadId スレッドID
 * @param queuePosition キュー位置（0の場合は即座に実行）
 * @returns Embed
 */
export function createSessionStartEmbed(
  repository: string,
  threadId: string,
  queuePosition: number,
): discord.Embed {
  const embed: discord.Embed = {
    title: 'Claude セッション作成',
    color: queuePosition > 0 ? Colors.Waiting : Colors.Success,
    fields: [
      {
        name: 'リポジトリ',
        value: repository,
        inline: true,
      },
      {
        name: 'スレッド',
        value: `<#${threadId}>`,
        inline: true,
      },
      {
        name: 'ステータス',
        value: queuePosition > 0 ? `⏳ キュー待機中 (${queuePosition}番目)` : '✅ 開始中',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Claude Bot',
    },
  };

  if (queuePosition > 0) {
    embed.description = `セッションはキューに追加されました。順番が来たら自動的に開始されます。`;
  }

  return embed;
}

/**
 * セッション開始通知のEmbedを生成する
 * @param repository リポジトリ名
 * @param branch ブランチ名
 * @returns Embed
 */
export function createSessionReadyEmbed(
  repository: string,
  branch?: string,
): discord.Embed {
  return {
    title: 'セッション開始 🚀',
    description: 'Claude Code の準備が整いました。指示を送信してください。',
    color: Colors.Success,
    fields: [
      {
        name: 'リポジトリ',
        value: repository,
        inline: true,
      },
      {
        name: 'ブランチ',
        value: branch || 'main',
        inline: true,
      },
      {
        name: '環境',
        value: '🐳 Dev Container',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: '💡 ヒント: コードの変更は自動的に検出されます',
    },
  };
}

/**
 * エラーEmbedを生成する
 * @param title タイトル
 * @param error エラーメッセージ
 * @param details 詳細情報
 * @returns Embed
 */
export function createErrorEmbed(
  title: string,
  error: string,
  details?: string,
): discord.Embed {
  const embed: discord.Embed = {
    title: `❌ ${title}`,
    description: error,
    color: Colors.Error,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    embed.fields = [
      {
        name: '詳細',
        value: `\`\`\`\n${details.slice(0, 1000)}\n\`\`\``,
      },
    ];
  }

  return embed;
}

/**
 * 実行中のEmbedを生成する
 * @param message 実行中のメッセージ
 * @param logs 最新のログ（最大5行）
 * @returns Embed
 */
export function createRunningEmbed(
  message: string,
  logs?: string[],
): discord.Embed {
  const embed: discord.Embed = {
    title: '実行中...',
    description: message,
    color: Colors.Running,
    timestamp: new Date().toISOString(),
  };

  if (logs && logs.length > 0) {
    embed.fields = [
      {
        name: '最新のログ',
        value: `\`\`\`\n${logs.slice(-5).join('\n')}\n\`\`\``,
      },
    ];
  }

  return embed;
}

/**
 * 完了Embedを生成する
 * @param summary 完了サマリー
 * @param stats 統計情報
 * @returns Embed
 */
export function createCompletedEmbed(
  summary: string,
  stats?: {
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
    duration?: number;
  },
): discord.Embed {
  const embed: discord.Embed = {
    title: '✅ 完了',
    description: summary,
    color: Colors.Success,
    timestamp: new Date().toISOString(),
  };

  if (stats) {
    const fields: discord.EmbedField[] = [];

    if (stats.filesChanged !== undefined) {
      fields.push({
        name: '変更ファイル数',
        value: stats.filesChanged.toString(),
        inline: true,
      });
    }

    if (stats.insertions !== undefined || stats.deletions !== undefined) {
      fields.push({
        name: '変更行数',
        value: `+${stats.insertions || 0} -${stats.deletions || 0}`,
        inline: true,
      });
    }

    if (stats.duration !== undefined) {
      const minutes = Math.floor(stats.duration / 60);
      const seconds = stats.duration % 60;
      fields.push({
        name: '実行時間',
        value: `${minutes}分${seconds}秒`,
        inline: true,
      });
    }

    embed.fields = fields;
  }

  return embed;
}

/**
 * セッション一覧のEmbedを生成する
 * @param sessions セッション情報の配列
 * @param page 現在のページ（0ベース）
 * @param totalPages 総ページ数
 * @returns Embed
 */
export function createSessionListEmbed(
  sessions: Array<{
    threadId: string;
    repository: string;
    status: string;
    uptime: string;
  }>,
  page: number,
  totalPages: number,
): discord.Embed {
  const embed: discord.Embed = {
    title: 'アクティブなセッション',
    color: Colors.Info,
    fields: [],
    timestamp: new Date().toISOString(),
    footer: {
      text: `ページ ${page + 1}/${totalPages}`,
    },
  };

  if (sessions.length === 0) {
    embed.description = 'アクティブなセッションはありません。';
    return embed;
  }

  // セッション情報をフィールドとして追加
  for (const session of sessions) {
    embed.fields?.push({
      name: `${session.repository}`,
      value:
        `スレッド: <#${session.threadId}>\nステータス: ${session.status}\n稼働時間: ${session.uptime}`,
      inline: true,
    });
  }

  return embed;
}

/**
 * 進捗バーを生成する
 * @param current 現在の値
 * @param total 合計値
 * @param width バーの幅（文字数）
 * @returns 進捗バー文字列
 */
export function createProgressBar(
  current: number,
  total: number,
  width = 20,
): string {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage.toFixed(0)}%`;
}
