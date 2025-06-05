import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import { WorkspaceManager } from "../src/workspace.ts";

async function createTestWorkspaceManager(): Promise<WorkspaceManager> {
  const testDir = await Deno.makeTempDir({ prefix: "integration_test_" });
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();
  return workspace;
}

Deno.test("統合テスト - Admin経由でWorkerとやり取りできる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadId = "integration-test-thread";

  // Workerを作成
  const worker = await admin.createWorker(threadId);
  assertExists(worker);

  // メッセージを送信して返信を確認
  const messages = [
    "こんにちは",
    "元気ですか？",
    "今日の天気はどうですか？",
  ];

  for (const message of messages) {
    const reply = await admin.routeMessage(threadId, message);
    assertEquals(
      reply,
      "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
    );
  }
});

Deno.test("統合テスト - 複数のスレッドを同時に処理できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const admin = new Admin(workspace);
  const threadIds = ["thread-a", "thread-b", "thread-c"];
  const workers = new Map<string, string>();

  // 複数のWorkerを作成
  for (const threadId of threadIds) {
    const worker = await admin.createWorker(threadId);
    workers.set(threadId, worker.getName());
  }

  // 各スレッドにメッセージを送信
  const message = "マルチスレッドテスト";
  const promises = threadIds.map((threadId) =>
    admin.routeMessage(threadId, message)
  );

  const replies = await Promise.all(promises);

  // 各返信が正しいものか確認
  for (let i = 0; i < threadIds.length; i++) {
    assertEquals(
      replies[i],
      "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
    );
  }
});
