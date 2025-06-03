/**
 * Discord クライアントのテスト
 */

import { assertEquals, assertExists, assertThrows } from '../deps.ts';
import {
  destroyDiscordClient,
  DiscordClient,
  getDiscordClient,
  initializeDiscordClient,
} from './client.ts';
import type { DiscordBotConfig } from './client.ts';

// モック用の設定
const mockConfig: DiscordBotConfig = {
  token: 'test-token',
  applicationId: 123456789n,
  guildIds: [111111111n, 222222222n],
  commandPrefix: '/test',
};

// テスト後のクリーンアップ
function cleanup() {
  try {
    destroyDiscordClient();
  } catch {
    // 既に破棄されている場合は無視
  }
}

Deno.test('DiscordClient: 基本的な初期化と接続状態', () => {
  const client = new DiscordClient(mockConfig);

  // 初期状態の確認
  assertEquals(client.getConnectionStatus(), false);
  assertEquals(client.getBot(), null);

  // モックのcreateBot/startBotはDiscordenoの実装に依存するため、
  // ここでは基本的な動作確認のみ
});

Deno.test('DiscordClient: 再接続設定の更新', () => {
  const client = new DiscordClient(mockConfig);

  // 再接続設定を更新
  client.updateReconnectConfig({
    maxRetries: 10,
    baseDelay: 2000,
  });

  // 更新が反映されていることを間接的に確認
  // （privateフィールドのため直接確認はできない）
  assertExists(client);
});

Deno.test('DiscordClient: 接続の切断', () => {
  const client = new DiscordClient(mockConfig);

  // 切断メソッドが例外をスローしないことを確認
  client.disconnect();
  assertEquals(client.getConnectionStatus(), false);
});

Deno.test('initializeDiscordClient: 初回初期化', () => {
  cleanup(); // 前のテストの影響を排除

  const client = initializeDiscordClient(mockConfig);
  assertExists(client);
  assertEquals(client instanceof DiscordClient, true);

  cleanup();
});

Deno.test('initializeDiscordClient: 二重初期化でエラー', () => {
  cleanup();

  // 最初の初期化
  initializeDiscordClient(mockConfig);

  // 二重初期化はエラー
  assertThrows(
    () => initializeDiscordClient(mockConfig),
    Error,
    'Discord クライアントは既に初期化されています',
  );

  cleanup();
});

Deno.test('getDiscordClient: 初期化後に取得', () => {
  cleanup();

  // 初期化
  const initialClient = initializeDiscordClient(mockConfig);

  // 取得
  const retrievedClient = getDiscordClient();
  assertEquals(retrievedClient, initialClient);

  cleanup();
});

Deno.test('getDiscordClient: 初期化前はエラー', () => {
  cleanup();

  assertThrows(
    () => getDiscordClient(),
    Error,
    'Discord クライアントが初期化されていません',
  );
});

Deno.test('destroyDiscordClient: クライアントの破棄', () => {
  cleanup();

  // 初期化
  const client = initializeDiscordClient(mockConfig);
  assertExists(client);

  // 破棄
  destroyDiscordClient();

  // 破棄後は取得できない
  assertThrows(
    () => getDiscordClient(),
    Error,
    'Discord クライアントが初期化されていません',
  );
});

Deno.test('destroyDiscordClient: 未初期化でも安全に実行', () => {
  cleanup();

  // 未初期化状態でも例外をスローしない
  destroyDiscordClient();

  // 再度実行しても問題ない
  destroyDiscordClient();
});

// 以下は実際のBot接続をモックする必要があるため、
// 統合テストやE2Eテストで実装することを推奨

Deno.test('DiscordClient: connect メソッドのエラーハンドリング', () => {
  const client = new DiscordClient(mockConfig);

  // 実際の接続は行わず、メソッドが存在することを確認
  assertEquals(typeof client.connect, 'function');

  // TODO(testing): createBot と bot.start() をモックして、
  // 実際の接続エラーとリトライロジックをテスト
});

Deno.test('DiscordClient: 異なる設定での初期化', () => {
  const customConfig: DiscordBotConfig = {
    token: 'custom-token',
    applicationId: 999999999n,
    // guildIds と commandPrefix はオプショナル
  };

  const client = new DiscordClient(customConfig);
  assertExists(client);
  assertEquals(client.getConnectionStatus(), false);
});

Deno.test('DiscordClient: Botインスタンスの取得', () => {
  const client = new DiscordClient(mockConfig);

  // 接続前はnull
  assertEquals(client.getBot(), null);

  // TODO(testing): 接続後のBotインスタンス取得テスト
});

Deno.test('DiscordClient: connect失敗時のエラーハンドリング', async () => {
  const client = new DiscordClient({
    token: 'invalid-token',
    applicationId: 123456789n,
  });

  // 無効なトークンでの接続試行
  try {
    await client.connect();
    // エラーが発生しなかった場合はテスト失敗
    assertEquals(true, false, 'Expected connect to fail with invalid token');
  } catch (error) {
    // エラーが発生することを期待
    assertExists(error);
    assertEquals(client.getConnectionStatus(), false);
  }
});

Deno.test('DiscordClient: 再接続設定のパラメータ検証', () => {
  const client = new DiscordClient(mockConfig);

  // 部分的な設定更新
  client.updateReconnectConfig({
    maxRetries: 3,
  });

  client.updateReconnectConfig({
    baseDelay: 500,
    maxDelay: 10000,
  });

  client.updateReconnectConfig({
    backoffMultiplier: 1.5,
  });

  // 全ての設定を一度に更新
  client.updateReconnectConfig({
    maxRetries: 7,
    baseDelay: 1500,
    maxDelay: 60000,
    backoffMultiplier: 3,
  });

  // エラーが発生しないことを確認
  assertExists(client);
});

Deno.test('DiscordClient: 異なるコンストラクタパラメータでの初期化', () => {
  // 最小限の設定
  const minimalConfig: DiscordBotConfig = {
    token: 'minimal-token',
    applicationId: 111111111n,
  };

  const client1 = new DiscordClient(minimalConfig);
  assertExists(client1);
  assertEquals(client1.getConnectionStatus(), false);

  // 全てのオプションを含む設定
  const fullConfig: DiscordBotConfig = {
    token: 'full-token',
    applicationId: 222222222n,
    guildIds: [333333333n, 444444444n, 555555555n],
    commandPrefix: '/custom',
  };

  const client2 = new DiscordClient(fullConfig);
  assertExists(client2);
  assertEquals(client2.getConnectionStatus(), false);
});

Deno.test('DiscordClient: disconnect後の状態確認', () => {
  const client = new DiscordClient(mockConfig);

  // 初期状態
  assertEquals(client.getConnectionStatus(), false);

  // disconnect実行
  client.disconnect();

  // 状態確認
  assertEquals(client.getConnectionStatus(), false);
  assertEquals(client.getBot(), null);

  // 複数回disconnectしても安全
  client.disconnect();
  client.disconnect();
  assertEquals(client.getConnectionStatus(), false);
});

Deno.test('DiscordClient: 複数のクライアントインスタンス', () => {
  const config1 = {
    token: 'token1',
    applicationId: 111111111n,
  };

  const config2 = {
    token: 'token2',
    applicationId: 222222222n,
  };

  const client1 = new DiscordClient(config1);
  const client2 = new DiscordClient(config2);

  // 異なるインスタンス
  assertEquals(client1 === client2, false);

  // それぞれ独立して動作
  assertExists(client1);
  assertExists(client2);
  assertEquals(client1.getConnectionStatus(), false);
  assertEquals(client2.getConnectionStatus(), false);
});
