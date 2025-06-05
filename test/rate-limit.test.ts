import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import { ClaudeCodeRateLimitError, Worker } from "../src/worker.ts";
import { WorkspaceManager } from "../src/workspace.ts";

Deno.test("レートリミット検出とメッセージ作成", async () => {
  const baseDir = await Deno.makeTempDir({ prefix: "test_rate_limit_" });
  const workspaceManager = new WorkspaceManager(baseDir);
  await workspaceManager.initialize();

  const admin = new Admin(workspaceManager);
  const threadId = "test-thread-123";
  const timestamp = Math.floor(Date.now() / 1000);

  // レートリミットメッセージを作成
  const message = admin.createRateLimitMessage(threadId, timestamp);

  // メッセージ内容をチェック
  assertStringIncludes(
    message.content,
    "Claude Codeのレートリミットに達しました",
  );
  assertStringIncludes(message.content, "自動で継続しますか？");

  // ボタンコンポーネントをチェック
  assertEquals(message.components?.length, 1);
  assertEquals(message.components?.[0].components?.length, 2);

  const buttons = message.components?.[0].components;
  assertEquals(buttons?.[0].label, "はい - 自動継続する");
  assertEquals(buttons?.[0].custom_id, `rate_limit_auto_yes_${threadId}`);
  assertEquals(buttons?.[1].label, "いいえ - 手動で再開する");
  assertEquals(buttons?.[1].custom_id, `rate_limit_auto_no_${threadId}`);

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
  const worker = new Worker("test-worker", workspaceManager);

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
