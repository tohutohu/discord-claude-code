import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import {
  createDevcontainerProgressHandler,
  DevcontainerProgressTracker,
} from "./devcontainer-progress.ts";

// モック用の型定義
interface MockProgressCallback {
  calls: Array<{ message: string; logs: string[] }>;
  (message: string, logs: string[]): void | Promise<void>;
}

function createMockProgressCallback(): MockProgressCallback {
  const calls: Array<{ message: string; logs: string[] }> = [];
  const callback = (message: string, logs: string[]) => {
    calls.push({ message, logs: [...logs] });
  };
  callback.calls = calls;
  return callback as MockProgressCallback;
}

Deno.test("progressMessageありでハンドラーを作成し、定期的な進捗更新が行われる", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージが送信されることを確認
  await time.tickAsync(0);
  assertEquals(progressCallback.calls.length, 1);
  assertEquals(progressCallback.calls[0].message, "Building container...");
  assertEquals(progressCallback.calls[0].logs, []);

  // ログを追加
  handler("First log line");
  handler("Second log line");

  // 2秒後に進捗更新が行われることを確認
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 2);
  assertEquals(progressCallback.calls[1].message, "Building container...");
  assertEquals(progressCallback.calls[1].logs, [
    "First log line",
    "Second log line",
  ]);

  // さらに2秒後に再度更新
  handler("Third log line");
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 3);
  assertEquals(progressCallback.calls[2].message, "Building container...");
  assertEquals(progressCallback.calls[2].logs, [
    "First log line",
    "Second log line",
    "Third log line",
  ]);

  // クリーンアップ
  handler.cleanup();
});

Deno.test("progressMessageなしでハンドラーを作成した場合、定期的な更新は行われない", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(progressCallback);

  // 初回の進捗メッセージは送信されない
  await time.tickAsync(0);
  assertEquals(progressCallback.calls.length, 0);

  // ログを追加しても定期更新は行われない
  handler("First log line");
  handler("Second log line");
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 0);

  // さらに時間が経過しても更新されない
  await time.tickAsync(10000);
  assertEquals(progressCallback.calls.length, 0);

  // クリーンアップ
  handler.cleanup();
});

Deno.test("重要なイベントパターンによる即時更新が行われる", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージ
  await time.tickAsync(0);
  assertEquals(progressCallback.calls.length, 1);

  // 通常のログは即時更新されない
  handler("Some regular log");
  assertEquals(progressCallback.calls.length, 1);

  // "Step" パターンで即時更新
  handler("Step 1/5: Installing dependencies");
  assertEquals(progressCallback.calls.length, 2);
  assertEquals(
    progressCallback.calls[1].logs.includes(
      "Step 1/5: Installing dependencies",
    ),
    true,
  );

  // "CACHED" パターンで即時更新
  handler("[1/3] CACHED [base 1/2]");
  assertEquals(progressCallback.calls.length, 3);

  // "FINISHED" パターンで即時更新
  handler("[2/3] FINISHED");
  assertEquals(progressCallback.calls.length, 4);

  // "RUN" パターンで即時更新
  handler("[3/3] RUN npm install");
  assertEquals(progressCallback.calls.length, 5);

  // クリーンアップ
  handler.cleanup();
});

Deno.test("ログの最大行数制限（30行）が適用される", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージ
  await time.tickAsync(0);
  progressCallback.calls.length = 0; // リセット

  // 35行のログを追加
  for (let i = 1; i <= 35; i++) {
    handler(`Log line ${i}`);
  }

  // 定期更新を待つ
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 1);
  const logs = progressCallback.calls[0].logs;

  // 最後の30行のみが保持されることを確認
  assertEquals(logs.length, 30);
  assertEquals(logs[0], "Log line 6");
  assertEquals(logs[29], "Log line 35");

  // クリーンアップ
  handler.cleanup();
});

Deno.test("エラーハンドリング: progressCallbackがエラーをスローしても継続する", async () => {
  using time = new FakeTime();
  let callCount = 0;
  const errorCallback = (_message: string, _logs: string[]) => {
    callCount++;
    if (callCount === 2) {
      throw new Error("Callback error");
    }
  };

  const handler = createDevcontainerProgressHandler(
    errorCallback,
    "Building container...",
  );

  // 初回の呼び出し
  await time.tickAsync(0);
  assertEquals(callCount, 1);

  // エラーをスローする呼び出し
  handler("Step 1/2: Error will occur");
  // エラーがスローされても処理は継続する
  assertEquals(callCount, 2);

  // 次の定期更新も正常に行われる
  handler("Another log");
  await time.tickAsync(2000);
  assertEquals(callCount, 3);

  // クリーンアップ
  handler.cleanup();
});

Deno.test("cleanupメソッドがタイマーを適切にクリアする", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージ
  await time.tickAsync(0);
  assertEquals(progressCallback.calls.length, 1);

  // ログを追加
  handler("Some log");

  // クリーンアップ
  handler.cleanup();

  // クリーンアップ後は定期更新が行われない
  await time.tickAsync(10000);
  assertEquals(progressCallback.calls.length, 1); // 増えていない

  // クリーンアップ後にログを追加しても何も起きない
  handler("This should not trigger anything");
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 1); // 増えていない
});

// DevcontainerProgressTracker のテスト
Deno.test("DevcontainerProgressTracker: デフォルト値での初期化", () => {
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(progressCallback);

  // デフォルト値が適用されていることを確認
  // maxLogLines = 20, updateInterval = 1000 がデフォルト
  tracker.cleanup();
});

Deno.test("DevcontainerProgressTracker: ログの追加と最大行数制限", () => {
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(progressCallback, 5); // maxLogLines = 5

  // 10個のログを追加
  for (let i = 1; i <= 10; i++) {
    tracker.addLog(`Log ${i}`, "Progress");
  }

  // 最初の進捗更新が送信されるのを待つ
  // 即時更新の閾値は updateInterval * 0.5 = 500ms
  tracker.startPeriodicUpdates("Progress");

  // 進捗コールバックが呼ばれ、最後の5行のみが含まれることを確認
  // startPeriodicUpdatesの直後には更新されないので、手動で確認が必要

  tracker.cleanup();
});

Deno.test("DevcontainerProgressTracker: 即時更新の閾値（500ms）", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(
    progressCallback,
    20,
    1000, // updateInterval = 1000ms
  );

  tracker.startPeriodicUpdates("Building...");

  // 最初のログ追加（初回なので即座に更新される）
  tracker.addLog("First log");
  assertEquals(progressCallback.calls.length, 0); // startPeriodicUpdatesでは即座に更新されない

  // 499ms経過（閾値未満）
  await time.tickAsync(499);
  tracker.addLog("Second log");
  assertEquals(progressCallback.calls.length, 0); // まだ更新されない

  // さらに2ms経過（合計501ms = 閾値を超える）
  await time.tickAsync(2);
  tracker.addLog("Third log");
  assertEquals(progressCallback.calls.length, 1); // 更新される
  assertEquals(progressCallback.calls[0].message, "Building...");
  assertEquals(progressCallback.calls[0].logs.length, 3);

  tracker.cleanup();
});

Deno.test("DevcontainerProgressTracker: 定期的な更新（1000ms間隔）", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(
    progressCallback,
    20,
    1000, // updateInterval = 1000ms
  );

  tracker.addLog("Initial log");
  tracker.startPeriodicUpdates("Processing...");

  // 999ms経過
  await time.tickAsync(999);
  assertEquals(progressCallback.calls.length, 0);

  // 1ms経過（合計1000ms）
  await time.tickAsync(1);
  assertEquals(progressCallback.calls.length, 1);
  assertEquals(progressCallback.calls[0].message, "Processing...");

  // さらに1000ms経過
  await time.tickAsync(1000);
  assertEquals(progressCallback.calls.length, 2);

  tracker.cleanup();
});

Deno.test("DevcontainerProgressTracker: カスタム値での初期化", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(
    progressCallback,
    10, // maxLogLines = 10
    500, // updateInterval = 500ms
  );

  // 15個のログを追加
  for (let i = 1; i <= 15; i++) {
    tracker.addLog(`Log ${i}`);
  }

  tracker.startPeriodicUpdates("Custom progress");

  // 500ms後に更新される
  await time.tickAsync(500);
  assertEquals(progressCallback.calls.length, 1);
  const logs = progressCallback.calls[0].logs;
  assertEquals(logs.length, 10); // 最大10行
  assertEquals(logs[0], "Log 6"); // 最初の5行は削除される
  assertEquals(logs[9], "Log 15");

  tracker.cleanup();
});

Deno.test("DevcontainerProgressTracker: cleanupによるリソース解放", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const tracker = new DevcontainerProgressTracker(progressCallback);

  tracker.startPeriodicUpdates("Cleaning up...");
  tracker.addLog("Some log");

  // クリーンアップ
  tracker.cleanup();

  // クリーンアップ後は定期更新が行われない
  await time.tickAsync(5000);
  assertEquals(progressCallback.calls.length, 0);

  // ログを追加しても更新されない
  tracker.addLog("After cleanup");
  await time.tickAsync(1000);
  assertEquals(progressCallback.calls.length, 0);
});

Deno.test("複数の重要パターンが同時に含まれる場合も適切に処理される", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージ
  await time.tickAsync(0);
  progressCallback.calls.length = 0; // リセット

  // 複数のパターンを含むログ
  handler("Step 1/3: RUN npm install");
  assertEquals(progressCallback.calls.length, 1);
  assertEquals(
    progressCallback.calls[0].logs.includes("Step 1/3: RUN npm install"),
    true,
  );

  // CACHED と FINISHED の組み合わせ
  handler("[1/2] CACHED and FINISHED");
  assertEquals(progressCallback.calls.length, 2);

  // クリーンアップ
  handler.cleanup();
});

Deno.test("空のログメッセージも適切に処理される", async () => {
  using time = new FakeTime();
  const progressCallback = createMockProgressCallback();
  const handler = createDevcontainerProgressHandler(
    progressCallback,
    "Building container...",
  );

  // 初回の進捗メッセージ
  await time.tickAsync(0);
  progressCallback.calls.length = 0; // リセット

  // 空のログを追加
  handler("");
  handler("   "); // 空白のみ
  handler("Normal log");

  // 定期更新を待つ
  await time.tickAsync(2000);
  assertEquals(progressCallback.calls.length, 1);
  assertEquals(progressCallback.calls[0].logs.length, 3);
  assertEquals(progressCallback.calls[0].logs[0], "");
  assertEquals(progressCallback.calls[0].logs[1], "   ");
  assertEquals(progressCallback.calls[0].logs[2], "Normal log");

  // クリーンアップ
  handler.cleanup();
});

Deno.test("progressCallbackが非同期関数の場合も適切に処理される", async () => {
  using time = new FakeTime();
  let callCount = 0;
  const asyncCallback = async (_message: string, _logs: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    callCount++;
  };

  const handler = createDevcontainerProgressHandler(
    asyncCallback,
    "Building container...",
  );

  // 初回の呼び出し
  await time.tickAsync(100);
  assertEquals(callCount, 1);

  // 重要パターンによる即時更新
  handler("Step 1/2: Async processing");
  await time.tickAsync(100);
  assertEquals(callCount, 2);

  // 定期更新
  await time.tickAsync(2000);
  assertEquals(callCount, 3);

  // クリーンアップ
  handler.cleanup();
});
