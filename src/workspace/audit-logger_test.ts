import { assertEquals, assertExists } from "std/assert/mod.ts";
import { AuditLogger } from "./audit-logger.ts";
import type { AuditEntry } from "./workspace.ts";

Deno.test("AuditLogger - ログの追記と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    const entry1: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId: "thread-123",
      action: "worker_created",
      details: { workerName: "test-worker" },
    };

    const entry2: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId: "thread-456",
      action: "message_received",
      details: { messageId: "msg-789" },
    };

    const appendResult1 = await logger.appendAuditLog(entry1);
    assertExists(appendResult1.isOk());
    assertEquals(appendResult1.isOk(), true);

    const appendResult2 = await logger.appendAuditLog(entry2);
    assertExists(appendResult2.isOk());
    assertEquals(appendResult2.isOk(), true);

    const today = new Date().toISOString().split("T")[0];
    const logsResult = await logger.getAuditLogs(today);
    assertExists(logsResult.isOk());
    assertEquals(logsResult.isOk(), true);

    if (!logsResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const logs = logsResult.value;
    assertEquals(logs.length, 2);
    assertEquals(logs[0].threadId, entry1.threadId);
    assertEquals(logs[0].action, entry1.action);
    assertEquals(logs[1].threadId, entry2.threadId);
    assertEquals(logs[1].action, entry2.action);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - 存在しない日付のログ読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    const logsResult = await logger.getAuditLogs("2099-12-31");
    assertExists(logsResult.isOk());
    assertEquals(logsResult.isOk(), true);

    if (!logsResult.isOk()) {
      throw new Error("Unexpected error");
    }
    assertEquals(logsResult.value, []);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - 日付一覧の取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    // 複数の日付のログを作成（内部で日付ディレクトリを作成）
    const date1 = "2024-01-15";
    const date2 = "2024-01-16";
    const date3 = "2024-01-14";

    // 各日付のディレクトリを直接作成
    await Deno.mkdir(`${testBaseDir}/audit/${date1}`, { recursive: true });
    await Deno.mkdir(`${testBaseDir}/audit/${date2}`, { recursive: true });
    await Deno.mkdir(`${testBaseDir}/audit/${date3}`, { recursive: true });

    const datesResult = await logger.getAuditLogDates();
    assertExists(datesResult.isOk());
    assertEquals(datesResult.isOk(), true);

    if (!datesResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const dates = datesResult.value;
    assertEquals(dates.length, 3);
    // 新しい日付順
    assertEquals(dates[0], date2);
    assertEquals(dates[1], date1);
    assertEquals(dates[2], date3);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - スレッドIDでのフィルタリング", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    const targetThreadId = "thread-target";
    const otherThreadId = "thread-other";

    const appendResult1 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: targetThreadId,
      action: "action1",
      details: {},
    });
    assertExists(appendResult1.isOk());
    assertEquals(appendResult1.isOk(), true);

    const appendResult2 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: otherThreadId,
      action: "action2",
      details: {},
    });
    assertExists(appendResult2.isOk());
    assertEquals(appendResult2.isOk(), true);

    const appendResult3 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: targetThreadId,
      action: "action3",
      details: {},
    });
    assertExists(appendResult3.isOk());
    assertEquals(appendResult3.isOk(), true);

    const today = new Date().toISOString().split("T")[0];
    const logsResult = await logger.getAuditLogsByThread(targetThreadId, today);
    assertExists(logsResult.isOk());
    assertEquals(logsResult.isOk(), true);

    if (!logsResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const logs = logsResult.value;
    assertEquals(logs.length, 2);
    assertEquals(logs[0].threadId, targetThreadId);
    assertEquals(logs[1].threadId, targetThreadId);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - アクションでのフィルタリング", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    const targetAction = "worker_created";
    const otherAction = "message_received";

    const appendResult1 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread1",
      action: targetAction,
      details: {},
    });
    assertExists(appendResult1.isOk());
    assertEquals(appendResult1.isOk(), true);

    const appendResult2 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread2",
      action: otherAction,
      details: {},
    });
    assertExists(appendResult2.isOk());
    assertEquals(appendResult2.isOk(), true);

    const appendResult3 = await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread3",
      action: targetAction,
      details: {},
    });
    assertExists(appendResult3.isOk());
    assertEquals(appendResult3.isOk(), true);

    const today = new Date().toISOString().split("T")[0];
    const logsResult = await logger.getAuditLogsByAction(targetAction, today);
    assertExists(logsResult.isOk());
    assertEquals(logsResult.isOk(), true);

    if (!logsResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const logs = logsResult.value;
    assertEquals(logs.length, 2);
    assertEquals(logs[0].action, targetAction);
    assertEquals(logs[1].action, targetAction);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - 古いログのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    // 複数の日付のディレクトリを作成
    const today = new Date();
    const oldDate1 = new Date(today);
    oldDate1.setDate(today.getDate() - 10);
    const oldDate2 = new Date(today);
    oldDate2.setDate(today.getDate() - 8);
    const recentDate = new Date(today);
    recentDate.setDate(today.getDate() - 3);

    const oldDateStr1 = oldDate1.toISOString().split("T")[0];
    const oldDateStr2 = oldDate2.toISOString().split("T")[0];
    const recentDateStr = recentDate.toISOString().split("T")[0];

    await Deno.mkdir(`${testBaseDir}/audit/${oldDateStr1}`, {
      recursive: true,
    });
    await Deno.mkdir(`${testBaseDir}/audit/${oldDateStr2}`, {
      recursive: true,
    });
    await Deno.mkdir(`${testBaseDir}/audit/${recentDateStr}`, {
      recursive: true,
    });

    // 7日以上前のログをクリーンアップ
    const cleanupResult = await logger.cleanupOldAuditLogs(7);
    assertExists(cleanupResult.isOk());
    assertEquals(cleanupResult.isOk(), true);

    const datesResult = await logger.getAuditLogDates();
    assertExists(datesResult.isOk());
    assertEquals(datesResult.isOk(), true);

    if (!datesResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const dates = datesResult.value;
    assertEquals(dates.length, 1);
    assertEquals(dates[0], recentDateStr);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - 空行を含むログの処理", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    const initResult = await logger.initialize();
    assertExists(initResult.isOk());
    assertEquals(initResult.isOk(), true);

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId: "thread-123",
      action: "test_action",
      details: { data: "test" },
    };

    const appendResult = await logger.appendAuditLog(entry);
    assertExists(appendResult.isOk());
    assertEquals(appendResult.isOk(), true);

    // 手動で空行を追加
    const today = new Date().toISOString().split("T")[0];
    const filePath = `${testBaseDir}/audit/${today}/activity.jsonl`;
    await Deno.writeTextFile(filePath, "\n\n", { append: true });

    const logsResult = await logger.getAuditLogs(today);
    assertExists(logsResult.isOk());
    assertEquals(logsResult.isOk(), true);

    if (!logsResult.isOk()) {
      throw new Error("Unexpected error");
    }
    const logs = logsResult.value;
    // 空行は除外される
    assertEquals(logs.length, 1);
    assertEquals(logs[0].action, entry.action);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
