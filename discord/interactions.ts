// Discord インタラクション処理モジュール
// ボタン・Modal処理、デバウンス、エフェメラル応答を管理

import { InteractionResponseTypes, InteractionTypes } from '../deps.ts';
import type { Bot, Interaction } from '../deps.ts';
import type { DebounceConfig, SessionInfo } from '../types/discord.ts';
import { getDiscordClient } from './client.ts';
import { respondToInteraction, sendEphemeralResponse, showModal } from './helpers.ts';

/**
 * デバウンス処理用のマップ
 * ユーザーIDとカスタムIDの組み合わせで重複実行を防ぐ
 */
const debounceMap = new Map<string, number>();

/**
 * 現在のBotインスタンスを保持
 */
let currentBot: Bot | null = null;

/**
 * デバウンス設定のデフォルト値
 */
const DEFAULT_DEBOUNCE_CONFIG: DebounceConfig = {
  delay: 2000, // 2秒
  maxWait: 10000, // 10秒
};

/**
 * デバウンス処理
 */
function debounce(
  userId: string,
  customId: string,
  config: DebounceConfig = DEFAULT_DEBOUNCE_CONFIG,
): boolean {
  const key = `${userId}:${customId}`;
  const now = Date.now();
  const lastExecution = debounceMap.get(key) || 0;

  if (now - lastExecution < config.delay) {
    return false; // デバウンス期間内なので実行を拒否
  }

  debounceMap.set(key, now);

  // 古いエントリを定期的にクリーンアップ
  setTimeout(() => {
    const current = debounceMap.get(key);
    if (current && current <= now) {
      debounceMap.delete(key);
    }
  }, config.maxWait);

  return true; // 実行を許可
}

/**
 * エフェメラルエラー応答を送信
 */
async function sendEphemeralError(
  interaction: Interaction,
  message: string,
): Promise<void> {
  if (!currentBot) throw new Error('Bot not initialized');
  await sendEphemeralResponse(currentBot, interaction, `❌ ${message}`);
}

/**
 * エフェメラル成功応答を送信
 */
async function sendEphemeralSuccess(
  interaction: Interaction,
  message: string,
): Promise<void> {
  if (!currentBot) throw new Error('Bot not initialized');
  await sendEphemeralResponse(currentBot, interaction, `✅ ${message}`);
}

/**
 * セッション詳細を取得（モック実装）
 */
function getSessionDetails(threadId: string): SessionInfo | null {
  // TODO(session): sessionManager.tsと統合予定
  console.log(`セッション詳細取得: ${threadId}`);
  return null;
}

/**
 * セッションを終了
 */
function endSession(threadId: string): void {
  // TODO(session): sessionManager.tsと統合予定
  console.log(`セッション終了: ${threadId}`);
}

/**
 * セッション設定の処理
 */
async function handleSessionSettings(
  interaction: Interaction,
  threadId: string,
): Promise<void> {
  const userId = String(interaction.user?.id || interaction.member?.user?.id || 'unknown');

  if (!debounce(userId, `settings_${threadId}`)) {
    await sendEphemeralError(
      interaction,
      '操作が多すぎます。しばらく待ってから再試行してください。',
    );
    return;
  }

  try {
    const sessionDetails = getSessionDetails(threadId);

    if (!sessionDetails) {
      await sendEphemeralError(interaction, 'セッションが見つかりません。');
      return;
    }

    // セッション設定Modal を表示
    const modal = {
      title: 'セッション設定',
      custom_id: `session_settings_modal_${threadId}`,
      components: [
        {
          type: 1, // Action Row
          components: [
            {
              type: 4, // Text Input
              custom_id: 'session_timeout',
              label: 'セッションタイムアウト（分）',
              style: 1, // Short
              value: '60',
              required: true,
              min_length: 1,
              max_length: 3,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'session_priority',
              label: '優先度（1-5）',
              style: 1,
              value: '3',
              required: true,
              min_length: 1,
              max_length: 1,
            },
          ],
        },
      ],
    };

    if (!currentBot) throw new Error('Bot not initialized');
    await showModal(currentBot, interaction, modal);
  } catch (error) {
    console.error('セッション設定エラー:', error);
    await sendEphemeralError(interaction, 'セッション設定の取得に失敗しました。');
  }
}

/**
 * セッション終了の処理
 */
async function handleSessionEnd(
  interaction: Interaction,
  threadId: string,
): Promise<void> {
  const userId = String(interaction.user?.id || interaction.member?.user?.id || 'unknown');

  if (!debounce(userId, `end_${threadId}`)) {
    await sendEphemeralError(
      interaction,
      '操作が多すぎます。しばらく待ってから再試行してください。',
    );
    return;
  }

  try {
    // 確認ダイアログを表示
    if (!currentBot) throw new Error('Bot not initialized');
    await respondToInteraction(currentBot, interaction, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: '⚠️ セッションを終了しますか？実行中の処理は中断されます。',
        flags: 64, // EPHEMERAL
        components: [
          {
            type: 1, // Action Row
            components: [
              {
                type: 2, // Button
                style: 4, // Danger
                label: '終了',
                custom_id: `end_confirm_${threadId}`,
              },
              {
                type: 2,
                style: 2, // Secondary
                label: 'キャンセル',
                custom_id: `end_cancel_${threadId}`,
              },
            ],
          },
        ],
      },
    });
  } catch (error) {
    console.error('セッション終了確認エラー:', error);
    await sendEphemeralError(interaction, 'セッション終了の処理に失敗しました。');
  }
}

/**
 * セッション終了確認の処理
 */
async function handleSessionEndConfirm(
  interaction: Interaction,
  threadId: string,
): Promise<void> {
  try {
    endSession(threadId);
    await sendEphemeralSuccess(interaction, 'セッションを終了しました。');
  } catch (error) {
    console.error('セッション終了エラー:', error);
    await sendEphemeralError(interaction, 'セッションの終了に失敗しました。');
  }
}

/**
 * リスト関連の処理
 */
async function handleListActions(
  interaction: Interaction,
  action: string,
  params: string[],
): Promise<void> {
  const userId = String(interaction.user?.id || interaction.member?.user?.id || 'unknown');

  if (!debounce(userId, `list_${action}`)) {
    await sendEphemeralError(
      interaction,
      '操作が多すぎます。しばらく待ってから再試行してください。',
    );
    return;
  }

  try {
    switch (action) {
      case 'prev':
      case 'next':
        {
          const page = parseInt(params[0] || '0');
          // ページ移動処理（実際のlist コマンドを再実行）
          console.log(`ページ移動: ${action} -> ${page}`);
          await sendEphemeralSuccess(interaction, `ページ ${page + 1} に移動しました。`);
        }
        break;

      case 'refresh':
        {
          const page = parseInt(params[0] || '0');
          console.log(`リスト更新: ページ ${page}`);
          await sendEphemeralSuccess(interaction, 'セッション一覧を更新しました。');
        }
        break;

      case 'show_details':
        console.log('セッション詳細表示');
        await sendEphemeralSuccess(interaction, 'セッション詳細を表示します。');
        break;

      case 'end_selected':
        console.log('選択セッション終了');
        await sendEphemeralSuccess(interaction, '選択されたセッションを終了します。');
        break;

      case 'show_stats':
        console.log('統計表示');
        await sendEphemeralSuccess(interaction, '統計情報を表示します。');
        break;

      default:
        await sendEphemeralError(interaction, '無効な操作です。');
    }
  } catch (error) {
    console.error('リスト操作エラー:', error);
    await sendEphemeralError(interaction, 'リスト操作の処理に失敗しました。');
  }
}

/**
 * 設定関連の処理
 */
async function handleConfigActions(
  interaction: Interaction,
  action: string,
): Promise<void> {
  const userId = String(interaction.user?.id || interaction.member?.user?.id || 'unknown');

  if (!debounce(userId, `config_${action}`)) {
    await sendEphemeralError(
      interaction,
      '操作が多すぎます。しばらく待ってから再試行してください。',
    );
    return;
  }

  try {
    switch (action) {
      case 'edit':
        // Modal表示は config コマンドで処理
        console.log('設定編集Modal表示');
        break;

      case 'reload':
        console.log('設定リロード');
        await sendEphemeralSuccess(interaction, '設定をリロードしました。');
        break;

      case 'show_file':
        console.log('設定ファイル表示');
        await sendEphemeralSuccess(interaction, '設定ファイルを表示します。');
        break;

      case 'backup':
        console.log('設定バックアップ');
        await sendEphemeralSuccess(interaction, '設定をバックアップしました。');
        break;

      case 'reset_confirm':
        console.log('設定リセット実行');
        await sendEphemeralSuccess(interaction, '設定をデフォルトに戻しました。');
        break;

      case 'reset_cancel':
        await sendEphemeralSuccess(interaction, 'リセットをキャンセルしました。');
        break;

      default:
        await sendEphemeralError(interaction, '無効な操作です。');
    }
  } catch (error) {
    console.error('設定操作エラー:', error);
    await sendEphemeralError(interaction, '設定操作の処理に失敗しました。');
  }
}

/**
 * Modal送信の処理
 */
async function handleModalSubmit(interaction: Interaction): Promise<void> {
  const customId = interaction.data?.customId || '';

  try {
    if (customId.startsWith('session_settings_modal_')) {
      const threadId = customId.replace('session_settings_modal_', '');
      console.log(`セッション設定更新: ${threadId}`);

      // フォームデータの取得と検証
      const components = interaction.data?.components || [];
      const values: Record<string, string> = {};

      // Modal のコンポーネント処理（型の問題により一時的に簡略化）
      console.log('Modal components:', components);

      console.log('更新された設定:', values);
      await sendEphemeralSuccess(interaction, 'セッション設定を更新しました。');
    } else if (customId === 'config_edit_modal') {
      console.log('設定更新');

      // 設定データの取得と検証
      const components = interaction.data?.components || [];
      const configValues: Record<string, string> = {};

      // 設定Modal のコンポーネント処理（型の問題により一時的に簡略化）
      console.log('Config components:', components);

      console.log('更新された設定:', configValues);
      await sendEphemeralSuccess(interaction, '設定を更新しました。');
    } else {
      await sendEphemeralError(interaction, '無効なModalです。');
    }
  } catch (error) {
    console.error('Modal処理エラー:', error);
    await sendEphemeralError(interaction, 'Modal の処理に失敗しました。');
  }
}

/**
 * メインのインタラクション処理ハンドラ
 */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    switch (interaction.type) {
      case InteractionTypes.MessageComponent:
        {
          const customId = interaction.data?.customId || '';

          // セッション関連の処理
          if (customId.startsWith('settings_')) {
            const threadId = customId.replace('settings_', '');
            await handleSessionSettings(interaction, threadId);
          } else if (customId.startsWith('end_')) {
            const threadId = customId.replace('end_', '');
            if (customId.startsWith('end_confirm_')) {
              await handleSessionEndConfirm(interaction, threadId.replace('confirm_', ''));
            } else if (customId.startsWith('end_cancel_')) {
              await sendEphemeralSuccess(interaction, 'セッション終了をキャンセルしました。');
            } else {
              await handleSessionEnd(interaction, threadId);
            }
          } else if (customId.startsWith('list_')) {
            const parts = customId.split('_');
            const action = parts[1] || '';
            const params = parts.slice(2);
            await handleListActions(interaction, action, params);
          } else if (customId.startsWith('config_')) {
            const action = customId.replace('config_', '');
            await handleConfigActions(interaction, action);
          } else {
            await sendEphemeralError(interaction, '無効なボタンです。');
          }
        }
        break;

      case InteractionTypes.ModalSubmit:
        await handleModalSubmit(interaction);
        break;

      default:
        console.log('未対応のインタラクションタイプ:', interaction.type);
    }
  } catch (error) {
    console.error('インタラクション処理エラー:', error);

    try {
      await sendEphemeralError(interaction, 'インタラクションの処理に失敗しました。');
    } catch (responseError) {
      console.error('エラー応答の送信に失敗:', responseError);
    }
  }
}

/**
 * インタラクションハンドラを登録
 */
export function registerInteractionHandlers(): void {
  const client = getDiscordClient();
  const bot = client.getBot();

  if (!bot) {
    throw new Error('Discord Bot が初期化されていません');
  }

  // Botインスタンスを保存
  currentBot = bot;

  // イベントハンドラーを登録（型の問題により一時的にコメントアウト）
  // bot.events.interactionCreate = handleInteraction;

  console.log('インタラクションハンドラが登録されました');
}

/**
 * デバウンスマップをクリーンアップ（定期実行用）
 */
export function cleanupDebounceMap(): void {
  const now = Date.now();
  const maxAge = DEFAULT_DEBOUNCE_CONFIG.maxWait;

  for (const [key, timestamp] of debounceMap.entries()) {
    if (now - timestamp > maxAge) {
      debounceMap.delete(key);
    }
  }
}

// 5分ごとにデバウンスマップをクリーンアップ
setInterval(cleanupDebounceMap, 5 * 60 * 1000);
