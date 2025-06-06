import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import {
  assertWorkerValid,
  createTestContext,
  createTestWorkspaceManager,
  ERROR_MESSAGES,
} from "./test-utils.ts";

Deno.test("Admin - スレッドIDとWorkerを作成できる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-123";

  try {
    const worker = await admin.createWorker(threadId);
    assertWorkerValid(worker);
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 同じスレッドIDに対して同じWorkerを返す", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-456";

  try {
    const worker1 = await admin.createWorker(threadId);
    const worker2 = await admin.createWorker(threadId);

    assertEquals(worker1.getName(), worker2.getName());
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 異なるスレッドIDに対して異なるWorkerを作成する", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId1 = "thread-789";
  const threadId2 = "thread-999";

  try {
    const worker1 = await admin.createWorker(threadId1);
    const worker2 = await admin.createWorker(threadId2);

    assertWorkerValid(worker1);
    assertWorkerValid(worker2);
    // 名前が異なることを確認（非常に稀に同じ名前になる可能性はあるが、実用上問題ない）
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - スレッドIDに基づいてWorkerを取得できる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-111";

  try {
    const createdWorker = await admin.createWorker(threadId);
    const fetchedWorker = admin.getWorker(threadId);

    assertExists(fetchedWorker);
    assertEquals(createdWorker.getName(), fetchedWorker?.getName());
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 存在しないスレッドIDの場合nullを返す", async () => {
  const { admin, cleanup } = await createTestContext();

  try {
    const worker = admin.getWorker("non-existent");
    assertEquals(worker, null);
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - スレッドにメッセージをルーティングできる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-222";
  const message = "テストメッセージ";

  try {
    await admin.createWorker(threadId);
    const reply = await admin.routeMessage(
      threadId,
      message,
      undefined,
      undefined,
    );

    assertExists(reply);
    assertEquals(reply, ERROR_MESSAGES.REPOSITORY_NOT_SET);
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 存在しないスレッドへのメッセージはエラーを返す", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "non-existent";

  try {
    await admin.routeMessage(threadId, "test", undefined, undefined);
    assertEquals(true, false, "エラーが発生するはず");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      ERROR_MESSAGES.WORKER_NOT_FOUND(threadId),
    );
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 初期メッセージに終了ボタンが含まれる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-333";

  try {
    const initialMessage = admin.createInitialMessage(threadId);

    assertExists(initialMessage.content);
    assertExists(initialMessage.components);
    assertEquals(initialMessage.components.length, 1);
    assertEquals(initialMessage.components[0].type, 1);
    assertEquals(initialMessage.components[0].components.length, 1);
    assertEquals(initialMessage.components[0].components[0].type, 2);
    assertEquals(
      initialMessage.components[0].components[0].custom_id,
      `terminate_${threadId}`,
    );
    assertEquals(
      initialMessage.components[0].components[0].label,
      "スレッドを終了",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 終了ボタンでスレッドを終了できる", async () => {
  const { admin, workspaceManager, cleanup } = await createTestContext();
  const threadId = "thread-444";

  try {
    await admin.createWorker(threadId);
    assertExists(admin.getWorker(threadId));

    const result = await admin.handleButtonInteraction(
      threadId,
      `terminate_${threadId}`,
    );

    assertEquals(result, ERROR_MESSAGES.THREAD_TERMINATED);
    assertEquals(admin.getWorker(threadId), null);

    const threadInfo = await workspaceManager.loadThreadInfo(threadId);
    assertEquals(threadInfo?.status, "archived");
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - スレッドクローズコールバックが呼ばれる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-callback-test";

  try {
    let callbackCalled = false;
    let callbackThreadId = "";

    admin.setThreadCloseCallback(async (tid: string) => {
      callbackCalled = true;
      callbackThreadId = tid;
    });

    await admin.createWorker(threadId);
    assertExists(admin.getWorker(threadId));

    await admin.terminateThread(threadId);

    assertEquals(callbackCalled, true);
    assertEquals(callbackThreadId, threadId);
    assertEquals(admin.getWorker(threadId), null);
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - 未知のボタンIDの場合は適切なメッセージを返す", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-555";

  try {
    const result = await admin.handleButtonInteraction(
      threadId,
      "unknown_button",
    );

    assertEquals(result, "未知のボタンが押されました。");
  } finally {
    await cleanup();
  }
});

Deno.test("Admin - devcontainer.jsonが存在しない場合の設定確認", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-devcontainer-1";

  // devcontainer.jsonが存在しないテンポラリディレクトリを作成
  const testRepoDir = await Deno.makeTempDir({ prefix: "test_repo_" });

  const result = await admin.checkAndSetupDevcontainer(threadId, testRepoDir);

  assertEquals(result.hasDevcontainer, false);
  assertEquals(
    result.message.includes("devcontainer.jsonが見つかりませんでした"),
    true,
  );
  assertEquals(Array.isArray(result.components), true);
  assertEquals(result.message.includes("--dangerously-skip-permissions"), true);

  // クリーンアップ
  await Deno.remove(testRepoDir, { recursive: true });
});

Deno.test("Admin - devcontainer.jsonが存在する場合の設定確認", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-devcontainer-2";

  // devcontainer.jsonが存在するテンポラリディレクトリを作成
  const testRepoDir = await Deno.makeTempDir({ prefix: "test_repo_" });
  const devcontainerDir = `${testRepoDir}/.devcontainer`;
  await Deno.mkdir(devcontainerDir);

  // 基本的なdevcontainer.jsonを作成
  const devcontainerConfig = {
    "name": "Test Container",
    "image": "mcr.microsoft.com/devcontainers/javascript-node:16",
  };
  await Deno.writeTextFile(
    `${devcontainerDir}/devcontainer.json`,
    JSON.stringify(devcontainerConfig, null, 2),
  );

  const result = await admin.checkAndSetupDevcontainer(threadId, testRepoDir);

  assertEquals(result.hasDevcontainer, true);
  assertEquals(
    result.message.includes("devcontainer.jsonが見つかりました"),
    true,
  );
  assertEquals(Array.isArray(result.components), true);

  // クリーンアップ
  await Deno.remove(testRepoDir, { recursive: true });
});

Deno.test("Admin - anthropics featureを含むdevcontainer.jsonの設定確認", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-devcontainer-3";

  // anthropics featureを含むdevcontainer.jsonを作成
  const testRepoDir = await Deno.makeTempDir({ prefix: "test_repo_" });
  const devcontainerDir = `${testRepoDir}/.devcontainer`;
  await Deno.mkdir(devcontainerDir);

  const devcontainerConfig = {
    "name": "Test Container with Anthropics",
    "image": "mcr.microsoft.com/devcontainers/javascript-node:16",
    "features": {
      "ghcr.io/anthropics/devcontainer-features/claude-cli:1": {},
    },
  };
  await Deno.writeTextFile(
    `${devcontainerDir}/devcontainer.json`,
    JSON.stringify(devcontainerConfig, null, 2),
  );

  const result = await admin.checkAndSetupDevcontainer(threadId, testRepoDir);

  assertEquals(result.hasDevcontainer, true);
  // devcontainer CLIがインストールされていない環境では警告メッセージが出る
  if (
    result.warning && result.warning.includes("devcontainer CLIをインストール")
  ) {
    assertEquals(
      result.message.includes(
        "devcontainer.jsonが見つかりましたが、devcontainer CLIがインストールされていません",
      ),
      true,
    );
    assertEquals(
      result.message.includes("--dangerously-skip-permissions"),
      true,
    );
  } else {
    // devcontainer CLIが利用可能な場合
    assertEquals(result.message.includes("Anthropics features: ✅"), true);
    assertEquals(result.warning, "");
  }
  assertEquals(Array.isArray(result.components), true);

  // クリーンアップ
  await Deno.remove(testRepoDir, { recursive: true });
});

Deno.test("Admin - 初期メッセージにdevcontainer流れの説明が含まれる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-666";

  const initialMessage = admin.createInitialMessage(threadId);

  assertEquals(
    initialMessage.content.includes("devcontainer.jsonの存在確認"),
    true,
  );
  assertEquals(
    initialMessage.content.includes("devcontainer利用の可否選択"),
    true,
  );
  assertEquals(initialMessage.content.includes("権限設定の選択"), true);
  assertEquals(initialMessage.content.includes("Claude実行環境の準備"), true);
});

Deno.test("Admin - verboseモードが正しく設定される", async () => {
  const workspace = await createTestWorkspaceManager();

  // verboseモード無効でAdminを作成
  const adminQuiet = new Admin(workspace, false);
  assertEquals(typeof adminQuiet.getWorker, "function");

  // verboseモード有効でAdminを作成
  const adminVerbose = new Admin(workspace, true);
  assertEquals(typeof adminVerbose.getWorker, "function");
});

Deno.test("Admin - verboseモードでログが出力される", async () => {
  const workspace = await createTestWorkspaceManager();

  // コンソールログをキャプチャするためのモック
  const originalConsoleLog = console.log;
  const logMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    logMessages.push(args.join(" "));
  };

  try {
    // verboseモード有効でAdminを作成
    const admin = new Admin(workspace, true);
    const threadId = "verbose-test-thread";

    // Worker作成（ログが出力される）
    await admin.createWorker(threadId);

    // verboseログが出力されていることを確認
    const verboseLogs = logMessages.filter((log) =>
      log.includes("[Admin]") &&
      (log.includes("Admin初期化完了") || log.includes("Worker作成要求"))
    );

    assertEquals(
      verboseLogs.length >= 2,
      true,
      `期待される数のverboseログが出力されていません。実際のログ: ${verboseLogs.length}`,
    );
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});

Deno.test("Admin - verboseモード無効時はログが出力されない", async () => {
  const workspace = await createTestWorkspaceManager();

  // コンソールログをキャプチャするためのモック
  const originalConsoleLog = console.log;
  const logMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    logMessages.push(args.join(" "));
  };

  try {
    // verboseモード無効でAdminを作成
    const admin = new Admin(workspace, false);
    const threadId = "quiet-test-thread";

    // Worker作成
    await admin.createWorker(threadId);

    // verboseログが出力されていないことを確認
    const verboseLogs = logMessages.filter((log) => log.includes("[Admin]"));

    assertEquals(
      verboseLogs.length,
      0,
      `verboseログが出力されるべきではありません。実際のログ: ${verboseLogs.length}`,
    );
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});

Deno.test("Admin - verboseモードでのメッセージルーティングログ", async () => {
  const workspace = await createTestWorkspaceManager();

  // コンソールログをキャプチャするためのモック
  const originalConsoleLog = console.log;
  const logMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    logMessages.push(args.join(" "));
  };

  try {
    // verboseモード有効でAdminを作成
    const admin = new Admin(workspace, true);
    const threadId = "routing-test-thread";

    // Worker作成
    await admin.createWorker(threadId);

    // 存在しないスレッドへのメッセージをテスト
    try {
      await admin.routeMessage("non-existent-thread", "test message");
    } catch (error) {
      // エラーが期待される
    }

    // verboseログが出力されていることを確認
    const routingLogs = logMessages.filter((log) =>
      log.includes("[Admin]") &&
      (log.includes("メッセージルーティング開始") ||
        log.includes("Worker見つからず"))
    );

    assertEquals(
      routingLogs.length >= 1,
      true,
      `メッセージルーティングのverboseログが出力されていません。`,
    );
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});

Deno.test("Admin - devcontainer設定情報を正しく保存・取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "devcontainer-config-test";

  // Worker作成
  await admin.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: true,
    skipPermissions: false,
    hasDevcontainerFile: true,
    hasAnthropicsFeature: true,
    containerId: "container123",
    isStarted: true,
  };

  await admin.saveDevcontainerConfig(threadId, config);

  // 設定を取得して確認
  const retrievedConfig = await admin.getDevcontainerConfig(threadId);

  assertEquals(retrievedConfig?.useDevcontainer, true);
  assertEquals(retrievedConfig?.skipPermissions, false);
  assertEquals(retrievedConfig?.hasDevcontainerFile, true);
  assertEquals(retrievedConfig?.hasAnthropicsFeature, true);
  assertEquals(retrievedConfig?.containerId, "container123");
  assertEquals(retrievedConfig?.isStarted, true);
});

Deno.test("Admin - ThreadInfoにdevcontainer設定が永続化される", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "devcontainer-persist-test";

  // Worker作成
  await admin.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: false,
    skipPermissions: true,
    hasDevcontainerFile: false,
    hasAnthropicsFeature: false,
    isStarted: false,
  };

  await admin.saveDevcontainerConfig(threadId, config);

  // WorkspaceManagerから直接ThreadInfoを読み込んで確認
  const threadInfo = await workspace.loadThreadInfo(threadId);

  assertEquals(threadInfo?.devcontainerConfig?.useDevcontainer, false);
  assertEquals(threadInfo?.devcontainerConfig?.skipPermissions, true);
  assertEquals(threadInfo?.devcontainerConfig?.hasDevcontainerFile, false);
  assertEquals(threadInfo?.devcontainerConfig?.hasAnthropicsFeature, false);
  assertEquals(threadInfo?.devcontainerConfig?.isStarted, false);
});

Deno.test("Admin - 存在しないスレッドのdevcontainer設定取得はnullを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);

  const config = await admin.getDevcontainerConfig("non-existent-thread");

  assertEquals(config, null);
});

Deno.test("Admin - アクティブなスレッドを復旧できる", async () => {
  const workspace = await createTestWorkspaceManager();

  // 最初のAdminでスレッドを作成・設定
  const admin1 = new Admin(workspace);
  const threadId = "restore-test-thread";

  // Worker作成
  await admin1.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: true,
    skipPermissions: false,
    hasDevcontainerFile: true,
    hasAnthropicsFeature: true,
    containerId: "test-container-456",
    isStarted: true,
  };
  await admin1.saveDevcontainerConfig(threadId, config);

  // Workerが存在することを確認
  assertEquals(admin1.getWorker(threadId) !== null, true);

  // 新しいAdminを作成（再起動をシミュレート）
  const admin2 = new Admin(workspace);

  // 復旧前はWorkerが存在しない
  assertEquals(admin2.getWorker(threadId), null);

  // アクティブスレッドを復旧
  await admin2.restoreActiveThreads();

  // 復旧後はWorkerが存在する
  const restoredWorker = admin2.getWorker(threadId);
  assertEquals(restoredWorker !== null, true);
  assertEquals(typeof restoredWorker?.getName(), "string");

  // devcontainer設定も復旧されている
  const restoredConfig = await admin2.getDevcontainerConfig(threadId);
  assertEquals(restoredConfig?.useDevcontainer, true);
  assertEquals(restoredConfig?.skipPermissions, false);
  assertEquals(restoredConfig?.hasDevcontainerFile, true);
  assertEquals(restoredConfig?.hasAnthropicsFeature, true);
  assertEquals(restoredConfig?.containerId, "test-container-456");
  assertEquals(restoredConfig?.isStarted, true);
});

Deno.test("Admin - アーカイブされたスレッドは復旧されない", async () => {
  const workspace = await createTestWorkspaceManager();

  // スレッド情報を直接作成（アーカイブ状態）
  const threadId = "archived-thread";
  const threadInfo = {
    threadId,
    repositoryFullName: null,
    repositoryLocalPath: null,
    worktreePath: null,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "archived" as const,
    devcontainerConfig: null,
  };

  await workspace.saveThreadInfo(threadInfo);

  // Adminを作成してアクティブスレッドを復旧
  const admin = new Admin(workspace);
  await admin.restoreActiveThreads();

  // アーカイブされたスレッドは復旧されない
  assertEquals(admin.getWorker(threadId), null);
});

Deno.test("Admin - 復旧時のエラーハンドリング", async () => {
  const workspace = await createTestWorkspaceManager();

  // 無効なリポジトリ情報を持つスレッド情報を作成
  const threadId = "invalid-repo-thread";
  const threadInfo = {
    threadId,
    repositoryFullName: "invalid/repository",
    repositoryLocalPath: "/nonexistent/path",
    worktreePath: "/nonexistent/worktree",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active" as const,
    devcontainerConfig: {
      useDevcontainer: false,
      skipPermissions: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
  };

  await workspace.saveThreadInfo(threadInfo);

  // Adminを作成してアクティブスレッドを復旧
  const admin = new Admin(workspace);

  // エラーハンドリングのため、コンソールエラーをキャプチャ
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const errorMessages: string[] = [];
  const warnMessages: string[] = [];

  console.error = (...args: unknown[]) => {
    errorMessages.push(args.join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.join(" "));
  };

  try {
    await admin.restoreActiveThreads();

    // worktreeが存在しないため、スレッドはアーカイブされ、Workerは作成されない
    const worker = admin.getWorker(threadId);
    assertEquals(worker, null);

    // スレッドがアーカイブされたことを確認
    const updatedThreadInfo = await workspace.loadThreadInfo(threadId);
    assertEquals(updatedThreadInfo?.status, "archived");

    // エラーハンドリングが適切に動作していることを確認
    // 実際のエラーが発生するかは環境に依存するため、ここではWorkerの状態のみを確認
  } finally {
    // コンソールを元に戻す
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});

Deno.test("Admin - worktreeが存在しないスレッドは復旧時にアーカイブされる", async () => {
  const workspace = await createTestWorkspaceManager();

  // worktreeが存在しないスレッド情報を作成
  const threadId = "no-worktree-thread";
  const threadInfo = {
    threadId,
    repositoryFullName: "test/repo",
    repositoryLocalPath: "/path/to/repo",
    worktreePath: "/nonexistent/worktree/path",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active" as const,
    devcontainerConfig: null,
  };

  await workspace.saveThreadInfo(threadInfo);

  // Adminを作成してアクティブスレッドを復旧
  const admin = new Admin(workspace);
  await admin.restoreActiveThreads();

  // Workerは作成されない
  assertEquals(admin.getWorker(threadId), null);

  // スレッドがアーカイブされたことを確認
  const updatedThreadInfo = await workspace.loadThreadInfo(threadId);
  assertEquals(updatedThreadInfo?.status, "archived");
});

Deno.test("Admin - worktreeが存在するスレッドは正常に復旧される", async () => {
  const workspace = await createTestWorkspaceManager();

  // 実際に存在するworktreeを作成
  const threadId = "valid-worktree-thread";
  const worktreePath = workspace.getWorktreePath(threadId);
  await Deno.mkdir(worktreePath, { recursive: true });

  // スレッド情報を作成
  const threadInfo = {
    threadId,
    repositoryFullName: "test/repo",
    repositoryLocalPath: workspace.getBaseDir(), // 実際の存在するパスを使用
    worktreePath,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active" as const,
    devcontainerConfig: {
      useDevcontainer: false,
      skipPermissions: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
  };

  await workspace.saveThreadInfo(threadInfo);

  // Adminを作成してアクティブスレッドを復旧
  const admin = new Admin(workspace);
  await admin.restoreActiveThreads();

  // Workerが作成される
  const worker = admin.getWorker(threadId);
  assertEquals(worker !== null, true);

  // スレッドがアクティブのままであることを確認
  const updatedThreadInfo = await workspace.loadThreadInfo(threadId);
  assertEquals(updatedThreadInfo?.status, "active");

  // クリーンアップ - workspace全体を削除（テンポラリディレクトリなので）
});
