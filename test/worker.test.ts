import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ClaudeCommandExecutor, Worker } from "../src/worker.ts";
import { parseRepository } from "../src/git-utils.ts";

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
  const workerName = "happy-panda";
  const worker = new Worker(workerName);

  const message = "テストメッセージです";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
  );
});

Deno.test("Worker - 名前を取得できる", () => {
  const workerName = "clever-fox";
  const worker = new Worker(workerName);

  assertEquals(worker.getName(), workerName);
});

Deno.test("Worker - 空のメッセージも処理できる", async () => {
  const workerName = "gentle-bear";
  const worker = new Worker(workerName);

  const message = "";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
  );
});

Deno.test("Worker - リポジトリ情報を設定・取得できる", () => {
  const workerName = "smart-cat";
  const worker = new Worker(workerName);

  // 初期状態ではリポジトリは未設定
  assertEquals(worker.getRepository(), null);

  // リポジトリ情報を設定
  const repository = parseRepository("owner/repo");
  const localPath = "/tmp/owner/repo";
  worker.setRepository(repository, localPath);

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
  const worker = new Worker(workerName, mockExecutor);

  // リポジトリ情報を設定
  const repository = parseRepository("test-org/test-repo");
  const localPath = "/tmp/test-org/test-repo";
  worker.setRepository(repository, localPath);

  const message = "テストメッセージです";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    "テストメッセージに対するClaude応答です。",
  );
});
