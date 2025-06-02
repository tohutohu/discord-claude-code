/**
 * /claude config コマンドの実装
 */

import { discord } from '../../deps.ts';
import { logger } from '../../logger.ts';
import { CommandHandler, CommandMetadata } from '../../types/discord.ts';
import { createConfigActionButtons } from '../components.ts';
import { loadConfig } from '../../config.ts';

/** コマンドメタデータ */
export const metadata: CommandMetadata = {
  name: 'claude',
  description: 'Claude Bot コマンド',
  options: [
    {
      type: discord.ApplicationCommandOptionTypes.SubCommand,
      name: 'config',
      description: '現在の設定を表示',
    },
  ],
  defaultMemberPermissions: ['MANAGE_GUILD'],
};

/** コマンドハンドラ */
export const handler: CommandHandler = async (interaction, bot) => {
  // サブコマンドのチェック
  const subcommand = interaction.data?.options?.[0];
  if (subcommand?.name !== 'config') {
    return;
  }

  try {
    // 初期応答
    await discord.respondToInteraction(bot, interaction, {
      content: '⚙️ 設定を読み込んでいます...',
      flags: discord.InteractionResponseFlags.Ephemeral,
    });

    // 設定を読み込む
    const config = await loadConfig();

    // 設定情報のEmbedを作成
    const embed: discord.Embed = {
      title: '⚙️ Claude Bot 設定',
      color: 0x5865f2,
      fields: [
        {
          name: '📁 リポジトリルート',
          value: `\`${config.rootDir}\``,
          inline: false,
        },
        {
          name: '🔄 並列実行',
          value:
            `最大セッション数: ${config.parallel.maxSessions}\nキュータイムアウト: ${config.parallel.queueTimeout}秒`,
          inline: true,
        },
        {
          name: '🤖 Claude',
          value: `モデル: ${config.claude.model}\nタイムアウト: ${config.claude.timeout}秒`,
          inline: true,
        },
        {
          name: '📝 ログ',
          value:
            `レベル: ${config.logging.level}\n保持日数: ${config.logging.retentionDays}日\n最大サイズ: ${config.logging.maxFileSize}`,
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: '設定ファイル: ~/.claude-bot/claude-bot.yaml',
      },
    };

    // リポジトリ設定がある場合は追加
    if (config.repositories && Object.keys(config.repositories).length > 0) {
      const repoList = Object.entries(config.repositories)
        .map(([name, url]) => `• ${name}: \`${url}\``)
        .join('\n');

      embed.fields?.push({
        name: '📚 登録済みリポジトリ',
        value: repoList.slice(0, 1024), // Discord の制限
        inline: false,
      });
    }

    // Discord設定を追加
    embed.fields?.push({
      name: '💬 Discord',
      value: `コマンドプレフィックス: ${config.discord.commandPrefix}\nギルドID: ${
        config.discord.guildIds.length > 0 ? config.discord.guildIds.join(', ') : '全ギルド'
      }`,
      inline: false,
    });

    // 環境変数の状態を確認
    const envStatus = checkEnvironmentVariables();
    embed.fields?.push({
      name: '🔐 環境変数',
      value: envStatus,
      inline: false,
    });

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '',
      embeds: [embed],
      components: [createConfigActionButtons()],
    });

    logger.debug('設定を表示しました', {
      userId: interaction.user.id.toString(),
    });
  } catch (error) {
    logger.error('設定表示エラー:', { error: error.message });

    await discord.editOriginalInteractionResponse(bot, interaction.token, {
      content: '❌ 設定の読み込みに失敗しました。',
      embeds: [],
      components: [],
    });
  }
};

/**
 * 環境変数の状態を確認する
 * @returns 環境変数のステータス文字列
 */
function checkEnvironmentVariables(): string {
  const vars = [
    { name: 'DISCORD_TOKEN', exists: !!Deno.env.get('DISCORD_TOKEN') },
    { name: 'DISCORD_APPLICATION_ID', exists: !!Deno.env.get('DISCORD_APPLICATION_ID') },
    { name: 'ANTHROPIC_API_KEY', exists: !!Deno.env.get('ANTHROPIC_API_KEY') },
    { name: 'GITHUB_TOKEN', exists: !!Deno.env.get('GITHUB_TOKEN') },
  ];

  return vars
    .map((v) => `${v.exists ? '✅' : '❌'} ${v.name}`)
    .join('\n');
}

// エクスポート
export const configCommand = {
  metadata,
  handler,
};
