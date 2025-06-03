// /claude list コマンドの実装
// アクティブなセッション一覧を表示（ページネーション対応）

import { ApplicationCommandTypes } from '../../deps.ts';
import type { DiscordApplicationCommandOptionChoice, Interaction } from '../../deps.ts';
import {
  type ListPagination,
  type SessionInfo,
  SessionState,
  type SlashCommand,
} from '../../types/discord.ts';
import type { ActionRow, DiscordEmbed } from '../../types/discord-components.ts';
import { getDiscordClient } from '../client.ts';

/**
 * モックセッションデータを取得（将来的にsessionManager.tsと統合）
 */
export function getAllSessions(): SessionInfo[] {
  // TODO(session): sessionManager.tsと統合予定
  // 現在はモックデータを返す
  const now = new Date();
  const sessions: SessionInfo[] = [
    {
      threadId: 'thread_123456789',
      repository: 'core-api',
      worktreePath: '/tmp/worktree/core-api-123',
      containerId: 'container_abc123',
      state: 'RUNNING' as SessionState,
      createdAt: new Date(now.getTime() - 3600000).toISOString(), // 1時間前
      updatedAt: new Date(now.getTime() - 60000).toISOString(), // 1分前
      metadata: {
        userId: 'user_001',
        guildId: 'guild_001',
        startedAt: new Date(now.getTime() - 3600000),
        updatedAt: new Date(now.getTime() - 60000),
      },
    },
    {
      threadId: 'thread_987654321',
      repository: 'web-admin',
      worktreePath: '/tmp/worktree/web-admin-456',
      state: 'WAITING' as SessionState,
      createdAt: new Date(now.getTime() - 1800000).toISOString(), // 30分前
      updatedAt: new Date(now.getTime() - 300000).toISOString(), // 5分前
      metadata: {
        userId: 'user_002',
        guildId: 'guild_001',
        startedAt: new Date(now.getTime() - 1800000),
        updatedAt: new Date(now.getTime() - 300000),
      },
    },
    {
      threadId: 'thread_456789123',
      repository: 'auth-service',
      worktreePath: '/tmp/worktree/auth-service-789',
      containerId: 'container_def456',
      state: 'ERROR' as SessionState,
      createdAt: new Date(now.getTime() - 7200000).toISOString(), // 2時間前
      updatedAt: new Date(now.getTime() - 600000).toISOString(), // 10分前
      metadata: {
        userId: 'user_003',
        guildId: 'guild_001',
        startedAt: new Date(now.getTime() - 7200000),
        updatedAt: new Date(now.getTime() - 600000),
      },
    },
  ];

  return sessions;
}

/**
 * セッション状態のアイコンを取得
 */
function getStateIcon(state: SessionState): string {
  const icons: Record<SessionState, string> = {
    [SessionState.INITIALIZING]: '🔄',
    [SessionState.STARTING]: '🚀',
    [SessionState.READY]: '✅',
    [SessionState.RUNNING]: '🟢',
    [SessionState.WAITING]: '⏸️',
    [SessionState.ERROR]: '❌',
    [SessionState.COMPLETED]: '✅',
    [SessionState.CANCELLED]: '🛑',
  };
  return icons[state] || '❓';
}

/**
 * 稼働時間を人間が読みやすい形式に変換
 */
function formatUptime(createdAt: string): string {
  const start = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

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

/**
 * セッション一覧のページネーションを計算
 */
export function calculatePagination(
  totalItems: number,
  page: number = 0,
  pageSize: number = 10,
): ListPagination {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.max(0, Math.min(page, totalPages - 1));

  return {
    page: validPage,
    pageSize,
    totalItems,
    totalPages,
  };
}

/**
 * セッション一覧のEmbedを作成
 */
export function createSessionListEmbed(
  sessions: SessionInfo[],
  pagination: ListPagination,
): DiscordEmbed {
  const startIndex = pagination.page * pagination.pageSize;
  const endIndex = Math.min(startIndex + pagination.pageSize, sessions.length);
  const pageSessions = sessions.slice(startIndex, endIndex);

  const embed = {
    title: '📋 Claude セッション一覧',
    color: 0x0099ff,
    description: `総セッション数: ${pagination.totalItems}`,
    fields: [] as Array<{ name: string; value: string; inline?: boolean }>,
    footer: {
      text: `ページ ${pagination.page + 1}/${pagination.totalPages}`,
    },
    timestamp: new Date().toISOString(),
  };

  if (pageSessions.length === 0) {
    embed.fields.push({
      name: 'セッションなし',
      value: 'アクティブなセッションはありません',
      inline: false,
    });
  } else {
    // ヘッダー行
    embed.fields.push({
      name: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      value: '`Thread ID    Repository     Status  Uptime`',
      inline: false,
    });

    // セッション行
    pageSessions.forEach((session, index) => {
      const threadShort = session.threadId.substring(0, 8) + '...';
      const repoShort = session.repository.length > 12
        ? session.repository.substring(0, 9) + '...'
        : session.repository;
      const stateIcon = getStateIcon(session.state);
      const uptime = formatUptime(session.createdAt);

      const line = `\`${threadShort.padEnd(12)} ${repoShort.padEnd(12)} ${stateIcon} ${
        session.state.padEnd(6)
      } ${uptime}\``;

      embed.fields.push({
        name: `${startIndex + index + 1}.`,
        value: line,
        inline: false,
      });
    });
  }

  return embed;
}

/**
 * ページネーション用ボタンを作成
 */
export function createPaginationButtons(_pagination: ListPagination): ActionRow[] {
  const buttons: unknown[] = [];

  // 前のページボタン
  if (_pagination.page > 0) {
    buttons.push({
      type: 2, // Button
      style: 2, // Secondary
      label: '◀ 前',
      custom_id: `list_prev_${_pagination.page - 1}`,
      disabled: false,
    });
  } else {
    buttons.push({
      type: 2,
      style: 2,
      label: '◀ 前',
      custom_id: 'list_prev_disabled',
      disabled: true,
    });
  }

  // ページ情報
  buttons.push({
    type: 2,
    style: 2,
    label: `${_pagination.page + 1}/${_pagination.totalPages}`,
    custom_id: 'list_page_info',
    disabled: true,
  });

  // 次のページボタン
  if (_pagination.page < _pagination.totalPages - 1) {
    buttons.push({
      type: 2,
      style: 2,
      label: '次 ▶',
      custom_id: `list_next_${_pagination.page + 1}`,
      disabled: false,
    });
  } else {
    buttons.push({
      type: 2,
      style: 2,
      label: '次 ▶',
      custom_id: 'list_next_disabled',
      disabled: true,
    });
  }

  // 更新ボタン
  buttons.push({
    type: 2,
    style: 1, // Primary
    label: '🔄 更新',
    custom_id: `list_refresh_${_pagination.page}`,
  });

  return [
    {
      type: 1, // Action Row
      components: buttons,
    },
  ];
}

/**
 * セッション操作ボタンを作成
 */
export function createSessionActionButtons(): ActionRow[] {
  return [
    {
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 1, // Primary
          label: '🔍 詳細表示',
          custom_id: 'list_show_details',
        },
        {
          type: 2,
          style: 4, // Danger
          label: '🛑 選択終了',
          custom_id: 'list_end_selected',
        },
        {
          type: 2,
          style: 2, // Secondary
          label: '📊 統計表示',
          custom_id: 'list_show_stats',
        },
      ],
    },
  ];
}

/**
 * /claude list コマンドの定義
 */
export const listCommand: SlashCommand = {
  name: 'list',
  description: 'アクティブなClaude セッション一覧を表示します',
  type: ApplicationCommandTypes.ChatInput, // CHAT_INPUT
  options: [
    {
      name: 'page',
      description: '表示するページ番号（1から開始）',
      type: 4, // INTEGER
      required: false,
      min_value: 1,
    },
  ],

  /**
   * コマンド実行ハンドラ
   */
  async execute(_interaction: Interaction): Promise<void> {
    // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
    console.log('List command executed (placeholder)');
    await Promise.resolve();
    /*
    try {
      // 初期応答（処理中表示）
      await _interaction.respond({
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      });

      // ページ番号の取得（1から開始をで0から開始に変換）
      const pageInput = interaction.data?.options?.find((opt) => opt.name === 'page')
        ?.value as number;
      const page = pageInput ? Math.max(0, pageInput - 1) : 0;

      // セッション一覧を取得
      const allSessions = getAllSessions();

      // ページネーション計算
      const pagination = calculatePagination(allSessions.length, page, 10);

      // Embed作成
      const embed = createSessionListEmbed(allSessions, pagination);
      const paginationButtons = createPaginationButtons(pagination);
      const actionButtons = allSessions.length > 0 ? createSessionActionButtons() : [];

      // 応答を更新
      await interaction.editOriginalInteractionResponse({
        embeds: [embed],
        components: [...paginationButtons, ...actionButtons],
      });

      console.log(`セッション一覧表示: ページ ${pagination.page + 1}/${pagination.totalPages}`);
    } catch (error) {
      console.error('セッション一覧取得エラー:', error);

      await interaction.editOriginalInteractionResponse({
        content: '❌ セッション一覧の取得に失敗しました。',
      });
    }
    */
  },

  /**
   * オートコンプリート処理（なし）
   */
  autocomplete(): DiscordApplicationCommandOptionChoice[] {
    return [];
  },
};

/**
 * listコマンドを登録
 */
export function registerListCommand(): void {
  const client = getDiscordClient();
  const bot = client.getBot();

  if (!bot) {
    throw new Error('Discord Bot が初期化されていません');
  }

  // TODO(register): 実際のコマンド登録処理を実装
  // await bot.helpers.createGlobalApplicationCommand(listCommand);
  console.log('listコマンドが登録されました');
}
