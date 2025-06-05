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

  async executeStreaming(
    _args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const mockOutput = JSON.stringify({
      type: "result",
      result: this.mockResponse,
      session_id: "mock-session-id-12345",
    });

    // ストリーミングをシミュレート
    onData(new TextEncoder().encode(mockOutput));

    return {
      code: 0,
      stderr: new TextEncoder().encode(""),
    };
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

Deno.test("Worker - Claude Codeの実際の出力が行ごとに送信される", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "output-test";

  // モックJSONLデータ（実際の出力を含む）
  const mockJsonlLines = [
    JSON.stringify({ type: "session_start", session_id: "test-session-1" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "text",
          text: "ファイルを編集しています\n新しい関数を追加しました",
        }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "text",
          text: "テストを実行中...\n✅ すべてのテストが通過しました",
        }],
      },
    }),
    JSON.stringify({
      type: "result",
      result: "処理が完了しました\n変更内容を確認してください",
    }),
  ];

  const mockExecutor = new MockStreamingClaudeCommandExecutor(mockJsonlLines);
  const worker = new Worker(workerName, workspace, mockExecutor);

  // リポジトリ設定
  const repository = parseRepository("test/repo");
  const localPath = "/tmp/test/repo";
  await worker.setRepository(repository, localPath);

  // 出力メッセージをキャプチャ
  const outputMessages: string[] = [];
  const onProgress = async (message: string) => {
    outputMessages.push(message);
  };

  // メッセージ処理実行
  await worker.processMessage("テストメッセージ", onProgress);

  // 期待される出力メッセージが送信されたことを確認
  const expectedMessages = [
    "ファイルを編集しています\n新しい関数を追加しました",
    "テストを実行中...\n✅ すべてのテストが通過しました",
    "処理が完了しました\n変更内容を確認してください",
  ];

  // すべての期待されるメッセージが含まれているかチェック
  for (const expectedMessage of expectedMessages) {
    assertEquals(
      outputMessages.some((msg) => msg.includes(expectedMessage)),
      true,
      `期待される出力メッセージが見つかりません: ${expectedMessage}`,
    );
  }
});

Deno.test("Worker - エラーメッセージも正しく出力される", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "error-test";

  // エラーを含むモックJSONLデータ
  const mockJsonlLines = [
    JSON.stringify({ type: "session_start", session_id: "test-session-1" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "ファイルを読み込み中..." }] },
    }),
    JSON.stringify({
      type: "error",
      is_error: true,
      message: {
        content: [{
          type: "text",
          text: "ファイルが見つかりません\nパスを確認してください",
        }],
      },
    }),
    JSON.stringify({ type: "result", result: "エラーが発生しました" }),
  ];

  const mockExecutor = new MockStreamingClaudeCommandExecutor(mockJsonlLines);
  const worker = new Worker(workerName, workspace, mockExecutor);

  // リポジトリ設定
  const repository = parseRepository("test/repo");
  const localPath = "/tmp/test/repo";
  await worker.setRepository(repository, localPath);

  // 出力メッセージをキャプチャ
  const outputMessages: string[] = [];
  const onProgress = async (message: string) => {
    outputMessages.push(message);
  };

  // メッセージ処理実行
  await worker.processMessage("テストメッセージ", onProgress);

  // 期待される出力メッセージが含まれることを確認
  const expectedMessages = [
    "ファイルを読み込み中...",
    "ファイルが見つかりません\nパスを確認してください",
    "エラーが発生しました",
  ];

  // すべての期待されるメッセージが含まれているかチェック
  for (const expectedMessage of expectedMessages) {
    assertEquals(
      outputMessages.some((msg) => msg.includes(expectedMessage)),
      true,
      `期待される出力メッセージが見つかりません: ${expectedMessage}`,
    );
  }
});
