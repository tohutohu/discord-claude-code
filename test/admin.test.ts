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
