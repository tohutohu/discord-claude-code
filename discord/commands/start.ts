// /claude start コマンドの実装
// リポジトリを指定してClaude セッションを開始

import { ApplicationCommandOptionTypes, ApplicationCommandTypes } from '../../deps.ts';
import type {
  DiscordApplicationCommandOption,
  DiscordApplicationCommandOptionChoice,
  Interaction,
} from '../../deps.ts';
import {
  type QueuePosition,
  type SlashCommand,
  type StartCommandOptions,
} from '../../types/discord.ts';
import type { ActionRow, DiscordEmbed } from '../../types/discord-components.ts';
import { getDiscordClient } from '../client.ts';
import { defaultRepositoryAutocomplete } from '../autocomplete.ts';
// import {
//   deferResponse,
//   editOriginalInteractionResponse,
//   sendEphemeralResponse,
// } from '../helpers.ts';

/**
 * リポジトリ候補を取得する（オートコンプリート用）
 * @param query ユーザーの入力クエリ
 * @returns リポジトリ候補の配列
 */
async function getRepositoryCandidates(
  query?: string,
): Promise<DiscordApplicationCommandOptionChoice[]> {
  try {
    return await defaultRepositoryAutocomplete.getRepositoryChoices(query);
  } catch (error) {
    console.error('リポジトリ候補取得エラー:', error);

    // エラー時は基本的な候補を返す
    return [
      { name: 'core-api', value: 'core-api' },
      { name: 'web-admin', value: 'web-admin' },
      { name: 'auth-service', value: 'auth-service' },
      { name: 'notification-service', value: 'notification-service' },
    ];
  }
}

/**
 * ユーザーの権限をチェック
 */
export function hasManageMessagesPermission(_interaction: Interaction): boolean {
  // TODO(auth): 実際の権限チェック実装
  // 現在は全ユーザーを許可（開発用）
  return true;
}

/**
 * 現在のキュー位置を取得
 */
export function getQueuePosition(): QueuePosition {
  // TODO(queue): parallelController.tsと統合予定
  // 現在はモックデータを返す
  return {
    position: 1,
    total: 3,
    estimatedWaitTime: 120, // 2分
  };
}

/**
 * セッションを作成
 */
export function createSession(
  threadId: string,
  options: StartCommandOptions,
  userId: string,
  guildId: string,
): void {
  // TODO(session): sessionManager.tsと統合予定
  console.log(
    `セッション作成: ${threadId}, repo: ${options.repository}, branch: ${options.branch || 'main'}`,
  );

  // リポジトリ使用履歴を記録
  defaultRepositoryAutocomplete.recordRepositoryUsage(options.repository);

  // 現在は基本的なログ出力のみ
  const sessionInfo = {
    threadId,
    repository: options.repository,
    branch: options.branch || 'main',
    userId,
    guildId,
    createdAt: new Date().toISOString(),
  };

  console.log('セッション情報:', sessionInfo);
}

/**
 * セッション開始のEmbed を作成
 */
export function createSessionStartEmbed(
  options: StartCommandOptions,
  queuePosition: QueuePosition,
): DiscordEmbed {
  const embed = {
    title: '🚀 Claude セッション作成',
    color: 0x0099ff, // 青色
    fields: [
      {
        name: '📁 リポジトリ',
        value: options.repository,
        inline: true,
      },
      {
        name: '🌿 ブランチ',
        value: options.branch || 'main',
        inline: true,
      },
      {
        name: '📊 ステータス',
        value: queuePosition.position === 1 ? '🟢 実行中' : '⏳ 待機中',
        inline: true,
      },
    ],
    footer: {
      text: `キュー位置: ${queuePosition.position}/${queuePosition.total}`,
    },
    timestamp: new Date().toISOString(),
  };

  if (queuePosition.position > 1 && queuePosition.estimatedWaitTime) {
    embed.fields.push({
      name: '⏱️ 推定待機時間',
      value: `約 ${Math.round(queuePosition.estimatedWaitTime / 60)} 分`,
      inline: true,
    });
  }

  return embed;
}

/**
 * セッション開始ボタンを作成
 */
export function createSessionButtons(_threadId: string): ActionRow[] {
  return [
    {
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 5, // Link
          label: '開く',
          emoji: { name: '🔗' },
          url: `https://discord.com/channels/@me/${_threadId}`,
        },
        {
          type: 2, // Button
          style: 2, // Secondary
          label: '設定変更',
          emoji: { name: '⚙️' },
          custom_id: `settings_${_threadId}`,
        },
        {
          type: 2, // Button
          style: 4, // Danger
          label: '終了',
          emoji: { name: '🛑' },
          custom_id: `end_${_threadId}`,
        },
      ],
    },
  ];
}

/**
 * /claude start コマンドの定義
 */
export const startCommand: SlashCommand = {
  name: 'start',
  description: 'Claude セッションを開始します',
  type: ApplicationCommandTypes.ChatInput, // CHAT_INPUT
  options: [
    {
      name: 'repository',
      description: '作業対象のリポジトリを選択',
      type: ApplicationCommandOptionTypes.String, // STRING
      required: true,
      autocomplete: true,
    },
    {
      name: 'branch',
      description: '使用するブランチ（省略時はmain）',
      type: ApplicationCommandOptionTypes.String, // STRING
      required: false,
    },
  ] as DiscordApplicationCommandOption[],

  /**
   * コマンド実行ハンドラ
   */
  async execute(_interaction: Interaction): Promise<void> {
    // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
    console.log('Start command executed (placeholder)');
    await Promise.resolve();

    /*
    const client = getDiscordClient();
    const bot = client.getBot();
    if (!bot) throw new Error('Bot not initialized');

    // 権限チェック
    if (!hasManageMessagesPermission(_interaction)) {
      await sendEphemeralResponse(
        bot,
        interaction,
        '❌ このコマンドを実行する権限がありません（Manage Messages権限が必要）',
      );
      return;
    }

    // オプションの解析
    const options: StartCommandOptions = {
      repository: interaction.data?.options?.find((opt) => opt.name === 'repository')
        ?.value as string,
      branch: interaction.data?.options?.find((opt) => opt.name === 'branch')?.value as string,
    };

    if (!options.repository) {
      await sendEphemeralResponse(bot, interaction, '❌ リポジトリが指定されていません');
      return;
    }

    try {
      // 初期応答（処理中表示）
      await deferResponse(bot, interaction);

      // キュー位置を取得
      const queuePosition = getQueuePosition();

      // セッション作成（スレッド作成はDiscord API側で行われる）
      const threadId = `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      createSession(
        threadId,
        options,
        interaction.user?.id || 'unknown',
        interaction.guildId?.toString() || 'unknown',
      );

      // 応答を更新
      const embed = createSessionStartEmbed(options, queuePosition);
      const buttons = createSessionButtons(threadId);

      await editOriginalInteractionResponse(bot, interaction, {
        embeds: [embed],
        components: buttons,
      });

      console.log(`セッション開始: ${options.repository} (${options.branch || 'main'})`);
    } catch (error) {
      console.error('セッション開始エラー:', error);

      await editOriginalInteractionResponse(bot, interaction, {
        content: '❌ セッションの開始に失敗しました。しばらく待ってから再試行してください。',
      });
    }
    */
  },

  /**
   * オートコンプリート処理
   */
  async autocomplete(interaction: Interaction): Promise<DiscordApplicationCommandOptionChoice[]> {
    try {
      // ユーザーの入力クエリを取得
      const query = interaction.data?.options?.find(
        (opt) => opt.name === 'repository' && opt.focused,
      )?.value as string | undefined;

      // オートコンプリート候補を取得
      const choices = await getRepositoryCandidates(query);

      return choices;
    } catch (error) {
      console.error('オートコンプリートエラー:', error);

      // エラー時は基本的な候補を返す
      return await getRepositoryCandidates();
    }
  },
};

/**
 * startコマンドを登録
 */
export function registerStartCommand(): void {
  const client = getDiscordClient();
  const bot = client.getBot();

  if (!bot) {
    throw new Error('Discord Bot が初期化されていません');
  }

  // TODO(register): 実際のコマンド登録処理を実装
  // await bot.helpers.createGlobalApplicationCommand(startCommand);
  console.log('startコマンドが登録されました');
}
