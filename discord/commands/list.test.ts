/**
 * list コマンドのテスト
 */

import { assertEquals, assertExists, assertThrows } from '../../deps.ts';
import {
  calculatePagination,
  createPaginationButtons,
  createSessionActionButtons,
  createSessionListEmbed,
  getAllSessions,
  listCommand,
  registerListCommand,
} from './list.ts';
import { SessionState } from '../../types/discord.ts';
import type { SessionInfo } from '../../types/discord.ts';
import type { DiscordApplicationCommandOption } from '../../deps.ts';
import { destroyDiscordClient, initializeDiscordClient } from '../client.ts';
import type { MockButtonComponent } from '../../types/test-utils.ts';

// モックセッション作成ヘルパー
function createMockSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const now = new Date();
  return {
    threadId: 'thread_123456789',
    repository: 'test-repo',
    worktreePath: '/tmp/worktree/test-repo-123',
    containerId: 'container_abc123',
    state: SessionState.RUNNING,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    metadata: {
      userId: 'user_001',
      guildId: 'guild_001',
      startedAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

Deno.test('getAllSessions: モックセッションデータを返す', () => {
  const sessions = getAllSessions();

  assertExists(sessions);
  assertEquals(Array.isArray(sessions), true);
  assertEquals(sessions.length, 3);

  // 最初のセッション
  const firstSession = sessions[0]!;
  assertEquals(firstSession.threadId, 'thread_123456789');
  assertEquals(firstSession.repository, 'core-api');
  assertEquals(firstSession.state as string, 'RUNNING'); // list.tsでは文字列をキャストしている

  // 2番目のセッション
  const secondSession = sessions[1]!;
  assertEquals(secondSession.threadId, 'thread_987654321');
  assertEquals(secondSession.repository, 'web-admin');
  assertEquals(secondSession.state as string, 'WAITING'); // list.tsでは文字列をキャストしている

  // 3番目のセッション
  const thirdSession = sessions[2]!;
  assertEquals(thirdSession.threadId, 'thread_456789123');
  assertEquals(thirdSession.repository, 'auth-service');
  assertEquals(thirdSession.state as string, 'ERROR'); // list.tsでは文字列をキャストしている
});

Deno.test('calculatePagination: 正しいページネーション計算', () => {
  // デフォルト値でのテスト
  const pagination1 = calculatePagination(25);
  assertEquals(pagination1.page, 0);
  assertEquals(pagination1.pageSize, 10);
  assertEquals(pagination1.totalItems, 25);
  assertEquals(pagination1.totalPages, 3);

  // カスタムページサイズ
  const pagination2 = calculatePagination(25, 1, 5);
  assertEquals(pagination2.page, 1);
  assertEquals(pagination2.pageSize, 5);
  assertEquals(pagination2.totalItems, 25);
  assertEquals(pagination2.totalPages, 5);

  // 範囲外のページ番号（上限）
  const pagination3 = calculatePagination(25, 10, 10);
  assertEquals(pagination3.page, 2); // 最大ページ（0ベース）

  // 範囲外のページ番号（下限）
  const pagination4 = calculatePagination(25, -1, 10);
  assertEquals(pagination4.page, 0);

  // アイテムなし
  const pagination5 = calculatePagination(0);
  assertEquals(pagination5.page, 0);
  assertEquals(pagination5.totalPages, 1);
});

Deno.test('createSessionListEmbed: セッション一覧Embedを作成', () => {
  const sessions = [
    createMockSession({ repository: 'repo1', state: SessionState.RUNNING }),
    createMockSession({ repository: 'repo2', state: SessionState.WAITING }),
    createMockSession({ repository: 'repo3', state: SessionState.ERROR }),
  ];

  const pagination = {
    page: 0,
    pageSize: 10,
    totalItems: 3,
    totalPages: 1,
  };

  const embed = createSessionListEmbed(sessions, pagination);

  assertExists(embed);
  assertEquals(embed.title, '📋 Claude セッション一覧');
  assertEquals(embed.color, 0x0099ff);
  assertEquals(embed.description, '総セッション数: 3');
  assertExists(embed.fields);

  // ヘッダー行 + 3セッション = 4フィールド
  assertEquals(embed.fields.length, 4);

  // ヘッダー行の確認
  const headerField = embed.fields[0]!;
  assertEquals(headerField.value, '`Thread ID    Repository     Status  Uptime`');

  // フッターの確認
  assertExists(embed.footer);
  assertEquals(embed.footer!.text, 'ページ 1/1');

  assertExists(embed.timestamp);
});

Deno.test('createSessionListEmbed: セッションがない場合', () => {
  const sessions: SessionInfo[] = [];
  const pagination = {
    page: 0,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
  };

  const embed = createSessionListEmbed(sessions, pagination);

  assertExists(embed.fields);
  assertEquals(embed.fields.length, 1);

  const noSessionField = embed.fields[0]!;
  assertEquals(noSessionField.name, 'セッションなし');
  assertEquals(noSessionField.value, 'アクティブなセッションはありません');
});

Deno.test('createPaginationButtons: ページネーションボタンを作成', () => {
  // 最初のページ
  const pagination1 = { page: 0, pageSize: 10, totalItems: 30, totalPages: 3 };
  const buttons1 = createPaginationButtons(pagination1);

  assertExists(buttons1);
  assertEquals(buttons1.length, 1);

  const row1 = buttons1[0]!;
  assertEquals(row1.type, 1);
  assertEquals(row1.components.length, 4);

  // 前ボタンは無効
  const prevButton1 = row1.components[0] as MockButtonComponent;
  assertEquals(prevButton1.disabled, true);
  assertEquals(prevButton1.label, '◀ 前');

  // ページ情報
  const pageInfo1 = row1.components[1] as MockButtonComponent;
  assertEquals(pageInfo1.label, '1/3');
  assertEquals(pageInfo1.disabled, true);

  // 次ボタンは有効
  const nextButton1 = row1.components[2] as MockButtonComponent;
  assertEquals(nextButton1.disabled, false);
  assertEquals(nextButton1.label, '次 ▶');

  // 更新ボタン
  const refreshButton1 = row1.components[3] as MockButtonComponent;
  assertEquals(refreshButton1.label, '🔄 更新');
  assertEquals(refreshButton1.style, 1);

  // 中間ページ
  const pagination2 = { page: 1, pageSize: 10, totalItems: 30, totalPages: 3 };
  const buttons2 = createPaginationButtons(pagination2);
  const row2 = buttons2[0]!;

  // 前ボタンは有効
  const prevButton2 = row2.components[0] as MockButtonComponent;
  assertEquals(prevButton2.disabled, false);

  // ページ情報
  const pageInfo2 = row2.components[1] as MockButtonComponent;
  assertEquals(pageInfo2.label, '2/3');

  // 次ボタンも有効
  const nextButton2 = row2.components[2] as MockButtonComponent;
  assertEquals(nextButton2.disabled, false);
});

Deno.test('createSessionActionButtons: セッション操作ボタンを作成', () => {
  const buttons = createSessionActionButtons();

  assertExists(buttons);
  assertEquals(buttons.length, 1);

  const row = buttons[0]!;
  assertEquals(row.type, 1);
  assertEquals(row.components.length, 3);

  // 詳細表示ボタン
  const detailsButton = row.components[0] as MockButtonComponent;
  assertEquals(detailsButton.label, '🔍 詳細表示');
  assertEquals(detailsButton.style, 1);
  assertEquals(detailsButton.custom_id, 'list_show_details');

  // 選択終了ボタン
  const endButton = row.components[1] as MockButtonComponent;
  assertEquals(endButton.label, '🛑 選択終了');
  assertEquals(endButton.style, 4);
  assertEquals(endButton.custom_id, 'list_end_selected');

  // 統計表示ボタン
  const statsButton = row.components[2] as MockButtonComponent;
  assertEquals(statsButton.label, '📊 統計表示');
  assertEquals(statsButton.style, 2);
  assertEquals(statsButton.custom_id, 'list_show_stats');
});

Deno.test('listCommand: コマンド定義の確認', () => {
  assertExists(listCommand);
  assertEquals(listCommand.name, 'list');
  assertEquals(listCommand.description, 'アクティブなClaude セッション一覧を表示します');
  assertEquals(listCommand.type, 1); // ApplicationCommandTypes.ChatInput

  // オプションの確認
  assertExists(listCommand.options);
  assertEquals(listCommand.options!.length, 1);

  const pageOption = listCommand.options![0] as DiscordApplicationCommandOption;
  assertEquals(pageOption.name, 'page');
  assertEquals(pageOption.type, 4); // INTEGER
  assertEquals(pageOption.required, false);
  assertEquals((pageOption as { min_value?: number }).min_value, 1);
});

Deno.test('listCommand.execute: 実行ハンドラの存在確認', async () => {
  // 現在はプレースホルダー実装
  assertEquals(typeof listCommand.execute, 'function');

  // エラーなく実行できることを確認
  const mockInteraction = {};
  await listCommand.execute(mockInteraction as Parameters<typeof listCommand.execute>[0]);
});

Deno.test('listCommand.autocomplete: 空の配列を返す', () => {
  // list.tsの実装では引数なしで呼び出される
  const listCommandImpl = listCommand as unknown as { autocomplete: () => unknown[] };
  const result = listCommandImpl.autocomplete();
  assertExists(result);
  assertEquals(Array.isArray(result), true);
  assertEquals(result.length, 0);
});

Deno.test('registerListCommand: Botが初期化されていない場合エラー', () => {
  // クライアントをクリーンアップ
  try {
    destroyDiscordClient();
  } catch {
    // 既に破棄されている場合は無視
  }

  assertThrows(
    () => registerListCommand(),
    Error,
    'Discord クライアントが初期化されていません',
  );
});

Deno.test('registerListCommand: Botが初期化されている場合', () => {
  // クライアントを初期化
  try {
    destroyDiscordClient();
  } catch {
    // 既に破棄されている場合は無視
  }

  initializeDiscordClient({
    token: 'test-token',
    applicationId: 123456789n,
  });

  // 現在の実装では、Bot インスタンスは connect() 時に作成される
  try {
    registerListCommand();
  } catch (error) {
    const err = error as Error;
    // 期待されるエラー
    assertEquals(err.message, 'Discord Bot が初期化されていません');
  }

  // クリーンアップ
  destroyDiscordClient();
});
