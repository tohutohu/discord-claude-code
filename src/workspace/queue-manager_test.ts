import { assertEquals } from "std/assert/mod.ts";
import { QueueManager } from "./queue-manager.ts";
import type { QueuedMessage, ThreadQueue } from "../workspace.ts";

Deno.test("QueueManager - メッセージキューの保存と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadQueue: ThreadQueue = {
      threadId: "test-thread-123",
      messages: [
        {
          messageId: "msg-1",
          content: "Test message 1",
          timestamp: Date.now(),
          authorId: "user-1",
        },
        {
          messageId: "msg-2",
          content: "Test message 2",
          timestamp: Date.now(),
          authorId: "user-2",
        },
      ],
    };

    await manager.saveMessageQueue(threadQueue);

    const loaded = await manager.loadMessageQueue(threadQueue.threadId);
    assertEquals(loaded, threadQueue);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 存在しないキューの読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const result = await manager.loadMessageQueue("non-existent");
    assertEquals(result, null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - メッセージの追加", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadId = "test-thread-456";
    const message1: QueuedMessage = {
      messageId: "msg-1",
      content: "First message",
      timestamp: Date.now(),
      authorId: "user-1",
    };

    const message2: QueuedMessage = {
      messageId: "msg-2",
      content: "Second message",
      timestamp: Date.now() + 1000,
      authorId: "user-2",
    };

    // 最初のメッセージを追加（新規キュー作成）
    await manager.addMessageToQueue(threadId, message1);

    let queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue?.messages.length, 1);
    assertEquals(queue?.messages[0], message1);

    // 2つ目のメッセージを追加
    await manager.addMessageToQueue(threadId, message2);

    queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue?.messages.length, 2);
    assertEquals(queue?.messages[1], message2);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - メッセージの取得とクリア", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadId = "test-thread-789";
    const messages: QueuedMessage[] = [
      {
        messageId: "msg-1",
        content: "Message 1",
        timestamp: Date.now(),
        authorId: "user-1",
      },
      {
        messageId: "msg-2",
        content: "Message 2",
        timestamp: Date.now(),
        authorId: "user-2",
      },
    ];

    for (const msg of messages) {
      await manager.addMessageToQueue(threadId, msg);
    }

    // 取得とクリア
    const retrieved = await manager.getAndClearMessageQueue(threadId);
    assertEquals(retrieved.length, 2);
    assertEquals(retrieved, messages);

    // キューがクリアされていることを確認
    const afterClear = await manager.loadMessageQueue(threadId);
    assertEquals(afterClear, null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 空のキューの取得とクリア", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const messages = await manager.getAndClearMessageQueue("empty-thread");
    assertEquals(messages, []);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - キューの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadId = "test-delete";
    await manager.addMessageToQueue(threadId, {
      messageId: "msg-1",
      content: "Test",
      timestamp: Date.now(),
      authorId: "user-1",
    });

    // 削除前の確認
    let queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue !== null, true);

    // 削除
    await manager.deleteMessageQueue(threadId);

    // 削除後の確認
    queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue, null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - キューの長さ取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadId = "test-length";

    // 空のキュー
    let length = await manager.getQueueLength(threadId);
    assertEquals(length, 0);

    // メッセージを追加
    await manager.addMessageToQueue(threadId, {
      messageId: "msg-1",
      content: "Test 1",
      timestamp: Date.now(),
      authorId: "user-1",
    });

    length = await manager.getQueueLength(threadId);
    assertEquals(length, 1);

    await manager.addMessageToQueue(threadId, {
      messageId: "msg-2",
      content: "Test 2",
      timestamp: Date.now(),
      authorId: "user-2",
    });

    length = await manager.getQueueLength(threadId);
    assertEquals(length, 2);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - すべてのキューの取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    // 複数のキューを作成
    await manager.addMessageToQueue("thread-1", {
      messageId: "msg-1",
      content: "Thread 1 message",
      timestamp: Date.now(),
      authorId: "user-1",
    });

    await manager.addMessageToQueue("thread-2", {
      messageId: "msg-2-1",
      content: "Thread 2 message 1",
      timestamp: Date.now(),
      authorId: "user-2",
    });
    await manager.addMessageToQueue("thread-2", {
      messageId: "msg-2-2",
      content: "Thread 2 message 2",
      timestamp: Date.now(),
      authorId: "user-2",
    });

    await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-1",
      content: "Thread 3 message 1",
      timestamp: Date.now(),
      authorId: "user-3",
    });
    await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-2",
      content: "Thread 3 message 2",
      timestamp: Date.now(),
      authorId: "user-3",
    });
    await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-3",
      content: "Thread 3 message 3",
      timestamp: Date.now(),
      authorId: "user-3",
    });

    const allQueues = await manager.getAllQueues();
    assertEquals(allQueues.length, 3);
    // メッセージ数の多い順
    assertEquals(allQueues[0].threadId, "thread-3");
    assertEquals(allQueues[0].messages.length, 3);
    assertEquals(allQueues[1].threadId, "thread-2");
    assertEquals(allQueues[1].messages.length, 2);
    assertEquals(allQueues[2].threadId, "thread-1");
    assertEquals(allQueues[2].messages.length, 1);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 古いメッセージの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    const threadId = "test-old-messages";
    const now = Date.now();

    // 異なる時刻のメッセージを追加
    await manager.addMessageToQueue(threadId, {
      messageId: "old-1",
      content: "Old message 1",
      timestamp: now - 3600000, // 1時間前
      authorId: "user-1",
    });
    await manager.addMessageToQueue(threadId, {
      messageId: "old-2",
      content: "Old message 2",
      timestamp: now - 1800000, // 30分前
      authorId: "user-1",
    });
    await manager.addMessageToQueue(threadId, {
      messageId: "new-1",
      content: "New message",
      timestamp: now - 300000, // 5分前
      authorId: "user-1",
    });

    // 30分以上前のメッセージを削除
    const removed = await manager.removeOldMessages(threadId, 1800000);
    assertEquals(removed, 2); // 1時間前と30分前のメッセージが削除

    const queue = await manager.loadMessageQueue(threadId);
    assertEquals(queue?.messages.length, 1);
    assertEquals(queue?.messages[0].messageId, "new-1");
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 空のキューのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    await manager.initialize();

    // 空のキューを作成
    await manager.saveMessageQueue({
      threadId: "empty-1",
      messages: [],
    });
    await manager.saveMessageQueue({
      threadId: "empty-2",
      messages: [],
    });

    // メッセージがあるキューを作成
    await manager.addMessageToQueue("non-empty", {
      messageId: "msg-1",
      content: "Test",
      timestamp: Date.now(),
      authorId: "user-1",
    });

    const deleted = await manager.cleanupEmptyQueues();
    assertEquals(deleted.length, 2);
    assertEquals(deleted.includes("empty-1"), true);
    assertEquals(deleted.includes("empty-2"), true);

    // 残っているキューを確認
    const remaining = await manager.getAllQueues();
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0].threadId, "non-empty");
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
