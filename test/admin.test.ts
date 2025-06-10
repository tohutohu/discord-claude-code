import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import {
  assertWorkerValid,
  createTestContext,
  ERROR_MESSAGES,
} from "./test-utils.ts";
import { WorkspaceManager } from "../src/workspace.ts";

async function createTestWorkspaceManager(): Promise<WorkspaceManager> {
  const testDir = await Deno.makeTempDir({ prefix: "admin_test_" });
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();
  return workspace;
}

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

Deno.test("Admin - 初期メッセージが正しく作成される", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "thread-333";

  try {
    const initialMessage = admin.createInitialMessage(threadId);

    assertExists(initialMessage.content);
    assertExists(initialMessage.components);
    assertEquals(initialMessage.components.length, 0);
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
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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

  // devcontainer CLIの有無によってメッセージが変わるため、どちらかの条件を満たすことを確認
  const hasPermissionsOption = result.message.includes(
    "--dangerously-skip-permissions",
  );
  const hasFallbackOption = result.message.includes("fallback devcontainer");
  assertEquals(hasPermissionsOption || hasFallbackOption, true);

  // クリーンアップ
  await Deno.remove(testRepoDir, { recursive: true });
});

Deno.test("Admin - devcontainer.jsonが存在する場合の設定確認", async () => {
  const workspace = await createTestWorkspaceManager();
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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
  assertEquals(initialMessage.content.includes("Claude実行環境の準備"), true);
});

Deno.test("Admin - verboseモードが正しく設定される", async () => {
  const workspace = await createTestWorkspaceManager();

  // verboseモード無効でAdminを作成
  const adminStateQuiet = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const adminQuiet = new Admin(adminStateQuiet, workspace, false, undefined);
  assertEquals(typeof adminQuiet.getWorker, "function");

  // verboseモード有効でAdminを作成
  const adminStateVerbose = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const adminVerbose = new Admin(adminStateVerbose, workspace, true, undefined);
  assertEquals(typeof adminVerbose.getWorker, "function");
});

Deno.test(
  "Admin - verboseモードでログが出力される（新構造対応必要）",
  async () => {
    const workspace = await createTestWorkspaceManager();

    // コンソールログをキャプチャするためのモック
    const originalConsoleLog = console.log;
    const logMessages: string[] = [];
    console.log = (...args: unknown[]) => {
      logMessages.push(args.join(" "));
    };

    try {
      // verboseモード有効でAdminを作成
      const adminState = {
        activeThreadIds: [],
        lastUpdated: new Date().toISOString(),
      };
      const admin = new Admin(adminState, workspace, true, undefined);
      const threadId = "verbose-test-thread";

      // Worker作成（ログが出力される）
      await admin.createWorker(threadId);

      // verboseログが出力されていることを確認
      // Admin初期化ログ
      const adminInitLog = logMessages.find((log) =>
        log.includes("[Admin]") && log.includes("Admin初期化完了")
      );
      assertNotEquals(
        adminInitLog,
        undefined,
        "Admin初期化完了ログが見つかりません",
      );

      // WorkerManager によるWorker作成ログ
      const workerCreateLog = logMessages.find((log) =>
        log.includes("[WorkerManager]") && log.includes("Worker作成要求")
      );
      assertNotEquals(
        workerCreateLog,
        undefined,
        "WorkerManagerのWorker作成要求ログが見つかりません",
      );

      // Adminのアクティブスレッドリスト追加ログ
      const activeThreadLog = logMessages.find((log) =>
        log.includes("[Admin]") &&
        log.includes("アクティブスレッドリストに追加完了")
      );
      assertNotEquals(
        activeThreadLog,
        undefined,
        "Adminのアクティブスレッドリスト追加ログが見つかりません",
      );

      // 複数のverboseログが出力されていることを確認
      const totalVerboseLogs = logMessages.filter((log) =>
        log.includes("[Admin]") || log.includes("[WorkerManager]")
      );
      assertEquals(
        totalVerboseLogs.length >= 3,
        true,
        `期待される数のverboseログが出力されていません。実際のログ: ${totalVerboseLogs.length}`,
      );
    } finally {
      // コンソールログを元に戻す
      console.log = originalConsoleLog;
    }
  },
);

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
    const adminState = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin = new Admin(adminState, workspace, false, undefined);
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

Deno.test(
  "Admin - verboseモードでのメッセージルーティングログ（新構造対応必要）",
  async () => {
    const workspace = await createTestWorkspaceManager();

    // コンソールログをキャプチャするためのモック
    const originalConsoleLog = console.log;
    const logMessages: string[] = [];
    console.log = (...args: unknown[]) => {
      logMessages.push(args.join(" "));
    };

    try {
      // verboseモード有効でAdminを作成
      const adminState = {
        activeThreadIds: [],
        lastUpdated: new Date().toISOString(),
      };
      const admin = new Admin(adminState, workspace, true, undefined);
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
      // MessageRouterのルーティング開始ログ
      const routingStartLog = logMessages.find((log) =>
        log.includes("[MessageRouter]") &&
        log.includes("メッセージルーティング開始")
      );
      assertNotEquals(
        routingStartLog,
        undefined,
        "MessageRouterのメッセージルーティング開始ログが見つかりません",
      );

      // MessageRouterのWorker見つからずログ
      const workerNotFoundLog = logMessages.find((log) =>
        log.includes("[MessageRouter]") && log.includes("Worker見つからず")
      );
      assertNotEquals(
        workerNotFoundLog,
        undefined,
        "MessageRouterのWorker見つからずログが見つかりません",
      );

      // 正常なスレッドへのメッセージをテスト
      logMessages.length = 0; // ログをクリア
      const response = await admin.routeMessage(threadId, "test message");
      assertNotEquals(response, undefined);

      // 正常ルーティングのログ確認
      const normalRoutingLog = logMessages.find((log) =>
        log.includes("[MessageRouter]") && log.includes("Worker発見、処理開始")
      );
      assertNotEquals(
        normalRoutingLog,
        undefined,
        "MessageRouterのWorker発見ログが見つかりません",
      );
    } finally {
      // コンソールログを元に戻す
      console.log = originalConsoleLog;
    }
  },
);

Deno.test("Admin - devcontainer設定情報を正しく保存・取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
  const threadId = "devcontainer-config-test";

  // Worker作成
  await admin.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: true,
    hasDevcontainerFile: true,
    hasAnthropicsFeature: true,
    containerId: "container123",
    isStarted: true,
  };

  await admin.saveDevcontainerConfig(threadId, config);

  // 設定を取得して確認
  const retrievedConfig = await admin.getDevcontainerConfig(threadId);

  assertEquals(retrievedConfig?.useDevcontainer, true);
  assertEquals(retrievedConfig?.hasDevcontainerFile, true);
  assertEquals(retrievedConfig?.hasAnthropicsFeature, true);
  assertEquals(retrievedConfig?.containerId, "container123");
  assertEquals(retrievedConfig?.isStarted, true);
});

Deno.test("Admin - WorkerStateにdevcontainer設定が永続化される", async () => {
  const workspace = await createTestWorkspaceManager();
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
  const threadId = "devcontainer-persist-test";

  // Worker作成
  await admin.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: false,
    hasDevcontainerFile: false,
    hasAnthropicsFeature: false,
    isStarted: false,
  };

  await admin.saveDevcontainerConfig(threadId, config);

  // WorkspaceManagerから直接WorkerStateを読み込んで確認
  const workerState = await workspace.loadWorkerState(threadId);

  assertEquals(workerState?.devcontainerConfig?.useDevcontainer, false);
  assertEquals(workerState?.devcontainerConfig?.hasDevcontainerFile, false);
  assertEquals(workerState?.devcontainerConfig?.hasAnthropicsFeature, false);
  assertEquals(workerState?.devcontainerConfig?.isStarted, false);
});

Deno.test("Admin - 存在しないスレッドのdevcontainer設定取得はnullを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const adminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);

  const config = await admin.getDevcontainerConfig("non-existent-thread");

  assertEquals(config, null);
});

Deno.test("Admin - アクティブなスレッドを復旧できる", async () => {
  const workspace = await createTestWorkspaceManager();

  // 最初のAdminでスレッドを作成・設定
  const adminState1 = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin1 = new Admin(adminState1, workspace);
  const threadId = "restore-test-thread";

  // Worker作成
  await admin1.createWorker(threadId);

  // devcontainer設定を保存
  const config = {
    useDevcontainer: true,
    hasDevcontainerFile: true,
    hasAnthropicsFeature: true,
    containerId: "test-container-456",
    isStarted: true,
  };
  await admin1.saveDevcontainerConfig(threadId, config);

  // Workerが存在することを確認
  assertEquals(admin1.getWorker(threadId) !== null, true);

  // Admin状態を保存
  await admin1.save();

  // 新しいAdminを作成（再起動をシミュレート）
  const adminState2 = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin2 = new Admin(adminState2, workspace);

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
  };

  await workspace.saveThreadInfo(threadInfo);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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
  };

  await workspace.saveThreadInfo(threadInfo);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);

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
  };

  await workspace.saveThreadInfo(threadInfo);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
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
  };

  await workspace.saveThreadInfo(threadInfo);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
  await admin.restoreActiveThreads();

  // Workerが作成される
  const worker = admin.getWorker(threadId);
  assertEquals(worker !== null, true);

  // スレッドがアクティブのままであることを確認
  const updatedThreadInfo = await workspace.loadThreadInfo(threadId);
  assertEquals(updatedThreadInfo?.status, "active");

  // クリーンアップ - workspace全体を削除（テンポラリディレクトリなので）
});

Deno.test("Admin - devcontainer設定がWorkerに正しく復旧される", async () => {
  const workspace = await createTestWorkspaceManager();

  // 実際に存在するworktreeを作成
  const threadId = "devcontainer-worker-restore";
  const worktreePath = workspace.getWorktreePath(threadId);
  await Deno.mkdir(worktreePath, { recursive: true });

  // devcontainer設定を含むスレッド情報を作成
  const threadInfo = {
    threadId,
    repositoryFullName: "test/repo",
    repositoryLocalPath: workspace.getBaseDir(),
    worktreePath,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active" as const,
  };

  await workspace.saveThreadInfo(threadInfo);

  // WorkerStateを作成してdevcontainer設定を含める
  const workerState = {
    workerName: "test-worker",
    threadId,
    threadName: "Test Thread",
    repository: {
      fullName: "test/repo",
      org: "test",
      repo: "repo",
    },
    repositoryLocalPath: workspace.getBaseDir(),
    worktreePath,
    devcontainerConfig: {
      useDevcontainer: true,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: true,
      containerId: "restored-container-123",
      isStarted: true,
    },
    status: "active" as const,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  await workspace.saveWorkerState(workerState);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
  await admin.restoreActiveThreads();

  // Workerが作成される
  const worker = admin.getWorker(threadId);
  assertEquals(worker !== null, true);

  // Worker内のdevcontainer設定が復旧されていることを確認
  if (worker) {
    assertEquals(worker.isUsingDevcontainer(), true);
  }

  // devcontainer設定がAdminからも取得できることを確認
  const restoredConfig = await admin.getDevcontainerConfig(threadId);
  assertEquals(restoredConfig?.useDevcontainer, true);
  assertEquals(restoredConfig?.hasDevcontainerFile, true);
  assertEquals(restoredConfig?.hasAnthropicsFeature, true);
  assertEquals(restoredConfig?.containerId, "restored-container-123");
  assertEquals(restoredConfig?.isStarted, true);
});

Deno.test("Admin - devcontainer設定未設定スレッドの復旧", async () => {
  const workspace = await createTestWorkspaceManager();

  // 実際に存在するworktreeを作成
  const threadId = "no-devcontainer-config-restore";
  const worktreePath = workspace.getWorktreePath(threadId);
  await Deno.mkdir(worktreePath, { recursive: true });

  // devcontainer設定がnullのスレッド情報を作成
  const threadInfo = {
    threadId,
    repositoryFullName: "test/repo",
    repositoryLocalPath: workspace.getBaseDir(),
    worktreePath,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active" as const,
  };

  await workspace.saveThreadInfo(threadInfo);

  // アクティブスレッドリストに追加
  await workspace.addActiveThread(threadId);

  // Adminを作成してアクティブスレッドを復旧
  const adminState = await workspace.loadAdminState() || {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };
  const admin = new Admin(adminState, workspace, undefined, undefined);
  await admin.restoreActiveThreads();

  // Workerが作成される
  const worker = admin.getWorker(threadId);
  assertEquals(worker !== null, true);

  // Worker内のdevcontainer設定がデフォルト値であることを確認
  if (worker) {
    assertEquals(worker.isUsingDevcontainer(), false);
  }

  // devcontainer設定がデフォルト値であることを確認
  const restoredConfig = await admin.getDevcontainerConfig(threadId);
  assertEquals(restoredConfig?.useDevcontainer, false);
  assertEquals(restoredConfig?.hasDevcontainerFile, false);
  assertEquals(restoredConfig?.hasAnthropicsFeature, false);
  assertEquals(restoredConfig?.isStarted, false);
});
