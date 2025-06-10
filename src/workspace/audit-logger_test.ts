import { assertEquals } from "std/assert/mod.ts";
import { AuditLogger } from "./audit-logger.ts";
import type { AuditEntry } from "../workspace.ts";

Deno.test("AuditLogger - ログの追記と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    await logger.initialize();

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

    await logger.appendAuditLog(entry1);
    await logger.appendAuditLog(entry2);

    const today = new Date().toISOString().split("T")[0];
    const logs = await logger.getAuditLogs(today);

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
    await logger.initialize();

    const logs = await logger.getAuditLogs("2099-12-31");
    assertEquals(logs, []);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("AuditLogger - 日付一覧の取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const logger = new AuditLogger(testBaseDir);
    await logger.initialize();

    // 複数の日付のログを作成（内部で日付ディレクトリを作成）
    const date1 = "2024-01-15";
    const date2 = "2024-01-16";
    const date3 = "2024-01-14";

    // 各日付のディレクトリを直接作成
    await Deno.mkdir(`${testBaseDir}/audit/${date1}`, { recursive: true });
    await Deno.mkdir(`${testBaseDir}/audit/${date2}`, { recursive: true });
    await Deno.mkdir(`${testBaseDir}/audit/${date3}`, { recursive: true });

    const dates = await logger.getAuditLogDates();
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
    await logger.initialize();

    const targetThreadId = "thread-target";
    const otherThreadId = "thread-other";

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: targetThreadId,
      action: "action1",
      details: {},
    });

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: otherThreadId,
      action: "action2",
      details: {},
    });

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: targetThreadId,
      action: "action3",
      details: {},
    });

    const today = new Date().toISOString().split("T")[0];
    const logs = await logger.getAuditLogsByThread(targetThreadId, today);

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
    await logger.initialize();

    const targetAction = "worker_created";
    const otherAction = "message_received";

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread1",
      action: targetAction,
      details: {},
    });

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread2",
      action: otherAction,
      details: {},
    });

    await logger.appendAuditLog({
      timestamp: new Date().toISOString(),
      threadId: "thread3",
      action: targetAction,
      details: {},
    });

    const today = new Date().toISOString().split("T")[0];
    const logs = await logger.getAuditLogsByAction(targetAction, today);

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
    await logger.initialize();

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
    await logger.cleanupOldAuditLogs(7);

    const dates = await logger.getAuditLogDates();
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
    await logger.initialize();

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId: "thread-123",
      action: "test_action",
      details: { data: "test" },
    };

    await logger.appendAuditLog(entry);

    // 手動で空行を追加
    const today = new Date().toISOString().split("T")[0];
    const filePath = `${testBaseDir}/audit/${today}/activity.jsonl`;
    await Deno.writeTextFile(filePath, "\n\n", { append: true });

    const logs = await logger.getAuditLogs(today);
    // 空行は除外される
    assertEquals(logs.length, 1);
    assertEquals(logs[0].action, entry.action);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
