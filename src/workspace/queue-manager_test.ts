import { assertEquals } from "std/assert/mod.ts";
import { QueueManager } from "./queue-manager.ts";
import type { QueuedMessage, ThreadQueue } from "../workspace.ts";

Deno.test("QueueManager - メッセージキューの保存と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

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

    const saveResult = await manager.saveMessageQueue(threadQueue);
    assertEquals(saveResult.isOk(), true);

    const loadResult = await manager.loadMessageQueue(threadQueue.threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value, threadQueue);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 存在しないキューの読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const loadResult = await manager.loadMessageQueue("non-existent");
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value, null);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - メッセージの追加", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

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
    const addResult1 = await manager.addMessageToQueue(threadId, message1);
    assertEquals(addResult1.isOk(), true);

    let loadResult = await manager.loadMessageQueue(threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value?.messages.length, 1);
      assertEquals(loadResult.value?.messages[0], message1);
    }

    // 2つ目のメッセージを追加
    const addResult2 = await manager.addMessageToQueue(threadId, message2);
    assertEquals(addResult2.isOk(), true);

    loadResult = await manager.loadMessageQueue(threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value?.messages.length, 2);
      assertEquals(loadResult.value?.messages[1], message2);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - メッセージの取得とクリア", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

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
      const addResult = await manager.addMessageToQueue(threadId, msg);
      assertEquals(addResult.isOk(), true);
    }

    // 取得とクリア
    const retrieveResult = await manager.getAndClearMessageQueue(threadId);
    assertEquals(retrieveResult.isOk(), true);
    if (retrieveResult.isOk()) {
      assertEquals(retrieveResult.value.length, 2);
      assertEquals(retrieveResult.value, messages);
    }

    // キューがクリアされていることを確認
    const afterClearResult = await manager.loadMessageQueue(threadId);
    assertEquals(afterClearResult.isOk(), true);
    if (afterClearResult.isOk()) {
      assertEquals(afterClearResult.value, null);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 空のキューの取得とクリア", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const retrieveResult = await manager.getAndClearMessageQueue(
      "empty-thread",
    );
    assertEquals(retrieveResult.isOk(), true);
    if (retrieveResult.isOk()) {
      assertEquals(retrieveResult.value, []);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - キューの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadId = "test-delete";
    const addResult = await manager.addMessageToQueue(threadId, {
      messageId: "msg-1",
      content: "Test",
      timestamp: Date.now(),
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    // 削除前の確認
    let loadResult = await manager.loadMessageQueue(threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value !== null, true);
    }

    // 削除
    const deleteResult = await manager.deleteMessageQueue(threadId);
    assertEquals(deleteResult.isOk(), true);

    // 削除後の確認
    loadResult = await manager.loadMessageQueue(threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value, null);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - キューの長さ取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadId = "test-length";

    // 空のキュー
    let lengthResult = await manager.getQueueLength(threadId);
    assertEquals(lengthResult.isOk(), true);
    if (lengthResult.isOk()) {
      assertEquals(lengthResult.value, 0);
    }

    // メッセージを追加
    let addResult = await manager.addMessageToQueue(threadId, {
      messageId: "msg-1",
      content: "Test 1",
      timestamp: Date.now(),
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    lengthResult = await manager.getQueueLength(threadId);
    assertEquals(lengthResult.isOk(), true);
    if (lengthResult.isOk()) {
      assertEquals(lengthResult.value, 1);
    }

    addResult = await manager.addMessageToQueue(threadId, {
      messageId: "msg-2",
      content: "Test 2",
      timestamp: Date.now(),
      authorId: "user-2",
    });
    assertEquals(addResult.isOk(), true);

    lengthResult = await manager.getQueueLength(threadId);
    assertEquals(lengthResult.isOk(), true);
    if (lengthResult.isOk()) {
      assertEquals(lengthResult.value, 2);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - すべてのキューの取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    // 複数のキューを作成
    let addResult = await manager.addMessageToQueue("thread-1", {
      messageId: "msg-1",
      content: "Thread 1 message",
      timestamp: Date.now(),
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue("thread-2", {
      messageId: "msg-2-1",
      content: "Thread 2 message 1",
      timestamp: Date.now(),
      authorId: "user-2",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue("thread-2", {
      messageId: "msg-2-2",
      content: "Thread 2 message 2",
      timestamp: Date.now(),
      authorId: "user-2",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-1",
      content: "Thread 3 message 1",
      timestamp: Date.now(),
      authorId: "user-3",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-2",
      content: "Thread 3 message 2",
      timestamp: Date.now(),
      authorId: "user-3",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue("thread-3", {
      messageId: "msg-3-3",
      content: "Thread 3 message 3",
      timestamp: Date.now(),
      authorId: "user-3",
    });
    assertEquals(addResult.isOk(), true);

    const queuesResult = await manager.getAllQueues();
    assertEquals(queuesResult.isOk(), true);
    if (queuesResult.isOk()) {
      const allQueues = queuesResult.value;
      assertEquals(allQueues.length, 3);
      // メッセージ数の多い順
      assertEquals(allQueues[0].threadId, "thread-3");
      assertEquals(allQueues[0].messages.length, 3);
      assertEquals(allQueues[1].threadId, "thread-2");
      assertEquals(allQueues[1].messages.length, 2);
      assertEquals(allQueues[2].threadId, "thread-1");
      assertEquals(allQueues[2].messages.length, 1);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 古いメッセージの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadId = "test-old-messages";
    const now = Date.now();

    // 異なる時刻のメッセージを追加
    let addResult = await manager.addMessageToQueue(threadId, {
      messageId: "old-1",
      content: "Old message 1",
      timestamp: now - 3600000, // 1時間前
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue(threadId, {
      messageId: "old-2",
      content: "Old message 2",
      timestamp: now - 1800000, // 30分前
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    addResult = await manager.addMessageToQueue(threadId, {
      messageId: "new-1",
      content: "New message",
      timestamp: now - 300000, // 5分前
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    // 30分以上前のメッセージを削除
    const removeResult = await manager.removeOldMessages(threadId, 1800000);
    assertEquals(removeResult.isOk(), true);
    if (removeResult.isOk()) {
      assertEquals(removeResult.value, 2); // 1時間前と30分前のメッセージが削除
    }

    const loadResult = await manager.loadMessageQueue(threadId);
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value?.messages.length, 1);
      assertEquals(loadResult.value?.messages[0].messageId, "new-1");
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("QueueManager - 空のキューのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new QueueManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    // 空のキューを作成
    let saveResult = await manager.saveMessageQueue({
      threadId: "empty-1",
      messages: [],
    });
    assertEquals(saveResult.isOk(), true);

    saveResult = await manager.saveMessageQueue({
      threadId: "empty-2",
      messages: [],
    });
    assertEquals(saveResult.isOk(), true);

    // メッセージがあるキューを作成
    const addResult = await manager.addMessageToQueue("non-empty", {
      messageId: "msg-1",
      content: "Test",
      timestamp: Date.now(),
      authorId: "user-1",
    });
    assertEquals(addResult.isOk(), true);

    const cleanupResult = await manager.cleanupEmptyQueues();
    assertEquals(cleanupResult.isOk(), true);
    if (cleanupResult.isOk()) {
      const deleted = cleanupResult.value;
      assertEquals(deleted.length, 2);
      assertEquals(deleted.includes("empty-1"), true);
      assertEquals(deleted.includes("empty-2"), true);
    }

    // 残っているキューを確認
    const remainingResult = await manager.getAllQueues();
    assertEquals(remainingResult.isOk(), true);
    if (remainingResult.isOk()) {
      const remaining = remainingResult.value;
      assertEquals(remaining.length, 1);
      assertEquals(remaining[0].threadId, "non-empty");
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
