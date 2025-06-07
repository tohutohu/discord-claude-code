import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Worker } from "../src/worker.ts";
import { parseRepository } from "../src/git-utils.ts";
import {
  captureConsoleOutput,
  createErrorMockClaudeCommandExecutor,
  createMockClaudeCommandExecutor,
  createMockStreamingClaudeCommandExecutor,
  createTestRepository,
  createTestWorker,
  createTestWorkspaceManager,
  ERROR_MESSAGES,
} from "./test-utils.ts";

Deno.test("Worker - メッセージを受け取って返信する（リポジトリ未設定）", async () => {
  const workspace = await createTestWorkspaceManager();
  const workerName = "happy-panda";
  const executor = createMockClaudeCommandExecutor();

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
  const executor = createMockClaudeCommandExecutor();

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

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

    await worker.setRepository(repository, repoPath);
    const retrievedRepo = worker.getRepository();

    assertEquals(retrievedRepo?.org, "octocat");
    assertEquals(retrievedRepo?.repo, "Hello-World");
    assertEquals(retrievedRepo?.fullName, "octocat/Hello-World");
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - 設定未完了時の定型メッセージ", async () => {
  const workspace = await createTestWorkspaceManager();
  const executor = createMockClaudeCommandExecutor();

  try {
    const worker = await createTestWorker("test-worker", workspace, executor);
    const repository = createTestRepository("octocat", "Hello-World");
    await worker.setRepository(repository, "/test/repo");

    // 設定が未完了の状態でメッセージを送信
    const message = "リポジトリについて教えて";
    const reply = await worker.processMessage(message);

    // 設定を促すメッセージが返されることを確認
    assertEquals(reply.includes("Claude Code実行環境の設定が必要です"), true);
    assertEquals(reply.includes("/config devcontainer"), true);
  } finally {
    // クリーンアップ
  }
});

Deno.test("Worker - リポジトリ設定後のメッセージ処理", async () => {
  const workspace = await createTestWorkspaceManager();
  const mockResponse = "これはリポジトリ設定後のモック応答です。";
  const executor = createMockClaudeCommandExecutor(mockResponse);

  try {
    const worker = await createTestWorker("test-worker", workspace, executor);
    const repository = createTestRepository("octocat", "Hello-World");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

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
  const executor = createMockClaudeCommandExecutor();

  let logOutput = "";
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logOutput += args.join(" ") + "\n";
    originalLog(...args);
  };

  try {
    const worker = new Worker("verbose-worker", workspace, executor, true, undefined);
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

  const mockExecutor = createMockStreamingClaudeCommandExecutor();
  // モックレスポンスは最終的に"モックレスポンス"を返す
  mockExecutor.setResponse("test", "モックレスポンス");

  try {
    const worker = await createTestWorker(
      "test-worker",
      workspace,
      mockExecutor,
    );

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

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
  const workspace = await createTestWorkspaceManager();
  const repository = parseRepository("test/repo");
  const repoPath = "/test/repo";
  const errorExecutor = createErrorMockClaudeCommandExecutor("モックエラー", 1);

  try {
    const worker = await createTestWorker(
      "test-worker",
      workspace,
      errorExecutor,
    );

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

    await worker.setRepository(repository, repoPath);

    const progressMessages: string[] = [];
    const reply = await worker.processMessage(
      "test message",
      async (content: string) => {
        progressMessages.push(content);
      },
    );

    // エラーメッセージが返されることを確認
    assertEquals(reply.includes("エラーが発生しました"), true);
    assertEquals(progressMessages.length > 0, true);
  } finally {
    // クリーンアップ
  }
});
