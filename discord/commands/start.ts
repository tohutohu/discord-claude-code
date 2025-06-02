/**
 * /claude start コマンドの実装
 */

import { discord } from '../../deps.ts';
import { logger } from '../../logger.ts';
import { CommandHandler, CommandMetadata } from '../../types/discord.ts';
import { createSessionReadyEmbed, createSessionStartEmbed } from '../embeds.ts';
import { createSessionActionButtons } from '../components.ts';

/** コマンドメタデータ */
export const metadata: CommandMetadata = {
  name: 'claude',
  description: 'Claude Bot コマンド',
  options: [
    {
      type: discord.ApplicationCommandOptionTypes.SubCommand,
      name: 'start',
      description: '新しいClaude Codeセッションを開始',
      options: [
        {
          type: discord.ApplicationCommandOptionTypes.String,
          name: 'repository',
          description: 'リポジトリ名',
          required: true,
          autocomplete: true,
        },
        {
          type: discord.ApplicationCommandOptionTypes.String,
          name: 'branch',
          description: 'ブランチ名（省略時はデフォルトブランチ）',
          required: false,
        },
      ],
    },
  ],
  defaultMemberPermissions: ['SEND_MESSAGES'],
};

/** コマンドハンドラ */
export const handler: CommandHandler = async (interaction, bot) => {
  // サブコマンドのチェック
  const subcommand = interaction.data?.options?.[0];
  if (subcommand?.name !== 'start') {
    return;
  }

  // オプションを取得
  const repository = getOption<string>(subcommand.options, 'repository');
  const branch = getOption<string>(subcommand.options, 'branch');

  if (!repository) {
    await discord.respondToInteraction(bot, interaction, {
      content: '❌ リポジトリ名を指定してください。',
      flags: discord.InteractionResponseFlags.Ephemeral,
    });
    return;
  }

  try {
    // 初期応答
    await discord.respondToInteraction(bot, interaction, {
      content: '🔄 セッションを作成しています...',
    });

    // スレッドを作成
    const thread = await createSessionThread(bot, interaction, repository);

    // TODO(@discord): セッションマネージャーに登録
    const sessionId = generateSessionId();
    const queuePosition = 0; // TODO(@discord): キュー位置を取得

    // セッション作成のEmbedを送信
    const embed = createSessionStartEmbed(repository, thread.id.toString(), queuePosition);
    const components = [createSessionActionButtons(sessionId, thread.id.toString(), false)];

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '',
      embeds: [embed],
      components,
    });

    // スレッド内に初期メッセージを送信
    const readyEmbed = createSessionReadyEmbed(repository, branch);
    await discord.sendMessage(bot, thread.id, {
      embeds: [readyEmbed],
      components: [
        {
          type: discord.ComponentTypes.ActionRow,
          components: [
            {
              type: discord.ComponentTypes.Button,
              style: discord.ButtonStyles.Danger,
              label: '/end',
              customId: `session_end:sessionId=${sessionId}`,
            },
            {
              type: discord.ComponentTypes.Button,
              style: discord.ButtonStyles.Secondary,
              label: '設定変更',
              customId: 'session_config',
            },
          ],
        },
      ],
    });

    logger.info('セッションを作成しました', {
      sessionId,
      repository,
      branch,
      threadId: thread.id.toString(),
      userId: interaction.user.id.toString(),
    });
  } catch (error) {
    logger.error('セッション作成エラー:', { error: error.message });

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '❌ セッションの作成に失敗しました。',
      embeds: [],
      components: [],
    });
  }
};

/**
 * セッション用のスレッドを作成する
 * @param bot Botインスタンス
 * @param interaction インタラクション
 * @param repository リポジトリ名
 * @returns 作成されたスレッド
 */
async function createSessionThread(
  bot: discord.Bot,
  interaction: discord.Interaction,
  repository: string,
): Promise<discord.Channel> {
  if (!interaction.channelId) {
    throw new Error('チャンネルIDが見つかりません');
  }

  const threadName = `Claude: ${repository} - ${new Date().toLocaleString('ja-JP')}`;

  // パブリックスレッドを作成
  const thread = await discord.createThread(bot, interaction.channelId, {
    name: threadName,
    autoArchiveDuration: 1440, // 24時間
    type: discord.ChannelTypes.PublicThread,
    reason: 'Claude Code セッション用',
  });

  return thread;
}

/**
 * セッションIDを生成する
 * @returns セッションID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * オプションから値を取得する
 * @param options オプション配列
 * @param name オプション名
 * @returns オプションの値
 */
function getOption<T>(
  options: discord.ApplicationCommandInteractionDataOption[] | undefined,
  name: string,
): T | undefined {
  if (!options) return undefined;

  const option = options.find((opt) => opt.name === name);
  return option?.value as T | undefined;
}

// Autocomplete handler
export async function handleAutocomplete(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  const focused = interaction.data?.options?.[0]?.options?.find(
    (opt) => opt.focused === true,
  );

  if (focused?.name === 'repository') {
    // TODO(@discord): リポジトリ一覧を取得
    const repositories = [
      'core-api',
      'web-admin',
      'auth-service',
      'payment-gateway',
      'notification-service',
    ];

    const query = (focused.value as string)?.toLowerCase() || '';
    const filtered = repositories
      .filter((repo) => repo.toLowerCase().includes(query))
      .slice(0, 25); // Discord の制限

    await discord.respondToInteraction(bot, interaction, {
      type: discord.InteractionResponseTypes.ApplicationCommandAutocompleteResult,
      data: {
        choices: filtered.map((repo) => ({
          name: repo,
          value: repo,
        })),
      },
    });
  }
}

// エクスポート
export const startCommand = {
  metadata,
  handler,
  handleAutocomplete,
};
