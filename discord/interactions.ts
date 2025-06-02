/**
 * Discord インタラクション（ボタン、モーダル等）の処理
 */

import { discord } from '../deps.ts';
import { logger } from '../logger.ts';
import { ButtonInteractionData } from '../types/discord.ts';

/** デバウンス用のマップ（連打対策） */
const interactionDebounce = new Map<string, number>();
const DEBOUNCE_TIME = 3000; // 3秒

/**
 * インタラクションハンドラをセットアップする
 * @param bot Botインスタンス
 */
export function setupInteractions(bot: discord.Bot): void {
  logger.debug('インタラクションハンドラをセットアップしました');
}

/**
 * ボタンインタラクションを処理する
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
export async function handleButtonInteraction(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  if (!interaction.data?.customId) return;

  // デバウンスチェック
  const debounceKey = `${interaction.user.id}-${interaction.data.customId}`;
  if (isDebounced(debounceKey)) {
    await respondEphemeral(interaction, bot, '⏳ 少し待ってから再度お試しください。');
    return;
  }
  setDebounce(debounceKey);

  try {
    // カスタムIDをパース
    const data = parseCustomId(interaction.data.customId);

    switch (data.action) {
      case 'session_open':
        await handleSessionOpen(interaction, bot, data);
        break;
      case 'session_end':
        await handleSessionEnd(interaction, bot, data);
        break;
      case 'session_restart':
        await handleSessionRestart(interaction, bot, data);
        break;
      case 'session_details':
        await handleSessionDetails(interaction, bot, data);
        break;
      case 'config_edit':
        await handleConfigEdit(interaction, bot);
        break;
      default:
        logger.warn(`未知のボタンアクション: ${data.action}`);
    }
  } catch (error) {
    logger.error('ボタンインタラクションエラー:', { error: error.message });
    await respondEphemeral(interaction, bot, '❌ エラーが発生しました。');
  }
}

/**
 * モーダルインタラクションを処理する
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
export async function handleModalInteraction(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  if (!interaction.data?.customId) return;

  try {
    const data = parseCustomId(interaction.data.customId);

    switch (data.action) {
      case 'config_modal':
        await handleConfigModalSubmit(interaction, bot);
        break;
      default:
        logger.warn(`未知のモーダルアクション: ${data.action}`);
    }
  } catch (error) {
    logger.error('モーダルインタラクションエラー:', { error: error.message });
    await respondEphemeral(interaction, bot, '❌ エラーが発生しました。');
  }
}

/**
 * カスタムIDをパースする
 * @param customId カスタムID
 * @returns パースされたデータ
 */
function parseCustomId(customId: string): ButtonInteractionData {
  try {
    const [action, ...dataParts] = customId.split(':');
    const data: Record<string, string> = {};

    // key=value形式でパース
    for (const part of dataParts) {
      const [key, value] = part.split('=');
      if (key && value) {
        data[key] = value;
      }
    }

    return { action, data };
  } catch {
    return { action: customId };
  }
}

/**
 * デバウンス中かチェックする
 * @param key デバウンスキー
 * @returns デバウンス中の場合true
 */
function isDebounced(key: string): boolean {
  const lastTime = interactionDebounce.get(key);
  if (!lastTime) return false;

  const now = Date.now();
  return now - lastTime < DEBOUNCE_TIME;
}

/**
 * デバウンスを設定する
 * @param key デバウンスキー
 */
function setDebounce(key: string): void {
  interactionDebounce.set(key, Date.now());

  // 古いエントリを削除
  setTimeout(() => {
    interactionDebounce.delete(key);
  }, DEBOUNCE_TIME * 2);
}

/**
 * エフェメラル応答を送信する
 * @param interaction インタラクション
 * @param bot Botインスタンス
 * @param content メッセージ内容
 */
async function respondEphemeral(
  interaction: discord.Interaction,
  bot: discord.Bot,
  content: string,
): Promise<void> {
  await discord.respondToInteraction(bot, interaction, {
    content,
    flags: discord.InteractionResponseFlags.Ephemeral,
  });
}

/**
 * セッションを開くボタンの処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 * @param data ボタンデータ
 */
async function handleSessionOpen(
  interaction: discord.Interaction,
  bot: discord.Bot,
  data: ButtonInteractionData,
): Promise<void> {
  const threadId = data.data?.threadId;
  if (!threadId) {
    await respondEphemeral(interaction, bot, '❌ スレッドIDが見つかりません。');
    return;
  }

  // TODO(@discord): 実際のスレッドへのジャンプリンクを生成
  await respondEphemeral(
    interaction,
    bot,
    `📂 スレッドを開きます: ${threadId}`,
  );
}

/**
 * セッション終了ボタンの処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 * @param data ボタンデータ
 */
async function handleSessionEnd(
  interaction: discord.Interaction,
  bot: discord.Bot,
  data: ButtonInteractionData,
): Promise<void> {
  const sessionId = data.data?.sessionId;
  if (!sessionId) {
    await respondEphemeral(interaction, bot, '❌ セッションIDが見つかりません。');
    return;
  }

  // 確認メッセージを送信
  await discord.respondToInteraction(bot, interaction, {
    content: `⚠️ セッション ${sessionId} を終了しますか？`,
    flags: discord.InteractionResponseFlags.Ephemeral,
    components: [{
      type: discord.ComponentTypes.ActionRow,
      components: [
        {
          type: discord.ComponentTypes.Button,
          style: discord.ButtonStyles.Danger,
          label: '終了する',
          customId: `session_end_confirm:sessionId=${sessionId}`,
        },
        {
          type: discord.ComponentTypes.Button,
          style: discord.ButtonStyles.Secondary,
          label: 'キャンセル',
          customId: 'cancel',
        },
      ],
    }],
  });
}

/**
 * セッション再起動ボタンの処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 * @param data ボタンデータ
 */
async function handleSessionRestart(
  interaction: discord.Interaction,
  bot: discord.Bot,
  data: ButtonInteractionData,
): Promise<void> {
  const sessionId = data.data?.sessionId;
  if (!sessionId) {
    await respondEphemeral(interaction, bot, '❌ セッションIDが見つかりません。');
    return;
  }

  // TODO(@discord): セッション再起動処理
  await respondEphemeral(
    interaction,
    bot,
    `🔄 セッション ${sessionId} を再起動しています...`,
  );
}

/**
 * セッション詳細ボタンの処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 * @param data ボタンデータ
 */
async function handleSessionDetails(
  interaction: discord.Interaction,
  bot: discord.Bot,
  data: ButtonInteractionData,
): Promise<void> {
  const sessionId = data.data?.sessionId;
  if (!sessionId) {
    await respondEphemeral(interaction, bot, '❌ セッションIDが見つかりません。');
    return;
  }

  // TODO(@discord): セッション詳細を取得して表示
  const embed: discord.Embed = {
    title: 'セッション詳細',
    description: `セッションID: ${sessionId}`,
    color: 0x5865f2,
    fields: [
      { name: 'リポジトリ', value: 'example-repo', inline: true },
      { name: 'ステータス', value: '🟢 実行中', inline: true },
      { name: '稼働時間', value: '00:12:34', inline: true },
      { name: 'メモリ使用量', value: '256MB', inline: true },
      { name: 'CPU使用率', value: '45%', inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  await discord.respondToInteraction(bot, interaction, {
    embeds: [embed],
    flags: discord.InteractionResponseFlags.Ephemeral,
  });
}

/**
 * 設定編集ボタンの処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
async function handleConfigEdit(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  // モーダルを表示
  await discord.respondToInteraction(bot, interaction, {
    type: discord.InteractionResponseTypes.Modal,
    data: {
      title: '設定の編集',
      customId: 'config_modal',
      components: [
        {
          type: discord.ComponentTypes.ActionRow,
          components: [{
            type: discord.ComponentTypes.TextInput,
            style: discord.TextInputStyles.Short,
            label: '最大セッション数',
            customId: 'max_sessions',
            placeholder: '1-10の範囲で入力',
            required: true,
            minLength: 1,
            maxLength: 2,
            value: '3',
          }],
        },
        {
          type: discord.ComponentTypes.ActionRow,
          components: [{
            type: discord.ComponentTypes.TextInput,
            style: discord.TextInputStyles.Short,
            label: 'ログレベル',
            customId: 'log_level',
            placeholder: 'TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
            required: true,
            value: 'INFO',
          }],
        },
      ],
    },
  });
}

/**
 * 設定モーダルの送信処理
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
async function handleConfigModalSubmit(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  const values = interaction.data?.components?.[0]?.components?.[0]?.value;

  // TODO(@discord): 設定を保存
  await respondEphemeral(
    interaction,
    bot,
    '✅ 設定を更新しました。',
  );
}
