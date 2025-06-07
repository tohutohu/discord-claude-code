import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { QueuedMessage, WorkspaceManager } from "./workspace.ts";

async function createTestDir(): Promise<string> {
  const testDir = await Deno.makeTempDir({
    prefix: "workspace_queue_test_",
  });
  return testDir;
}

Deno.test("WorkspaceManager - メッセージキューの初期化", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    // queued_messagesディレクトリが作成されていることを確認
    const queuedMessagesDir = join(testDir, "queued_messages");
    const stat = await Deno.stat(queuedMessagesDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("WorkspaceManager - メッセージの追加と読み込み", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    const threadId = "test-thread-123";
    const message: QueuedMessage = {
      messageId: "msg-123",
      content: "テストメッセージ",
      timestamp: Date.now(),
      authorId: "user-123",
    };

    // メッセージをキューに追加
    await manager.addMessageToQueue(threadId, message);

    // キューを読み込み
    const queue = await manager.loadMessageQueue(threadId);
    assertExists(queue);
    assertEquals(queue!.threadId, threadId);
    assertEquals(queue!.messages.length, 1);
    assertEquals(queue!.messages[0].messageId, message.messageId);
    assertEquals(queue!.messages[0].content, message.content);
    assertEquals(queue!.messages[0].authorId, message.authorId);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("WorkspaceManager - 複数メッセージの追加", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    const threadId = "test-thread-456";
    const messages: QueuedMessage[] = [
      {
        messageId: "msg-1",
        content: "メッセージ1",
        timestamp: Date.now(),
        authorId: "user-1",
      },
      {
        messageId: "msg-2",
        content: "メッセージ2",
        timestamp: Date.now() + 1000,
        authorId: "user-2",
      },
      {
        messageId: "msg-3",
        content: "メッセージ3",
        timestamp: Date.now() + 2000,
        authorId: "user-1",
      },
    ];

    // メッセージを順番に追加
    for (const msg of messages) {
      await manager.addMessageToQueue(threadId, msg);
    }

    // キューを確認
    const queue = await manager.loadMessageQueue(threadId);
    assertExists(queue);
    assertEquals(queue!.messages.length, 3);
    assertEquals(queue!.messages[0].messageId, "msg-1");
    assertEquals(queue!.messages[1].messageId, "msg-2");
    assertEquals(queue!.messages[2].messageId, "msg-3");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("WorkspaceManager - キューの取得とクリア", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    const threadId = "test-thread-789";
    const messages: QueuedMessage[] = [
      {
        messageId: "msg-a",
        content: "メッセージA",
        timestamp: Date.now(),
        authorId: "user-a",
      },
      {
        messageId: "msg-b",
        content: "メッセージB",
        timestamp: Date.now() + 1000,
        authorId: "user-b",
      },
    ];

    // メッセージを追加
    for (const msg of messages) {
      await manager.addMessageToQueue(threadId, msg);
    }

    // キューを取得してクリア
    const retrievedMessages = await manager.getAndClearMessageQueue(threadId);
    assertEquals(retrievedMessages.length, 2);
    assertEquals(retrievedMessages[0].messageId, "msg-a");
    assertEquals(retrievedMessages[1].messageId, "msg-b");

    // キューがクリアされていることを確認
    const emptyQueue = await manager.loadMessageQueue(threadId);
    assertEquals(emptyQueue, null);

    // 再度取得しても空であることを確認
    const noMessages = await manager.getAndClearMessageQueue(threadId);
    assertEquals(noMessages.length, 0);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("WorkspaceManager - 存在しないキューの処理", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    const threadId = "non-existent-thread";

    // 存在しないキューの読み込みはnullを返す
    const queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue, null);

    // 存在しないキューの取得は空配列を返す
    const messages = await manager.getAndClearMessageQueue(threadId);
    assertEquals(messages.length, 0);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("WorkspaceManager - キューの削除", async () => {
  const testDir = await createTestDir();
  try {
    const manager = new WorkspaceManager(testDir);
    await manager.initialize();

    const threadId = "test-thread-delete";
    const message: QueuedMessage = {
      messageId: "msg-del",
      content: "削除テスト",
      timestamp: Date.now(),
      authorId: "user-del",
    };

    // メッセージを追加
    await manager.addMessageToQueue(threadId, message);

    // キューが存在することを確認
    const queue = await manager.loadMessageQueue(threadId);
    assertExists(queue);

    // キューを削除
    await manager.deleteMessageQueue(threadId);

    // キューが削除されていることを確認
    const deletedQueue = await manager.loadMessageQueue(threadId);
    assertEquals(deletedQueue, null);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
