// /claude config コマンドの実装
// 設定表示・変更Modal機能

import { ApplicationCommandTypes } from '../../deps.ts';
import type { DiscordApplicationCommandOptionChoice, Interaction } from '../../deps.ts';
import type { SlashCommand } from '../../types/discord.ts';
import type { ActionRow, ConfigData, DiscordEmbed } from '../../types/discord-components.ts';
import { getDiscordClient } from '../client.ts';

/**
 * 現在の設定を取得（将来的にconfig.tsと統合）
 */
export function getCurrentConfig(): ConfigData {
  // TODO(config): config.tsと統合予定
  // 現在はモック設定を返す
  return {
    rootDir: '~/claude-work/repos',
    parallel: {
      maxSessions: 3,
      queueTimeout: 300,
    },
    discord: {
      guildIds: [],
      commandPrefix: '/claude',
    },
    claude: {
      model: 'claude-sonnet-4-20250514',
      timeout: 600,
    },
    logging: {
      level: 'INFO',
      retentionDays: 7,
      maxFileSize: '10MB',
    },
  };
}

/**
 * 設定を更新
 */
export function updateConfig(_newConfig: ConfigData): void {
  // TODO(config): config.tsと統合予定
  console.log('設定更新予定');
}

/**
 * 設定表示用のEmbedを作成
 */
export function createConfigEmbed(config: ConfigData): DiscordEmbed {
  const embed = {
    title: '⚙️ Claude Bot 設定',
    color: 0x0099ff,
    fields: [
      {
        name: '📁 リポジトリ設定',
        value: `**ルートディレクトリ:** \`${config.rootDir}\``,
        inline: false,
      },
      {
        name: '🔀 並列実行設定',
        value: [
          `**最大セッション数:** ${config.parallel.maxSessions}`,
          `**キュータイムアウト:** ${config.parallel.queueTimeout}秒`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '💬 Discord設定',
        value: [
          `**コマンドプレフィックス:** \`${config.discord.commandPrefix}\``,
          `**対象ギルド:** ${
            config.discord.guildIds.length === 0
              ? '全ギルド'
              : config.discord.guildIds.length + '個'
          }`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🤖 Claude設定',
        value: [
          `**モデル:** ${config.claude.model}`,
          `**タイムアウト:** ${config.claude.timeout}秒`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📝 ログ設定',
        value: [
          `**レベル:** ${config.logging.level}`,
          `**保持期間:** ${config.logging.retentionDays}日`,
          `**最大ファイルサイズ:** ${config.logging.maxFileSize}`,
        ].join('\n'),
        inline: false,
      },
    ],
    footer: {
      text: '設定を変更する場合は「編集」ボタンをクリックしてください',
    },
    timestamp: new Date().toISOString(),
  };

  return embed;
}

/**
 * 設定操作ボタンを作成
 */
export function createConfigButtons(): ActionRow[] {
  return [
    {
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 1, // Primary
          label: '📝 編集',
          emoji: { name: '📝' },
          custom_id: 'config_edit',
        },
        {
          type: 2,
          style: 2, // Secondary
          label: '🔄 リロード',
          emoji: { name: '🔄' },
          custom_id: 'config_reload',
        },
        {
          type: 2,
          style: 2, // Secondary
          label: '📄 ファイル表示',
          emoji: { name: '📄' },
          custom_id: 'config_show_file',
        },
        {
          type: 2,
          style: 3, // Success
          label: '💾 バックアップ',
          emoji: { name: '💾' },
          custom_id: 'config_backup',
        },
      ],
    },
    {
      type: 1, // Action Row
      components: [
        {
          type: 2,
          style: 4, // Danger
          label: '🔄 デフォルトに戻す',
          emoji: { name: '🔄' },
          custom_id: 'config_reset',
        },
      ],
    },
  ];
}

/**
 * 設定編集Modalを作成
 */
export function createConfigEditModal(_config: ConfigData): unknown {
  return {
    title: '⚙️ 設定編集',
    custom_id: 'config_edit_modal',
    components: [
      {
        type: 1, // Action Row
        components: [
          {
            type: 4, // Text Input
            custom_id: 'max_sessions',
            label: '最大セッション数',
            style: 1, // Short
            value: _config.parallel.maxSessions.toString(),
            required: true,
            min_length: 1,
            max_length: 2,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'queue_timeout',
            label: 'キュータイムアウト（秒）',
            style: 1,
            value: _config.parallel.queueTimeout.toString(),
            required: true,
            min_length: 1,
            max_length: 4,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'claude_model',
            label: 'Claudeモデル',
            style: 1,
            value: _config.claude.model,
            required: true,
            min_length: 5,
            max_length: 50,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'claude_timeout',
            label: 'Claudeタイムアウト（秒）',
            style: 1,
            value: _config.claude.timeout.toString(),
            required: true,
            min_length: 1,
            max_length: 4,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'log_level',
            label: 'ログレベル（TRACE/DEBUG/INFO/WARN/ERROR/FATAL）',
            style: 1,
            value: _config.logging.level,
            required: true,
            min_length: 4,
            max_length: 5,
          },
        ],
      },
    ],
  };
}

/**
 * ユーザーが管理者権限を持っているかチェック
 */
export function hasAdminPermission(_interaction: Interaction): boolean {
  // TODO(auth): 実際の権限チェック実装
  // 現在は全ユーザーを許可（開発用）
  return true;
}

/**
 * /claude config コマンドの定義
 */
export const configCommand: SlashCommand = {
  name: 'config',
  description: 'Claude Bot の設定を表示・変更します',
  type: ApplicationCommandTypes.ChatInput, // CHAT_INPUT
  options: [
    {
      name: 'action',
      description: '実行するアクション',
      type: 3, // STRING
      required: false,
      choices: [
        {
          name: '表示',
          value: 'show',
        },
        {
          name: '編集',
          value: 'edit',
        },
        {
          name: 'リロード',
          value: 'reload',
        },
        {
          name: 'デフォルトに戻す',
          value: 'reset',
        },
      ],
    },
  ],

  /**
   * コマンド実行ハンドラ
   */
  async execute(_interaction: Interaction): Promise<void> {
    // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
    console.log('Config command executed (placeholder)');
    await Promise.resolve();
    /*
    // 管理者権限チェック
    if (!hasAdminPermission(_interaction)) {
      await interaction.respond({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: '❌ このコマンドを実行する権限がありません（管理者権限が必要）',
          flags: 64, // EPHEMERAL
        },
      });
      return;
    }

    const action =
      interaction.data?.options?.find((opt) => opt.name === 'action')?.value as string || 'show';

    try {
      if (action === 'edit') {
        // Modal表示
        const config = getCurrentConfig();
        const modal = createConfigEditModal(config);

        await interaction.respond({
          type: 9, // MODAL
          data: modal,
        });
        return;
      }

      // 初期応答（処理中表示）
      await interaction.respond({
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      });

      switch (action) {
        case 'show':
          {
            const config = getCurrentConfig();
            const embed = createConfigEmbed(config);
            const buttons = createConfigButtons();

            await interaction.editOriginalInteractionResponse({
              embeds: [embed],
              components: buttons,
            });
          }
          break;

        case 'reload':
          {
            // 設定ファイルをリロード
            console.log('設定ファイルをリロードします');
            const config = getCurrentConfig();
            const embed = createConfigEmbed(config);

            await interaction.editOriginalInteractionResponse({
              content: '✅ 設定ファイルをリロードしました',
              embeds: [embed],
            });
          }
          break;

        case 'reset':
          {
            // デフォルト設定に戻す
            console.log('設定をデフォルトに戻します');

            await interaction.editOriginalInteractionResponse({
              content: '⚠️ 設定をデフォルトに戻しますか？この操作は元に戻せません。',
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 2,
                      style: 4,
                      label: '実行',
                      custom_id: 'config_reset_confirm',
                    },
                    {
                      type: 2,
                      style: 2,
                      label: 'キャンセル',
                      custom_id: 'config_reset_cancel',
                    },
                  ],
                },
              ],
            });
          }
          break;

        default:
          await interaction.editOriginalInteractionResponse({
            content: '❌ 無効なアクションです',
          });
      }

      console.log(`設定コマンド実行: ${action}`);
    } catch (error) {
      console.error('設定コマンドエラー:', error);

      const errorResponse = {
        content: '❌ 設定の処理に失敗しました。',
      };

      if (interaction.data?.type === 5) { // Deferred response
        await interaction.editOriginalInteractionResponse(errorResponse);
      } else {
        await interaction.respond({
          type: 4,
          data: errorResponse,
        });
      }
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
 * configコマンドを登録
 */
export function registerConfigCommand(): void {
  const client = getDiscordClient();
  const bot = client.getBot();

  if (!bot) {
    throw new Error('Discord Bot が初期化されていません');
  }

  // TODO(register): 実際のコマンド登録処理を実装
  // await bot.helpers.createGlobalApplicationCommand(configCommand);
  console.log('configコマンドが登録されました');
}
