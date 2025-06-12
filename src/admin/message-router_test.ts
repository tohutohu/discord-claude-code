import { assertEquals } from "std/assert/mod.ts";
import { MessageRouter } from "./message-router.ts";
import { WorkerManager } from "./worker-manager.ts";
import { RateLimitManager } from "./rate-limit-manager.ts";
import { WorkspaceManager } from "../workspace.ts";

Deno.test("MessageRouter - 正常なメッセージルーティング", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const rateLimitManager = new RateLimitManager(workspaceManager);
    const messageRouter = new MessageRouter(
      workerManager,
      rateLimitManager,
      workspaceManager,
    );

    const threadId = "test-thread";

    // Workerを作成
    await workerManager.createWorker(threadId);

    // メッセージをルーティング
    const result = await messageRouter.routeMessage(
      threadId,
      "テストメッセージ",
    );

    // 実際のWorkerはリポジトリが設定されていない場合、特定のメッセージを返す
    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(typeof result.value, "string");
      if (typeof result.value === "string") {
        assertEquals(result.value.includes("/start"), true);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("MessageRouter - 存在しないWorkerへのルーティング", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const rateLimitManager = new RateLimitManager(workspaceManager);
    const messageRouter = new MessageRouter(
      workerManager,
      rateLimitManager,
      workspaceManager,
    );

    // 存在しないスレッドIDでメッセージをルーティング
    const result = await messageRouter.routeMessage(
      "non-existent-thread",
      "テストメッセージ",
    );

    assertEquals(result.isErr(), true);
    if (result.isErr()) {
      assertEquals(result.error.type, "WORKER_NOT_FOUND");
      assertEquals(result.error.threadId, "non-existent-thread");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("MessageRouter - レートリミット中のメッセージキュー追加", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const rateLimitManager = new RateLimitManager(workspaceManager);
    const messageRouter = new MessageRouter(
      workerManager,
      rateLimitManager,
      workspaceManager,
    );

    const threadId = "test-thread-rate-limit";

    // Worker状態を作成（レートリミット中）
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      devcontainerConfig: {
        useDevcontainer: false,
        useFallbackDevcontainer: false,
        hasDevcontainerFile: false,
        hasAnthropicsFeature: false,
        isStarted: false,
      },
      status: "active",
      rateLimitTimestamp: Math.floor(Date.now() / 1000), // レートリミット中
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // レートリミット中のメッセージ送信
    const result = await messageRouter.routeMessage(
      threadId,
      "テストメッセージ",
      undefined,
      undefined,
      "msg-123",
      "user-123",
    );

    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(
        result.value,
        "レートリミット中です。このメッセージは制限解除後に自動的に処理されます。",
      );
    }

    // キューに追加されていることを確認
    const workerState = await workspaceManager.loadWorkerState(threadId);
    assertEquals(workerState?.queuedMessages?.length, 1);
    assertEquals(workerState?.queuedMessages?.[0].messageId, "msg-123");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("MessageRouter - リアクションコールバックの呼び出し", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const rateLimitManager = new RateLimitManager(workspaceManager);
    const messageRouter = new MessageRouter(
      workerManager,
      rateLimitManager,
      workspaceManager,
    );

    const threadId = "test-thread-reaction";

    // Workerを作成
    await workerManager.createWorker(threadId);

    // リアクションコールバックを設定
    let reactionEmoji = "";
    const onReaction = async (emoji: string) => {
      reactionEmoji = emoji;
    };

    // メッセージをルーティング
    await messageRouter.routeMessage(
      threadId,
      "テストメッセージ",
      undefined,
      onReaction,
    );

    // リアクションが追加されたことを確認
    assertEquals(reactionEmoji, "👀");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
