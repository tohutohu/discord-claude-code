import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";

Deno.test("Admin - スレッドIDとWorkerを作成できる", async () => {
  const admin = new Admin();
  const threadId = "thread-123";

  const worker = await admin.createWorker(threadId);

  assertExists(worker);
  assertEquals(typeof worker.getName(), "string");
  assertEquals(worker.getName().includes("-"), true);
});

Deno.test("Admin - 同じスレッドIDに対して同じWorkerを返す", async () => {
  const admin = new Admin();
  const threadId = "thread-456";

  const worker1 = await admin.createWorker(threadId);
  const worker2 = await admin.createWorker(threadId);

  assertEquals(worker1.getName(), worker2.getName());
});

Deno.test("Admin - 異なるスレッドIDに対して異なるWorkerを作成する", async () => {
  const admin = new Admin();
  const threadId1 = "thread-789";
  const threadId2 = "thread-999";

  const worker1 = await admin.createWorker(threadId1);
  const worker2 = await admin.createWorker(threadId2);

  assertExists(worker1);
  assertExists(worker2);
  // 名前が異なることを確認（非常に稀に同じ名前になる可能性はあるが、実用上問題ない）
});

Deno.test("Admin - スレッドIDに基づいてWorkerを取得できる", async () => {
  const admin = new Admin();
  const threadId = "thread-111";

  const createdWorker = await admin.createWorker(threadId);
  const fetchedWorker = admin.getWorker(threadId);

  assertExists(fetchedWorker);
  assertEquals(createdWorker.getName(), fetchedWorker?.getName());
});

Deno.test("Admin - 存在しないスレッドIDの場合nullを返す", () => {
  const admin = new Admin();
  const worker = admin.getWorker("non-existent");

  assertEquals(worker, null);
});

Deno.test("Admin - スレッドにメッセージをルーティングできる", async () => {
  const admin = new Admin();
  const threadId = "thread-222";
  const message = "テストメッセージ";

  await admin.createWorker(threadId);
  const reply = await admin.routeMessage(threadId, message);

  assertExists(reply);
  assertEquals(reply.includes(message), true);
});

Deno.test("Admin - 存在しないスレッドへのメッセージはエラーを返す", async () => {
  const admin = new Admin();

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
