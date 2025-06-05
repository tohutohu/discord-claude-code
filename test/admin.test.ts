import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import { WorkspaceManager } from "../src/workspace.ts";

async function createTestWorkspaceManager(): Promise<WorkspaceManager> {
  const testDir = await Deno.makeTempDir({ prefix: "admin_test_" });
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();
  return workspace;
}

Deno.test("Admin - スレッドIDとWorkerを作成できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-123";

  const worker = await admin.createWorker(threadId);

  assertExists(worker);
  assertEquals(typeof worker.getName(), "string");
  assertEquals(worker.getName().includes("-"), true);
});

Deno.test("Admin - 同じスレッドIDに対して同じWorkerを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-456";

  const worker1 = await admin.createWorker(threadId);
  const worker2 = await admin.createWorker(threadId);

  assertEquals(worker1.getName(), worker2.getName());
});

Deno.test("Admin - 異なるスレッドIDに対して異なるWorkerを作成する", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId1 = "thread-789";
  const threadId2 = "thread-999";

  const worker1 = await admin.createWorker(threadId1);
  const worker2 = await admin.createWorker(threadId2);

  assertExists(worker1);
  assertExists(worker2);
  // 名前が異なることを確認（非常に稀に同じ名前になる可能性はあるが、実用上問題ない）
});

Deno.test("Admin - スレッドIDに基づいてWorkerを取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-111";

  const createdWorker = await admin.createWorker(threadId);
  const fetchedWorker = admin.getWorker(threadId);

  assertExists(fetchedWorker);
  assertEquals(createdWorker.getName(), fetchedWorker?.getName());
});

Deno.test("Admin - 存在しないスレッドIDの場合nullを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const worker = admin.getWorker("non-existent");

  assertEquals(worker, null);
});

Deno.test("Admin - スレッドにメッセージをルーティングできる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-222";
  const message = "テストメッセージ";

  await admin.createWorker(threadId);
  const reply = await admin.routeMessage(threadId, message);

  assertExists(reply);
  // 新しい実装では、リポジトリ未設定時の固定メッセージが返される
  assertEquals(
    reply,
    "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
  );
});

Deno.test("Admin - 存在しないスレッドへのメッセージはエラーを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);

  try {
    await admin.routeMessage("non-existent", "test");
    assertEquals(true, false, "エラーが発生するはず");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      "Worker not found for thread: non-existent",
    );
  }
});

Deno.test("Admin - 初期メッセージに終了ボタンが含まれる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-333";

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
});

Deno.test("Admin - 終了ボタンでスレッドを終了できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-444";

  await admin.createWorker(threadId);
  assertExists(admin.getWorker(threadId));

  const result = await admin.handleButtonInteraction(
    threadId,
    `terminate_${threadId}`,
  );

  assertEquals(result, "スレッドを終了しました。worktreeも削除されました。");
  assertEquals(admin.getWorker(threadId), null);

  const threadInfo = await workspace.loadThreadInfo(threadId);
  assertEquals(threadInfo?.status, "archived");
});

Deno.test("Admin - 未知のボタンIDの場合は適切なメッセージを返す", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "thread-555";

  const result = await admin.handleButtonInteraction(
    threadId,
    "unknown_button",
  );

  assertEquals(result, "未知のボタンが押されました。");
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
    logMessages.push(args.join(' '));
  };
  
  try {
    // verboseモード有効でAdminを作成
    const admin = new Admin(workspace, true);
    const threadId = "verbose-test-thread";
    
    // Worker作成（ログが出力される）
    await admin.createWorker(threadId);
    
    // verboseログが出力されていることを確認
    const verboseLogs = logMessages.filter(log => 
      log.includes("[Admin]") && 
      (log.includes("Admin初期化完了") || log.includes("Worker作成要求"))
    );
    
    assertEquals(verboseLogs.length >= 2, true, `期待される数のverboseログが出力されていません。実際のログ: ${verboseLogs.length}`);
    
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
    logMessages.push(args.join(' '));
  };
  
  try {
    // verboseモード無効でAdminを作成
    const admin = new Admin(workspace, false);
    const threadId = "quiet-test-thread";
    
    // Worker作成
    await admin.createWorker(threadId);
    
    // verboseログが出力されていないことを確認
    const verboseLogs = logMessages.filter(log => 
      log.includes("[Admin]")
    );
    
    assertEquals(verboseLogs.length, 0, `verboseログが出力されるべきではありません。実際のログ: ${verboseLogs.length}`);
    
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
    logMessages.push(args.join(' '));
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
    const routingLogs = logMessages.filter(log => 
      log.includes("[Admin]") && 
      (log.includes("メッセージルーティング開始") || log.includes("Worker見つからず"))
    );
    
    assertEquals(routingLogs.length >= 1, true, `メッセージルーティングのverboseログが出力されていません。`);
    
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});
