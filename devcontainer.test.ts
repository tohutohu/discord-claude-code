// devcontainer.ts のテスト

import { assertEquals, assertExists, assertRejects, assertThrows } from './deps.ts';
import {
  checkDevContainerConfig,
  createDefaultDevContainerConfig,
  createDevContainerConfig,
  DevContainerManager,
  disposeAllDevContainerManagers,
  findAvailablePort,
  getDevContainerManager,
  readDevContainerConfig,
  resolvePortConflicts,
} from './devcontainer.ts';

// テスト用のワークスペースパス
const testWorkspaceFolder = '/tmp/test-devcontainer-workspace';

// テスト前後の環境セットアップ・クリーンアップ
async function setupTestWorkspace() {
  try {
    await Deno.remove(testWorkspaceFolder, { recursive: true });
  } catch {
    // ディレクトリが存在しない場合は無視
  }

  await Deno.mkdir(testWorkspaceFolder, { recursive: true });
}

async function cleanupTestWorkspace() {
  try {
    await Deno.remove(testWorkspaceFolder, { recursive: true });
  } catch {
    // 無視
  }

  disposeAllDevContainerManagers();
}

Deno.test('デフォルトDevContainer設定生成', () => {
  const config = createDefaultDevContainerConfig();

  assertExists(config);
  assertEquals(config.name, 'Claude Development Environment');
  assertEquals(config.workspaceFolder, '/workspace');
  assertExists(config.features);
  assertExists(config.customizations);
  assertExists(config.forwardPorts);
  assertEquals(Array.isArray(config.forwardPorts), true);
  assertExists(config.containerEnv);
  assertEquals(config.containerEnv?.['TZ'], 'Asia/Tokyo');
});

Deno.test('DevContainer設定ファイル存在確認 - 存在しない場合', async () => {
  await setupTestWorkspace();

  try {
    const exists = await checkDevContainerConfig(testWorkspaceFolder);
    assertEquals(exists, false);
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainer設定ファイル作成と読み込み', async () => {
  await setupTestWorkspace();

  try {
    // 設定ファイル作成
    const customConfig = {
      name: 'Test Container',
      image: 'node:18',
      workspaceFolder: '/test',
    };

    await createDevContainerConfig(testWorkspaceFolder, customConfig);

    // 存在確認
    const exists = await checkDevContainerConfig(testWorkspaceFolder);
    assertEquals(exists, true);

    // 読み込み確認
    const config = await readDevContainerConfig(testWorkspaceFolder);
    assertEquals(config.name, 'Test Container');
    assertEquals(config.image, 'node:18');
    assertEquals(config.workspaceFolder, '/test');

    // デフォルト値がマージされていることを確認
    assertExists(config.features);
    assertExists(config.containerEnv);
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainer設定ファイル作成 - デフォルト設定', async () => {
  await setupTestWorkspace();

  try {
    await createDevContainerConfig(testWorkspaceFolder);

    const config = await readDevContainerConfig(testWorkspaceFolder);
    assertEquals(config.name, 'Claude Development Environment');
    assertEquals(config.workspaceFolder, '/workspace');
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('存在しない設定ファイル読み込みエラー', async () => {
  await setupTestWorkspace();

  try {
    await assertRejects(
      async () => {
        await readDevContainerConfig(testWorkspaceFolder);
      },
      Error,
      'devcontainer.jsonの読み込みに失敗',
    );
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('利用可能ポート検索', () => {
  // 利用可能なポートを検索
  const port = findAvailablePort(10000, 10010);

  assertEquals(typeof port, 'number');
  assertEquals(port >= 10000, true);
  assertEquals(port <= 10010, true);
});

Deno.test('利用可能ポート検索 - 範囲外エラー', () => {
  // ポートをブロックしてから検索
  const testPort = 54321;
  const listener = Deno.listen({ port: testPort });

  try {
    assertThrows(
      () => {
        findAvailablePort(testPort, testPort);
      },
      Error,
      '利用可能なポートが見つかりません',
    );
  } finally {
    listener.close();
  }
});

Deno.test('ポート競合解決', async () => {
  await setupTestWorkspace();

  try {
    // まず設定ファイルを作成
    const originalConfig = {
      name: 'Test Container',
      forwardPorts: [12345, 12346, 12347],
    };

    await createDevContainerConfig(testWorkspaceFolder, originalConfig);

    // ポート競合解決
    const resolvedConfig = await resolvePortConflicts(testWorkspaceFolder, originalConfig);

    assertExists(resolvedConfig.forwardPorts);
    assertEquals(resolvedConfig.forwardPorts.length, 3);

    // ポートが数値であることを確認
    for (const port of resolvedConfig.forwardPorts) {
      assertEquals(typeof port, 'number');
      assertEquals(port > 0, true);
    }
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('ポート競合解決 - ポートなしの場合', async () => {
  await setupTestWorkspace();

  try {
    const originalConfig = {
      name: 'Test Container',
      // forwardPortsを指定しない
    };

    const resolvedConfig = await resolvePortConflicts(testWorkspaceFolder, originalConfig);

    assertEquals(resolvedConfig, originalConfig);
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainerManager - 基本操作', async () => {
  await setupTestWorkspace();

  try {
    const manager = new DevContainerManager(testWorkspaceFolder);

    // 設定ファイル存在確認
    const hasConfig = await manager.hasConfig();
    assertEquals(hasConfig, false);

    // 設定ファイル作成
    await manager.createConfig({
      name: 'Test Manager Container',
    });

    const hasConfigAfter = await manager.hasConfig();
    assertEquals(hasConfigAfter, true);

    manager.dispose();
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainerManager - ヘルスチェック', async () => {
  await setupTestWorkspace();

  try {
    const manager = new DevContainerManager(testWorkspaceFolder);

    // ヘルスチェック機能の基本テスト（実際のコマンド実行はしない）
    // 開始と停止のみテスト
    manager.startHealthCheck(60); // 長い間隔でリークを回避
    manager.stopHealthCheck();

    manager.dispose();
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainerManager - シングルトンインスタンス', async () => {
  await setupTestWorkspace();

  try {
    const manager1 = getDevContainerManager(testWorkspaceFolder);
    const manager2 = getDevContainerManager(testWorkspaceFolder);

    // 同じインスタンスが返されることを確認
    assertEquals(manager1, manager2);

    // 末尾スラッシュありなしで同じインスタンスが返されることを確認
    const manager3 = getDevContainerManager(testWorkspaceFolder + '/');
    assertEquals(manager1, manager3);
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('JSONコメント除去テスト', async () => {
  await setupTestWorkspace();

  try {
    // コメント付きのdevcontainer.jsonを手動作成
    const devcontainerDir = `${testWorkspaceFolder}/.devcontainer`;
    await Deno.mkdir(devcontainerDir, { recursive: true });

    const jsonWithComments = `{
  // This is a comment
  "name": "Test Container",
  /* Multi-line
     comment */
  "image": "node:18",
  "workspaceFolder": "/workspace" // End comment
}`;

    await Deno.writeTextFile(`${devcontainerDir}/devcontainer.json`, jsonWithComments);

    // 読み込みテスト
    const config = await readDevContainerConfig(testWorkspaceFolder);
    assertEquals(config.name, 'Test Container');
    assertEquals(config.image, 'node:18');
    assertEquals(config.workspaceFolder, '/workspace');
  } finally {
    await cleanupTestWorkspace();
  }
});

Deno.test('DevContainerManager - 設定ファイル自動作成', async () => {
  await setupTestWorkspace();

  try {
    const manager = new DevContainerManager(testWorkspaceFolder);

    // 設定ファイルが存在しないことを確認
    assertEquals(await manager.hasConfig(), false);

    // カスタム設定で作成
    await manager.createConfig({
      name: 'Auto-created Container',
      image: 'ubuntu:22.04',
    });

    // 設定ファイルが作成されたことを確認
    assertEquals(await manager.hasConfig(), true);

    // 設定内容を確認
    const config = await readDevContainerConfig(testWorkspaceFolder);
    assertEquals(config.name, 'Auto-created Container');
    assertEquals(config.image, 'ubuntu:22.04');

    // デフォルト値がマージされていることを確認
    assertExists(config.features);
    assertExists(config.containerEnv);

    manager.dispose();
  } finally {
    await cleanupTestWorkspace();
  }
});
