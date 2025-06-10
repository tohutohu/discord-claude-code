import { assertEquals, assertExists } from "std/assert/mod.ts";
import { Admin } from "./admin.ts";
import { AdminState, WorkspaceManager } from "../workspace.ts";

Deno.test("Admin - 基本的な初期化とWorker作成", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const adminState: AdminState = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };

    const admin = new Admin(adminState, workspaceManager);
    const threadId = "test-thread-1";

    // Workerを作成
    const worker = await admin.createWorker(threadId);
    assertExists(worker);
    assertEquals(typeof worker.getName(), "string");

    // Workerを取得
    const retrievedWorker = admin.getWorker(threadId);
    assertExists(retrievedWorker);
    assertEquals(worker.getName(), retrievedWorker?.getName());

    // Admin状態が更新されていることを確認
    await admin.save();
    const savedState = await workspaceManager.loadAdminState();
    assertExists(savedState);
    assertEquals(savedState.activeThreadIds.includes(threadId), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Admin - スレッドの終了処理", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const adminState: AdminState = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };

    const admin = new Admin(adminState, workspaceManager);
    const threadId = "test-thread-2";

    // Workerを作成
    await admin.createWorker(threadId);

    // スレッドを終了
    await admin.terminateThread(threadId);

    // Workerが削除されていることを確認
    const worker = admin.getWorker(threadId);
    assertEquals(worker, null);

    // Admin状態からも削除されていることを確認
    await admin.save();
    const savedState = await workspaceManager.loadAdminState();
    assertExists(savedState);
    assertEquals(savedState.activeThreadIds.includes(threadId), false);

    // ThreadInfoがアーカイブされていることを確認
    const threadInfo = await workspaceManager.loadThreadInfo(threadId);
    assertExists(threadInfo);
    assertEquals(threadInfo?.status, "archived");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Admin - 初期メッセージの作成", () => {
  const tempDir = "dummy"; // このテストではファイルシステムを使用しない
  const workspaceManager = new WorkspaceManager(tempDir);
  const adminState: AdminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };

  const admin = new Admin(adminState, workspaceManager);
  const message = admin.createInitialMessage("test-thread");

  assertExists(message);
  assertEquals(typeof message.content, "string");
  assertEquals(
    message.content.includes("Claude Code Bot スレッドが開始されました"),
    true,
  );
  assertEquals(Array.isArray(message.components), true);
});

Deno.test("Admin - レートリミットメッセージの作成", () => {
  const tempDir = "dummy"; // このテストではファイルシステムを使用しない
  const workspaceManager = new WorkspaceManager(tempDir);
  const adminState: AdminState = {
    activeThreadIds: [],
    lastUpdated: new Date().toISOString(),
  };

  const admin = new Admin(adminState, workspaceManager);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = admin.createRateLimitMessage("test-thread", timestamp);

  assertEquals(typeof message, "string");
  assertEquals(
    message.includes("Claude Codeのレートリミットに達しました"),
    true,
  );
  assertEquals(message.includes("制限解除予定時刻"), true);
});

Deno.test("Admin - fromStateメソッド", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    // nullの状態から作成
    const admin1 = Admin.fromState(null, workspaceManager);
    assertExists(admin1);

    // 既存の状態から作成
    const existingState: AdminState = {
      activeThreadIds: ["thread-1", "thread-2"],
      lastUpdated: new Date().toISOString(),
    };
    const admin2 = Admin.fromState(existingState, workspaceManager);
    assertExists(admin2);

    // 状態を保存して確認
    await admin2.save();
    const savedState = await workspaceManager.loadAdminState();
    assertExists(savedState);
    assertEquals(savedState.activeThreadIds.length, 2);
    assertEquals(savedState.activeThreadIds[0], "thread-1");
    assertEquals(savedState.activeThreadIds[1], "thread-2");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
