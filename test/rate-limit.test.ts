import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import { ClaudeCodeRateLimitError, Worker } from "../src/worker.ts";
import { WorkspaceManager } from "../src/workspace.ts";
import { createMockClaudeCommandExecutor } from "./test-utils.ts";

Deno.test("レートリミット検出とメッセージ作成", async () => {
  const baseDir = await Deno.makeTempDir({ prefix: "test_rate_limit_" });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-123";
  const timestamp = Math.floor(Date.now() / 1000);

  // レートリミットメッセージを作成
  const message = admin.createRateLimitMessage(threadId, timestamp);

  // メッセージ内容をチェック（string型に対応）
  assertStringIncludes(
    message,
    "Claude Codeのレートリミットに達しました",
  );
  assertStringIncludes(message, "制限解除予定時刻");
  assertStringIncludes(
    message,
    "この時間までに送信されたメッセージは、制限解除後に自動的に処理されます",
  );

  await Deno.remove(baseDir, { recursive: true });
});

Deno.test("ClaudeCodeRateLimitError の作成と属性", () => {
  const timestamp = 1749168000;
  const error = new ClaudeCodeRateLimitError(timestamp);

  assertEquals(error.name, "ClaudeCodeRateLimitError");
  assertEquals(error.timestamp, timestamp);
  assertEquals(error.message, `Claude AI usage limit reached|${timestamp}`);
});

Deno.test("Worker でのレートリミット検出", () => {
  const baseDir = "/tmp/test";
  const workspaceManager = new WorkspaceManager(baseDir);
  const mockExecutor = createMockClaudeCommandExecutor();
  const worker = new Worker("test-worker", workspaceManager, mockExecutor);

  // private メソッドにアクセスするため型アサーション
  const workerAny = (worker as unknown) as {
    isClaudeCodeRateLimit: (result: string) => boolean;
    extractRateLimitTimestamp: (result: string) => number | null;
  };

  // レートリミットメッセージの検出テスト
  assertEquals(
    workerAny.isClaudeCodeRateLimit("Claude AI usage limit reached|1749168000"),
    true,
  );
  assertEquals(workerAny.isClaudeCodeRateLimit("Normal response"), false);

  // タイムスタンプ抽出テスト
  assertEquals(
    workerAny.extractRateLimitTimestamp(
      "Claude AI usage limit reached|1749168000",
    ),
    1749168000,
  );
  assertEquals(workerAny.extractRateLimitTimestamp("Normal response"), null);
});

Deno.test("レートリミット自動継続ボタンハンドリング", async () => {
  const baseDir = await Deno.makeTempDir({ prefix: "test_rate_limit_button_" });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-456";
  const timestamp = Math.floor(Date.now() / 1000);

  // Workerを作成してスレッド情報を準備
  await admin.createWorker(threadId);

  // レートリミット情報を保存
  const threadInfo = await workspaceManager.loadThreadInfo(threadId);
  if (threadInfo) {
    threadInfo.rateLimitTimestamp = timestamp;
    await workspaceManager.saveThreadInfo(threadInfo);
  }

  // 「はい」ボタンの処理
  const yesResult = await admin.handleButtonInteraction(
    threadId,
    `rate_limit_auto_yes_${threadId}`,
  );
  assertStringIncludes(yesResult, "自動継続が設定されました");

  // スレッド情報が更新されていることを確認
  const updatedThreadInfo = await workspaceManager.loadThreadInfo(threadId);
  assertEquals(updatedThreadInfo?.autoResumeAfterRateLimit, true);

  // 「いいえ」ボタンの処理
  const noResult = await admin.handleButtonInteraction(
    threadId,
    `rate_limit_auto_no_${threadId}`,
  );
  assertStringIncludes(noResult, "手動での再開が選択されました");

  // スレッド情報が更新されていることを確認
  const finalThreadInfo = await workspaceManager.loadThreadInfo(threadId);
  assertEquals(finalThreadInfo?.autoResumeAfterRateLimit, false);

  // スレッドを終了してタイマーをクリア
  await admin.terminateThread(threadId);

  await Deno.remove(baseDir, { recursive: true });
});

Deno.test("レートリミットタイマーの復旧 - 時間が残っている場合", async () => {
  const baseDir = await Deno.makeTempDir({
    prefix: "test_rate_limit_restore_",
  });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-restore-1";

  // 未来のタイムスタンプ（30秒後）
  const futureTimestamp = Math.floor((Date.now() + 30 * 1000) / 1000);

  // Workerを作成してスレッド情報を準備
  await admin.createWorker(threadId);

  // レートリミット情報を保存（自動継続有効）
  const threadInfo = await workspaceManager.loadThreadInfo(threadId);
  if (threadInfo) {
    threadInfo.rateLimitTimestamp = futureTimestamp;
    threadInfo.autoResumeAfterRateLimit = true;
    await workspaceManager.saveThreadInfo(threadInfo);
  }

  // 新しいAdminインスタンスで復旧をテスト
  const admin2 = new Admin(workspaceManager);
  await admin2.restoreActiveThreads();

  // タイマーが設定されていることを確認（実際にはprivateなのでMapのサイズで確認）
  const adminAny = (admin2 as unknown) as {
    autoResumeTimers: Map<string, number>;
  };
  assertEquals(adminAny.autoResumeTimers.has(threadId), true);

  // クリーンアップ
  await admin2.terminateThread(threadId);
  await Deno.remove(baseDir, { recursive: true });
});

Deno.test("レートリミットタイマーの復旧 - 時間が過ぎている場合", async () => {
  const baseDir = await Deno.makeTempDir({
    prefix: "test_rate_limit_restore_expired_",
  });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-restore-2";

  // 過去のタイムスタンプ（10分前）
  const pastTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);

  // Workerを作成してスレッド情報を準備
  await admin.createWorker(threadId);

  // レートリミット情報を保存（自動継続有効）
  const threadInfo = await workspaceManager.loadThreadInfo(threadId);
  if (threadInfo) {
    threadInfo.rateLimitTimestamp = pastTimestamp;
    threadInfo.autoResumeAfterRateLimit = true;
    await workspaceManager.saveThreadInfo(threadInfo);
  }

  // 自動再開コールバックをモック
  let autoResumeCallbackCalled = false;
  let autoResumeThreadId = "";
  let autoResumeMessage = "";

  admin.setAutoResumeCallback(async (threadId: string, message: string) => {
    autoResumeCallbackCalled = true;
    autoResumeThreadId = threadId;
    autoResumeMessage = message;
  });

  // 新しいAdminインスタンスで復旧をテスト（コールバックは引き継がれないのでadminを使用）
  await admin.restoreActiveThreads();

  // 即座に自動再開が実行されたことを確認
  assertEquals(autoResumeCallbackCalled, true);
  assertEquals(autoResumeThreadId, threadId);
  assertEquals(autoResumeMessage, "続けて");

  // レートリミット情報がリセットされていることを確認
  const updatedThreadInfo = await workspaceManager.loadThreadInfo(threadId);
  assertEquals(updatedThreadInfo?.rateLimitTimestamp, undefined);
  assertEquals(updatedThreadInfo?.autoResumeAfterRateLimit, undefined);

  // クリーンアップ
  await admin.terminateThread(threadId);
  await Deno.remove(baseDir, { recursive: true });
});

Deno.test("レートリミットタイマーの復旧 - 自動継続が無効の場合", async () => {
  const baseDir = await Deno.makeTempDir({
    prefix: "test_rate_limit_restore_disabled_",
  });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-restore-3";

  // 未来のタイムスタンプ
  const futureTimestamp = Math.floor((Date.now() + 30 * 1000) / 1000);

  // Workerを作成してスレッド情報を準備
  await admin.createWorker(threadId);

  // レートリミット情報を保存（自動継続無効）
  const threadInfo = await workspaceManager.loadThreadInfo(threadId);
  if (threadInfo) {
    threadInfo.rateLimitTimestamp = futureTimestamp;
    threadInfo.autoResumeAfterRateLimit = false;
    await workspaceManager.saveThreadInfo(threadInfo);
  }

  // 新しいAdminインスタンスで復旧をテスト
  const admin2 = new Admin(workspaceManager);
  await admin2.restoreActiveThreads();

  // タイマーが設定されていないことを確認
  const adminAny = (admin2 as unknown) as {
    autoResumeTimers: Map<string, number>;
  };
  assertEquals(adminAny.autoResumeTimers.has(threadId), false);

  // クリーンアップ
  await admin2.terminateThread(threadId);
  await Deno.remove(baseDir, { recursive: true });
});
