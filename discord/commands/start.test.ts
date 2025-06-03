/**
 * start コマンドのテスト
 */

import { assertEquals, assertExists, assertThrows } from '../../deps.ts';
import {
  createSession,
  createSessionButtons,
  createSessionStartEmbed,
  getQueuePosition,
  hasManageMessagesPermission,
  registerStartCommand,
  startCommand,
} from './start.ts';
import type { StartCommandOptions } from '../../types/discord.ts';
import type { DiscordApplicationCommandOption } from '../../deps.ts';
import { destroyDiscordClient, initializeDiscordClient } from '../client.ts';
import type { MockButtonComponent } from '../../types/test-utils.ts';

Deno.test('hasManageMessagesPermission: 権限チェック（現在は常にtrue）', () => {
  // 現在はモック実装で常にtrueを返す
  const mockInteraction = {} as Parameters<typeof hasManageMessagesPermission>[0];
  assertEquals(hasManageMessagesPermission(mockInteraction), true);
});

Deno.test('getQueuePosition: キュー位置を返す', () => {
  const position = getQueuePosition();

  assertExists(position);
  assertEquals(position.position, 1);
  assertEquals(position.total, 3);
  assertEquals(position.estimatedWaitTime, 120);
});

Deno.test('createSession: セッション作成（現在はログ出力のみ）', () => {
  // エラーが発生しないことを確認
  const options: StartCommandOptions = {
    repository: 'test-repo',
    branch: 'feature-branch',
  };

  createSession('thread_123', options, 'user_001', 'guild_001');

  // ブランチ指定なしの場合
  const optionsWithoutBranch: StartCommandOptions = {
    repository: 'test-repo',
  };

  createSession('thread_456', optionsWithoutBranch, 'user_002', 'guild_002');
});

Deno.test('createSessionStartEmbed: セッション開始Embedを作成（実行中）', () => {
  const options: StartCommandOptions = {
    repository: 'test-repo',
    branch: 'develop',
  };

  const queuePosition = {
    position: 1,
    total: 3,
    estimatedWaitTime: 0,
  };

  const embed = createSessionStartEmbed(options, queuePosition);

  assertExists(embed);
  assertEquals(embed.title, '🚀 Claude セッション作成');
  assertEquals(embed.color, 0x0099ff);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 3);

  // フィールドの確認
  const repoField = embed.fields![0]!;
  assertEquals(repoField.name, '📁 リポジトリ');
  assertEquals(repoField.value, 'test-repo');
  assertEquals(repoField.inline, true);

  const branchField = embed.fields![1]!;
  assertEquals(branchField.name, '🌿 ブランチ');
  assertEquals(branchField.value, 'develop');

  const statusField = embed.fields![2]!;
  assertEquals(statusField.name, '📊 ステータス');
  assertEquals(statusField.value, '🟢 実行中');

  assertExists(embed.footer);
  assertEquals(embed.footer!.text, 'キュー位置: 1/3');
  assertExists(embed.timestamp);
});

Deno.test('createSessionStartEmbed: セッション開始Embedを作成（待機中）', () => {
  const options: StartCommandOptions = {
    repository: 'test-repo',
    // branch未指定
  };

  const queuePosition = {
    position: 2,
    total: 5,
    estimatedWaitTime: 300, // 5分
  };

  const embed = createSessionStartEmbed(options, queuePosition);

  assertExists(embed);
  assertEquals(embed.fields!.length, 4); // 待機時間フィールドが追加される

  // ブランチ未指定の場合のデフォルト値
  const branchField = embed.fields![1]!;
  assertEquals(branchField.value, 'main');

  // ステータスが待機中
  const statusField = embed.fields![2]!;
  assertEquals(statusField.value, '⏳ 待機中');

  // 推定待機時間フィールド
  const waitTimeField = embed.fields![3]!;
  assertEquals(waitTimeField.name, '⏱️ 推定待機時間');
  assertEquals(waitTimeField.value, '約 5 分');
  assertEquals(waitTimeField.inline, true);

  assertEquals(embed.footer!.text, 'キュー位置: 2/5');
});

Deno.test('createSessionButtons: セッション操作ボタンを作成', () => {
  const threadId = 'thread_test_123';
  const buttons = createSessionButtons(threadId);

  assertExists(buttons);
  assertEquals(buttons.length, 1);

  const row = buttons[0]!;
  assertEquals(row.type, 1);
  assertEquals(row.components.length, 3);

  // 開くボタン（リンク）
  const openButton = row.components[0] as MockButtonComponent;
  assertEquals(openButton.type, 2);
  assertEquals(openButton.style, 5); // Link
  assertEquals(openButton.label, '開く');
  assertExists(openButton.emoji);
  assertEquals(openButton.emoji!.name, '🔗');
  assertEquals(
    (openButton as { url?: string }).url,
    `https://discord.com/channels/@me/${threadId}`,
  );

  // 設定変更ボタン
  const settingsButton = row.components[1] as MockButtonComponent;
  assertEquals(settingsButton.style, 2); // Secondary
  assertEquals(settingsButton.label, '設定変更');
  assertEquals(settingsButton.custom_id, `settings_${threadId}`);

  // 終了ボタン
  const endButton = row.components[2] as MockButtonComponent;
  assertEquals(endButton.style, 4); // Danger
  assertEquals(endButton.label, '終了');
  assertEquals(endButton.custom_id, `end_${threadId}`);
});

Deno.test('startCommand: コマンド定義の確認', () => {
  assertExists(startCommand);
  assertEquals(startCommand.name, 'start');
  assertEquals(startCommand.description, 'Claude セッションを開始します');
  assertEquals(startCommand.type, 1); // ApplicationCommandTypes.ChatInput

  // オプションの確認
  assertExists(startCommand.options);
  assertEquals(startCommand.options!.length, 2);

  const repositoryOption = startCommand.options![0] as DiscordApplicationCommandOption;
  assertEquals(repositoryOption.name, 'repository');
  assertEquals(repositoryOption.description, '作業対象のリポジトリを選択');
  assertEquals(repositoryOption.type, 3); // STRING
  assertEquals(repositoryOption.required, true);
  assertEquals((repositoryOption as { autocomplete?: boolean }).autocomplete, true);

  const branchOption = startCommand.options![1] as DiscordApplicationCommandOption;
  assertEquals(branchOption.name, 'branch');
  assertEquals(branchOption.description, '使用するブランチ（省略時はmain）');
  assertEquals(branchOption.type, 3); // STRING
  assertEquals(branchOption.required, false);
});

Deno.test('startCommand.execute: 実行ハンドラの存在確認', async () => {
  // 現在はプレースホルダー実装
  assertEquals(typeof startCommand.execute, 'function');

  // エラーなく実行できることを確認
  const mockInteraction = {};
  await startCommand.execute(mockInteraction as Parameters<typeof startCommand.execute>[0]);
});

Deno.test('startCommand.autocomplete: リポジトリ候補を返す', () => {
  if (startCommand.autocomplete) {
    const mockInteraction = {};
    const result = startCommand.autocomplete(
      mockInteraction as Parameters<typeof startCommand.autocomplete>[0],
    ) as { name: string; value: string }[];

    assertExists(result);
    assertEquals(Array.isArray(result), true);
    assertEquals(result.length, 4);

    // 最初の候補を確認
    const firstCandidate = result[0]!;
    assertEquals(firstCandidate.name, 'core-api');
    assertEquals(firstCandidate.value, 'core-api');

    // すべての候補を確認
    const expectedRepos = ['core-api', 'web-admin', 'auth-service', 'notification-service'];
    result.forEach((candidate, index) => {
      assertEquals(candidate.name, expectedRepos[index]);
      assertEquals(candidate.value, expectedRepos[index]);
    });
  }
});

Deno.test('registerStartCommand: Botが初期化されていない場合エラー', () => {
  // クライアントをクリーンアップ
  try {
    destroyDiscordClient();
  } catch {
    // 既に破棄されている場合は無視
  }

  assertThrows(
    () => registerStartCommand(),
    Error,
    'Discord クライアントが初期化されていません',
  );
});

Deno.test('registerStartCommand: Botが初期化されている場合', () => {
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
    registerStartCommand();
  } catch (error) {
    const err = error as Error;
    // 期待されるエラー
    assertEquals(err.message, 'Discord Bot が初期化されていません');
  }

  // クリーンアップ
  destroyDiscordClient();
});
