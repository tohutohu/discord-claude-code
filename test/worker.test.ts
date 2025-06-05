import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ClaudeCommandExecutor, Worker } from "../src/worker.ts";
import { parseRepository } from "../src/git-utils.ts";
import { WorkspaceManager } from "../src/workspace.ts";

async function createTestWorkspaceManager(): Promise<WorkspaceManager> {
  const testDir = await Deno.makeTempDir({ prefix: "worker_test_" });
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();
  return workspace;
}

// テスト用のモックClaudeCommandExecutor
class MockClaudeCommandExecutor implements ClaudeCommandExecutor {
  private mockResponse: string;

  constructor(mockResponse = "Claude Codeのモック応答です。") {
    this.mockResponse = mockResponse;
  }

  execute(
    _args: string[],
    _cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const mockOutput = JSON.stringify({
      type: "result",
      result: this.mockResponse,
      session_id: "mock-session-id-12345",
    });

    return Promise.resolve({
      code: 0,
      stdout: new TextEncoder().encode(mockOutput),
      stderr: new TextEncoder().encode(""),
    });
  }
}

Deno.test("Worker - メッセージを受け取って返信する（リポジトリ未設定）", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "happy-panda";
  const worker = new Worker(workerName, workspace);

  const message = "テストメッセージです";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
  );
});

Deno.test("Worker - 名前を取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "clever-fox";
  const worker = new Worker(workerName, workspace);

  assertEquals(worker.getName(), workerName);
});

Deno.test("Worker - 空のメッセージも処理できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "gentle-bear";
  const worker = new Worker(workerName, workspace);

  const message = "";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
  );
});

Deno.test("Worker - リポジトリ情報を設定・取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "smart-cat";
  const worker = new Worker(workerName, workspace);

  // 初期状態ではリポジトリは未設定
  assertEquals(worker.getRepository(), null);

  // リポジトリ情報を設定
  const repository = parseRepository("owner/repo");
  const localPath = "/tmp/owner/repo";
  await worker.setRepository(repository, localPath);

  // リポジトリ情報が正しく設定されているか確認
  const storedRepo = worker.getRepository();
  assertEquals(storedRepo?.fullName, "owner/repo");
  assertEquals(storedRepo?.org, "owner");
  assertEquals(storedRepo?.repo, "repo");
});

Deno.test("Worker - リポジトリ設定後のメッセージ処理", async () => {
  const workerName = "wise-owl";
  const mockExecutor = new MockClaudeCommandExecutor(
    "テストメッセージに対するClaude応答です。",
  );
  const workspace = await createTestWorkspaceManager();
  const worker = new Worker(workerName, workspace, mockExecutor);

  // リポジトリ情報を設定
  const repository = parseRepository("test-org/test-repo");
  const localPath = "/tmp/test-org/test-repo";
  await worker.setRepository(repository, localPath);

  const message = "テストメッセージです";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "テストメッセージに対するClaude応答です。",
  );
});

Deno.test("Worker - verboseモードが正しく設定される", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "verbose-eagle";

  // verboseモード無効でWorkerを作成
  const workerQuiet = new Worker(workerName, workspace, undefined, false);
  assertEquals(workerQuiet.isVerbose(), false);

  // verboseモード有効でWorkerを作成
  const workerVerbose = new Worker(workerName, workspace, undefined, true);
  assertEquals(workerVerbose.isVerbose(), true);

  // verboseモードを動的に変更
  workerQuiet.setVerbose(true);
  assertEquals(workerQuiet.isVerbose(), true);

  workerVerbose.setVerbose(false);
  assertEquals(workerVerbose.isVerbose(), false);
});

Deno.test("Worker - verboseモードでログが出力される", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "chatty-parrot";
  const mockExecutor = new MockClaudeCommandExecutor(
    "verboseモードのテスト応答です。",
  );

  // コンソールログをキャプチャするためのモック
  const originalConsoleLog = console.log;
  const logMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    logMessages.push(args.join(" "));
  };

  try {
    // verboseモード有効でWorkerを作成
    const worker = new Worker(workerName, workspace, mockExecutor, true);

    // リポジトリ情報を設定（ログが出力される）
    const repository = parseRepository("verbose-test/repo");
    const localPath = "/tmp/verbose-test/repo";
    await worker.setRepository(repository, localPath);

    // メッセージ処理（ログが出力される）
    const message = "verboseテストメッセージ";
    const reply = await worker.processMessage(message);

    assertEquals(reply, "verboseモードのテスト応答です。");

    // verboseログが出力されていることを確認
    const verboseLogs = logMessages.filter((log) =>
      log.includes(`[Worker:${workerName}]`) &&
      (log.includes("リポジトリ設定開始") || log.includes("メッセージ処理開始"))
    );

    assertEquals(
      verboseLogs.length >= 2,
      true,
      `期待される数のverboseログが出力されていません。実際のログ: ${verboseLogs.length}`,
    );
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});

Deno.test("Worker - verboseモード無効時はログが出力されない", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "silent-ninja";
  const mockExecutor = new MockClaudeCommandExecutor(
    "通常モードのテスト応答です。",
  );

  // コンソールログをキャプチャするためのモック
  const originalConsoleLog = console.log;
  const logMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    logMessages.push(args.join(" "));
  };

  try {
    // verboseモード無効でWorkerを作成
    const worker = new Worker(workerName, workspace, mockExecutor, false);

    // リポジトリ情報を設定
    const repository = parseRepository("quiet-test/repo");
    const localPath = "/tmp/quiet-test/repo";
    await worker.setRepository(repository, localPath);

    // メッセージ処理
    const message = "通常モードテストメッセージ";
    const reply = await worker.processMessage(message);

    assertEquals(reply, "通常モードのテスト応答です。");

    // verboseログが出力されていないことを確認
    const verboseLogs = logMessages.filter((log) =>
      log.includes(`[Worker:${workerName}]`)
    );

    assertEquals(
      verboseLogs.length,
      0,
      `verboseログが出力されるべきではありません。実際のログ: ${verboseLogs.length}`,
    );
  } finally {
    // コンソールログを元に戻す
    console.log = originalConsoleLog;
  }
});

// 進捗メッセージ機能用のテスト用モック
class MockStreamingClaudeCommandExecutor implements ClaudeCommandExecutor {
  private mockJsonlLines: string[];

  constructor(mockJsonlLines: string[]) {
    this.mockJsonlLines = mockJsonlLines;
  }

  execute(
    _args: string[],
    _cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const output = this.mockJsonlLines.join("\n");
    return Promise.resolve({
      code: 0,
      stdout: new TextEncoder().encode(output),
      stderr: new TextEncoder().encode(""),
    });
  }

  async executeStreaming(
    _args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // 各行を順次送信してストリーミングをシミュレート
    for (const line of this.mockJsonlLines) {
      const data = new TextEncoder().encode(line + "\n");
      onData(data);
      // 少し待機してストリーミング感を演出
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return {
      code: 0,
      stderr: new TextEncoder().encode(""),
    };
  }
}

Deno.test("Worker - JSONL進捗メッセージが正しく生成される", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "progress-test";

  // モックJSONLデータ
  const mockJsonlLines = [
    JSON.stringify({ type: "session_start", session_id: "test-session-1" }),
    JSON.stringify({ type: "task_start" }),
    JSON.stringify({ type: "thinking" }),
    JSON.stringify({ type: "tool_use" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    }),
    JSON.stringify({ type: "result", result: "完了しました" }),
    JSON.stringify({ type: "session_end" }),
  ];

  const mockExecutor = new MockStreamingClaudeCommandExecutor(mockJsonlLines);
  const worker = new Worker(workerName, workspace, mockExecutor);

  // リポジトリ設定
  const repository = parseRepository("test/repo");
  const localPath = "/tmp/test/repo";
  await worker.setRepository(repository, localPath);

  // 進捗メッセージをキャプチャ
  const progressMessages: string[] = [];
  const onProgress = async (message: string) => {
    progressMessages.push(message);
  };

  // メッセージ処理実行
  await worker.processMessage("テストメッセージ", onProgress);

  // 期待される進捗メッセージが送信されたことを確認
  const expectedMessages = [
    "🎯 [1] セッション開始",
    "🔍 [2] タスク開始: 分析中...",
    "💭 [3] 思考中...",
    "🛠️ [4] ツール使用中...",
    "✍️ [5] 回答生成中...",
    "✅ [6] 処理完了",
    "🏁 [7] セッション終了",
  ];

  // すべての期待されるメッセージが含まれているかチェック
  for (const expectedMessage of expectedMessages) {
    assertEquals(
      progressMessages.some((msg) => msg === expectedMessage),
      true,
      `期待されるメッセージが見つかりません: ${expectedMessage}`,
    );
  }
});

Deno.test("Worker - 未知のJSONLタイプに対する進捗メッセージ", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "unknown-type-test";

  // 未知のタイプを含むモックJSONLデータ
  const mockJsonlLines = [
    JSON.stringify({ type: "unknown_type" }),
    JSON.stringify({ type: "ping" }), // 除外されるタイプ
    JSON.stringify({ type: "metadata" }), // 除外されるタイプ
    JSON.stringify({ type: "debug" }), // 除外されるタイプ
    JSON.stringify({ type: "custom_event" }),
  ];

  const mockExecutor = new MockStreamingClaudeCommandExecutor(mockJsonlLines);
  const worker = new Worker(workerName, workspace, mockExecutor);

  // リポジトリ設定
  const repository = parseRepository("test/repo");
  const localPath = "/tmp/test/repo";
  await worker.setRepository(repository, localPath);

  // 進捗メッセージをキャプチャ
  const progressMessages: string[] = [];
  const onProgress = async (message: string) => {
    progressMessages.push(message);
  };

  // メッセージ処理実行
  await worker.processMessage("テストメッセージ", onProgress);

  // 未知のタイプは表示され、除外対象タイプは表示されないことを確認
  assertEquals(
    progressMessages.some((msg) => msg.includes("unknown_type")),
    true,
    "未知のタイプが表示されていません",
  );
  assertEquals(
    progressMessages.some((msg) => msg.includes("custom_event")),
    true,
    "カスタムイベントが表示されていません",
  );

  // 除外対象のタイプは表示されないことを確認
  assertEquals(
    progressMessages.some((msg) => msg.includes("ping")),
    false,
    "除外対象のpingタイプが表示されています",
  );
  assertEquals(
    progressMessages.some((msg) => msg.includes("metadata")),
    false,
    "除外対象のmetadataタイプが表示されています",
  );
  assertEquals(
    progressMessages.some((msg) => msg.includes("debug")),
    false,
    "除外対象のdebugタイプが表示されています",
  );
});
