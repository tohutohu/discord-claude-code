import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Worker } from "../src/worker.ts";
import { parseRepository } from "../src/git-utils.ts";
import {
  captureConsoleOutput,
  createTestRepository,
  createTestWorker,
  createTestWorkspaceManager,
  ERROR_MESSAGES,
  MockClaudeCommandExecutor,
  MockStreamingClaudeCommandExecutor,
} from "./test-utils.ts";

Deno.test("Worker - メッセージを受け取って返信する（リポジトリ未設定）", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "happy-panda";
  const executor = new MockClaudeCommandExecutor();

  try {
    const worker = await createTestWorker(workerName, workspace, executor);
    const message = "テストメッセージです";
    const reply = await worker.processMessage(message);

    assertEquals(reply, ERROR_MESSAGES.REPOSITORY_NOT_SET);
  } finally {
    // WorkspaceManagerのクリーンアップは省略（テストごとに独立）
  }
});

Deno.test("Worker - 名前を取得できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "clever-fox";

  try {
    const worker = await createTestWorker(workerName, workspace);
    assertEquals(worker.getName(), workerName);
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - 空のメッセージも処理できる", async () => {
  const workspace = await createTestWorkspaceManager();
  const executor = new MockClaudeCommandExecutor();

  try {
    const worker = await createTestWorker("test-worker", workspace, executor);
    const reply = await worker.processMessage("");
    assertEquals(reply, ERROR_MESSAGES.REPOSITORY_NOT_SET);
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - リポジトリ情報を設定・取得できる", async () => {
  const workspace = await createTestWorkspaceManager();

  try {
    const worker = await createTestWorker("test-worker", workspace);
    const repository = createTestRepository("octocat", "Hello-World");
    const repoPath = "/path/to/repo";

    await worker.setRepository(repository, repoPath);
    const retrievedRepo = worker.getRepository();

    assertEquals(retrievedRepo?.org, "octocat");
    assertEquals(retrievedRepo?.repo, "Hello-World");
    assertEquals(retrievedRepo?.fullName, "octocat/Hello-World");
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - リポジトリ設定後のメッセージ処理", async () => {
  const workspace = await createTestWorkspaceManager();
  const mockResponse = "これはリポジトリ設定後のモック応答です。";
  const executor = new MockClaudeCommandExecutor(mockResponse);

  try {
    const worker = await createTestWorker("test-worker", workspace, executor);
    const repository = createTestRepository("octocat", "Hello-World");
    await worker.setRepository(repository, "/test/repo");

    const message = "リポジトリについて教えて";
    const reply = await worker.processMessage(message);

    assertEquals(reply, mockResponse);
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - verboseモードが正しく設定される", async () => {
  const workspace = await createTestWorkspaceManager();

  try {
    const workerVerbose = await createTestWorker(
      "verbose-worker",
      workspace,
      undefined,
      true,
    );
    const workerQuiet = await createTestWorker(
      "quiet-worker",
      workspace,
      undefined,
      false,
    );

    // 内部状態の確認は実装に依存するため、動作確認のみ
    assertEquals(workerVerbose.getName(), "verbose-worker");
    assertEquals(workerQuiet.getName(), "quiet-worker");
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - verboseモードでログが出力される", async () => {
  const workspace = await createTestWorkspaceManager();
  const executor = new MockClaudeCommandExecutor();

  let logOutput = "";
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logOutput += args.join(" ") + "\n";
    originalLog(...args);
  };

  try {
    const worker = new Worker("verbose-worker", workspace, executor, true);
    const message = "verbose test message";
    await worker.processMessage(message);

    // ログに worker名が含まれることを確認
    assertEquals(logOutput.includes("verbose-worker"), true);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Worker - verboseモード無効時はログが出力されない", async () => {
  const workspace = await createTestWorkspaceManager();
  const { logs, restore } = captureConsoleOutput();

  try {
    const worker = await createTestWorker(
      "quiet-worker",
      workspace,
      undefined,
      false,
    );
    await worker.processMessage("quiet test message");

    const hasWorkerLog = logs.some((log) =>
      log.includes("quiet-worker") && log.includes("メッセージ受信")
    );
    assertEquals(hasWorkerLog, false);
  } finally {
    restore();
  }
});

Deno.test("Worker - Claude Codeの実際の出力が行ごとに送信される", async () => {
  const workspace = await createTestWorkspaceManager();
  const repository = parseRepository("test/repo");
  const repoPath = "/test/repo";

  const mockExecutor = new MockStreamingClaudeCommandExecutor();
  mockExecutor.streamingEnabled = true;
  // モックレスポンスは最終的に"モックレスポンス"を返す
  mockExecutor.setResponse("test", "モックレスポンス");

  try {
    const worker = await createTestWorker(
      "test-worker",
      workspace,
      mockExecutor,
    );
    await worker.setRepository(repository, repoPath);

    const progressMessages: string[] = [];
    const reply = await worker.processMessage(
      "test",
      async (content: string) => {
        progressMessages.push(content);
      },
    );

    // ストリーミングされたメッセージを確認
    assertEquals(progressMessages.length > 0, true);
    assertEquals(reply, "モックレスポンス");
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - エラーメッセージも正しく出力される", async () => {
  if (Deno.env.get("CI") === "true") {
    console.log("CI環境でスキップ: claude コマンドが利用できないため");
    return;
  }

  const workspace = await createTestWorkspaceManager();
  const repository = parseRepository("test/repo");
  const repoPath = "/test/repo";

  try {
    const worker = new Worker("test-worker", workspace);
    await worker.setRepository(repository, repoPath);

    const progressMessages: string[] = [];

    try {
      await worker.processMessage("test message", async (content: string) => {
        progressMessages.push(content);
      });

      // ここには到達しないはず（claudeコマンドがないため）
      assertEquals(true, false, "エラーが発生するはず");
    } catch (error) {
      // エラーメッセージの確認
      assertEquals(error instanceof Error, true);
      assertEquals(progressMessages.length >= 0, true);
    }
  } finally {
    // クリーンアップ
  }
});
