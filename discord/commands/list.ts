/**
 * /claude list コマンドの実装
 */

import { discord } from '../../deps.ts';
import { logger } from '../../logger.ts';
import { CommandHandler, CommandMetadata } from '../../types/discord.ts';
import { createSessionListEmbed } from '../embeds.ts';
import { createPaginationButtons, createSessionActionButtons } from '../components.ts';

/** コマンドメタデータ */
export const metadata: CommandMetadata = {
  name: 'claude',
  description: 'Claude Bot コマンド',
  options: [
    {
      type: discord.ApplicationCommandOptionTypes.SubCommand,
      name: 'list',
      description: 'アクティブなセッション一覧を表示',
    },
  ],
  defaultMemberPermissions: ['SEND_MESSAGES'],
};

/** コマンドハンドラ */
export const handler: CommandHandler = async (interaction, bot) => {
  // サブコマンドのチェック
  const subcommand = interaction.data?.options?.[0];
  if (subcommand?.name !== 'list') {
    return;
  }

  try {
    // 初期応答
    await discord.respondToInteraction(bot, interaction, {
      content: '📋 セッション一覧を取得しています...',
      flags: discord.InteractionResponseFlags.Ephemeral,
    });

    // TODO(@discord): セッションマネージャーから一覧を取得
    const sessions = getMockSessions();

    // ページネーション設定
    const itemsPerPage = 10;
    const totalPages = Math.ceil(sessions.length / itemsPerPage);
    const currentPage = 0;

    // 現在のページのセッションを取得
    const pageSessions = sessions.slice(
      currentPage * itemsPerPage,
      (currentPage + 1) * itemsPerPage,
    );

    // Embedを作成
    const embed = createSessionListEmbed(pageSessions, currentPage, totalPages);

    // コンポーネントを作成
    const components: discord.ActionRow[] = [];

    // 各セッションのアクションボタン
    pageSessions.forEach((session, index) => {
      if (index < 3) { // Discord の制限により最大3行
        components.push(
          createSessionActionButtons(
            session.id,
            session.threadId,
            session.status === '🟢 実行中',
          ),
        );
      }
    });

    // ページネーションボタン
    if (totalPages > 1) {
      components.push(createPaginationButtons(currentPage, totalPages, 'session_list'));
    }

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '',
      embeds: [embed],
      components,
    });

    logger.debug('セッション一覧を表示しました', {
      userId: interaction.user.id.toString(),
      sessionCount: sessions.length,
    });
  } catch (error) {
    logger.error('セッション一覧取得エラー:', { error: error.message });

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '❌ セッション一覧の取得に失敗しました。',
      embeds: [],
      components: [],
    });
  }
};

/**
 * モックセッションデータを取得する
 * @returns セッション一覧
 */
function getMockSessions(): Array<{
  id: string;
  threadId: string;
  repository: string;
  status: string;
  uptime: string;
}> {
  return [
    {
      id: 'session_001',
      threadId: '1234567890',
      repository: 'core-api',
      status: '🟢 実行中',
      uptime: '00:12:34',
    },
    {
      id: 'session_002',
      threadId: '0987654321',
      repository: 'web-admin',
      status: '⏸️ 待機中',
      uptime: '00:03:10',
    },
    {
      id: 'session_003',
      threadId: '1122334455',
      repository: 'auth-service',
      status: '❌ エラー',
      uptime: '00:45:23',
    },
  ];
}

// エクスポート
export const listCommand = {
  metadata,
  handler,
};
