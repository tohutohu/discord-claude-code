import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertWorkerValid,
  createTestContext,
  ERROR_MESSAGES,
} from "./test-utils.ts";

Deno.test("統合テスト - Admin経由でWorkerとやり取りできる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadId = "integration-test-thread";

  try {
    // Workerを作成
    const workerResult = await admin.createWorker(threadId);
    assert(
      workerResult.isOk(),
      `Worker作成に失敗: ${
        workerResult.isErr() ? JSON.stringify(workerResult.error) : ""
      }`,
    );
    const worker = workerResult.value;
    assertWorkerValid(worker);

    // メッセージを送信して返信を確認
    const messages = [
      "こんにちは",
      "元気ですか？",
      "今日の天気はどうですか？",
    ];

    for (const message of messages) {
      const replyResult = await admin.routeMessage(
        threadId,
        message,
        undefined,
        undefined,
      );
      assert(
        replyResult.isOk(),
        `メッセージ送信に失敗: ${
          replyResult.isErr() ? JSON.stringify(replyResult.error) : ""
        }`,
      );
      const reply = replyResult.value;
      assertEquals(reply, ERROR_MESSAGES.REPOSITORY_NOT_SET);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("統合テスト - 複数のスレッドを同時に処理できる", async () => {
  const { admin, cleanup } = await createTestContext();
  const threadIds = ["thread-a", "thread-b", "thread-c"];
  const workers = new Map<string, string>();

  try {
    // 複数のWorkerを作成
    for (const threadId of threadIds) {
      const workerResult = await admin.createWorker(threadId);
      assert(
        workerResult.isOk(),
        `Worker作成に失敗: ${
          workerResult.isErr() ? JSON.stringify(workerResult.error) : ""
        }`,
      );
      const worker = workerResult.value;
      workers.set(threadId, worker.getName());
    }

    // 各スレッドにメッセージを送信
    const message = "マルチスレッドテスト";
    const promises = threadIds.map((threadId) =>
      admin.routeMessage(threadId, message, undefined, undefined)
    );

    const replyResults = await Promise.all(promises);

    // 各返信が正しいものか確認
    for (const replyResult of replyResults) {
      assert(
        replyResult.isOk(),
        `メッセージ送信に失敗: ${
          replyResult.isErr() ? JSON.stringify(replyResult.error) : ""
        }`,
      );
      const reply = replyResult.value;
      assertEquals(reply, ERROR_MESSAGES.REPOSITORY_NOT_SET);
    }
  } finally {
    await cleanup();
  }
});
