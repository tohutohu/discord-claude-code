/**
 * Discord コンポーネント（ボタン、セレクトメニュー等）生成ヘルパー
 */

import { discord } from '../deps.ts';

/**
 * セッション操作ボタンを生成する
 * @param sessionId セッションID
 * @param threadId スレッドID
 * @param isRunning 実行中かどうか
 * @returns ActionRowコンポーネント
 */
export function createSessionActionButtons(
  sessionId: string,
  threadId: string,
  isRunning: boolean,
): discord.ActionRow {
  const buttons: discord.ButtonComponent[] = [
    {
      type: discord.ComponentTypes.Button,
      style: discord.ButtonStyles.Primary,
      label: '開く',
      emoji: { name: '📂' },
      customId: `session_open:threadId=${threadId}`,
    },
    {
      type: discord.ComponentTypes.Button,
      style: discord.ButtonStyles.Secondary,
      label: '詳細',
      emoji: { name: '📊' },
      customId: `session_details:sessionId=${sessionId}`,
    },
  ];

  if (isRunning) {
    buttons.push({
      type: discord.ComponentTypes.Button,
      style: discord.ButtonStyles.Danger,
      label: '終了',
      emoji: { name: '🛑' },
      customId: `session_end:sessionId=${sessionId}`,
    });
  } else {
    buttons.push({
      type: discord.ComponentTypes.Button,
      style: discord.ButtonStyles.Success,
      label: '再起動',
      emoji: { name: '🔄' },
      customId: `session_restart:sessionId=${sessionId}`,
    });
  }

  return {
    type: discord.ComponentTypes.ActionRow,
    components: buttons,
  };
}

/**
 * 完了時のアクションボタンを生成する
 * @param sessionId セッションID
 * @param hasChanges 変更があるかどうか
 * @returns ActionRowコンポーネント
 */
export function createCompletionActionButtons(
  sessionId: string,
  hasChanges: boolean,
): discord.ActionRow {
  const buttons: discord.ButtonComponent[] = [
    {
      type: discord.ComponentTypes.Button,
      style: discord.ButtonStyles.Primary,
      label: '全文表示',
      emoji: { name: '📄' },
      customId: `show_full:sessionId=${sessionId}`,
    },
  ];

  if (hasChanges) {
    buttons.push(
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: '差分確認',
        emoji: { name: '🔍' },
        customId: `show_diff:sessionId=${sessionId}`,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Success,
        label: 'コミット',
        emoji: { name: '✅' },
        customId: `commit:sessionId=${sessionId}`,
      },
    );
  }

  return {
    type: discord.ComponentTypes.ActionRow,
    components: buttons,
  };
}

/**
 * エラー時のアクションボタンを生成する
 * @param sessionId セッションID
 * @returns ActionRowコンポーネント
 */
export function createErrorActionButtons(
  sessionId: string,
): discord.ActionRow {
  return {
    type: discord.ComponentTypes.ActionRow,
    components: [
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Primary,
        label: '再試行',
        emoji: { name: '🔄' },
        customId: `retry:sessionId=${sessionId}`,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: 'ログ全文',
        emoji: { name: '📋' },
        customId: `show_logs:sessionId=${sessionId}`,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Danger,
        label: '終了',
        emoji: { name: '🛑' },
        customId: `session_end:sessionId=${sessionId}`,
      },
    ],
  };
}

/**
 * ページネーションボタンを生成する
 * @param currentPage 現在のページ（0ベース）
 * @param totalPages 総ページ数
 * @param baseCustomId ベースとなるカスタムID
 * @returns ActionRowコンポーネント
 */
export function createPaginationButtons(
  currentPage: number,
  totalPages: number,
  baseCustomId: string,
): discord.ActionRow {
  return {
    type: discord.ComponentTypes.ActionRow,
    components: [
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: '最初',
        customId: `${baseCustomId}:page=0`,
        disabled: currentPage === 0,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: '前へ',
        emoji: { name: '◀️' },
        customId: `${baseCustomId}:page=${currentPage - 1}`,
        disabled: currentPage === 0,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: `${currentPage + 1} / ${totalPages}`,
        customId: 'page_info',
        disabled: true,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: '次へ',
        emoji: { name: '▶️' },
        customId: `${baseCustomId}:page=${currentPage + 1}`,
        disabled: currentPage >= totalPages - 1,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: '最後',
        customId: `${baseCustomId}:page=${totalPages - 1}`,
        disabled: currentPage >= totalPages - 1,
      },
    ],
  };
}

/**
 * 設定編集ボタンを生成する
 * @returns ActionRowコンポーネント
 */
export function createConfigActionButtons(): discord.ActionRow {
  return {
    type: discord.ComponentTypes.ActionRow,
    components: [
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Primary,
        label: '編集',
        emoji: { name: '✏️' },
        customId: 'config_edit',
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: 'リロード',
        emoji: { name: '🔄' },
        customId: 'config_reload',
      },
    ],
  };
}

/**
 * 確認/キャンセルボタンを生成する
 * @param confirmCustomId 確認ボタンのカスタムID
 * @param confirmLabel 確認ボタンのラベル
 * @param dangerous 危険な操作かどうか
 * @returns ActionRowコンポーネント
 */
export function createConfirmationButtons(
  confirmCustomId: string,
  confirmLabel = '確認',
  dangerous = false,
): discord.ActionRow {
  return {
    type: discord.ComponentTypes.ActionRow,
    components: [
      {
        type: discord.ComponentTypes.Button,
        style: dangerous ? discord.ButtonStyles.Danger : discord.ButtonStyles.Success,
        label: confirmLabel,
        customId: confirmCustomId,
      },
      {
        type: discord.ComponentTypes.Button,
        style: discord.ButtonStyles.Secondary,
        label: 'キャンセル',
        customId: 'cancel',
      },
    ],
  };
}

/**
 * リポジトリ選択メニューを生成する
 * @param repositories リポジトリ名の配列
 * @param placeholder プレースホルダーテキスト
 * @returns ActionRowコンポーネント
 */
export function createRepositorySelectMenu(
  repositories: string[],
  placeholder = 'リポジトリを選択',
): discord.ActionRow {
  const options: discord.SelectOption[] = repositories.map((repo) => ({
    label: repo,
    value: repo,
    description: `リポジトリ: ${repo}`,
    emoji: { name: '📁' },
  }));

  return {
    type: discord.ComponentTypes.ActionRow,
    components: [
      {
        type: discord.ComponentTypes.SelectMenuString,
        customId: 'repository_select',
        placeholder,
        options,
        minValues: 1,
        maxValues: 1,
      },
    ],
  };
}
