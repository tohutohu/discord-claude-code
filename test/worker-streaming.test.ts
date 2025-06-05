import { assertEquals } from "std/assert/mod.ts";
import { ClaudeCommandExecutor, Worker } from "../src/worker.ts";
import { WorkspaceManager } from "../src/workspace.ts";

/**
 * Mock ClaudeCommandExecutor for streaming tests
 */
class MockStreamingClaudeExecutor implements ClaudeCommandExecutor {
  private streamData: string[];
  private exitCode: number;
  private stderr: Uint8Array;

  constructor(
    streamData: string[],
    exitCode: number = 0,
    stderr: string = "",
  ) {
    this.streamData = streamData;
    this.exitCode = exitCode;
    this.stderr = new TextEncoder().encode(stderr);
  }

  async execute(
    _args: string[],
    _cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const allData = this.streamData.join("");
    return {
      code: this.exitCode,
      stdout: new TextEncoder().encode(allData),
      stderr: this.stderr,
    };
  }

  async executeStreaming(
    _args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // Simulate streaming data
    for (const chunk of this.streamData) {
      onData(new TextEncoder().encode(chunk));
      // Simulate delay between chunks
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return {
      code: this.exitCode,
      stderr: this.stderr,
    };
  }
}

Deno.test("Worker - ストリーミング進捗コールバックが呼ばれる", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const streamData = [
    '{"type":"session","session_id":"test-session"}\n',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"こんにちは。"}]}}\n',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"テストメッセージです。\\n"}]}}\n',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"これは進捗表示のテストです。"}]}}\n',
    '{"type":"result","result":"完了しました。"}\n',
  ];

  const mockExecutor = new MockStreamingClaudeExecutor(streamData);
  const worker = new Worker("test-worker", workspaceManager, mockExecutor);

  // Setup repository
  await worker.setRepository(
    { org: "test", repo: "repo", fullName: "test/repo", localPath: tempDir },
    tempDir,
  );

  const progressUpdates: string[] = [];
  const onProgress = async (content: string) => {
    progressUpdates.push(content);
  };

  const result = await worker.processMessage("テストメッセージ", onProgress);

  // 最終結果が正しいか確認
  assertEquals(result, "完了しました。");

  // 進捗更新が呼ばれたか確認（タイミングによるが、少なくとも開始メッセージは表示されるはず）
  assertEquals(progressUpdates.length > 0, true);
  assertEquals(progressUpdates[0], "🤖 Claudeが考えています...");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("Worker - エラー時のストリーミング処理", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const mockExecutor = new MockStreamingClaudeExecutor(
    [],
    1, // Error exit code
    "Command failed",
  );
  const worker = new Worker("test-worker", workspaceManager, mockExecutor);

  // Setup repository
  await worker.setRepository(
    { org: "test", repo: "repo", fullName: "test/repo", localPath: tempDir },
    tempDir,
  );

  const progressUpdates: string[] = [];
  const onProgress = async (content: string) => {
    progressUpdates.push(content);
  };

  const result = await worker.processMessage("テストメッセージ", onProgress);

  // エラーメッセージが返される
  assertEquals(result.includes("エラーが発生しました"), true);
  assertEquals(result.includes("Command failed"), true);

  // 進捗更新で開始メッセージは表示される
  assertEquals(progressUpdates.length > 0, true);
  assertEquals(progressUpdates[0], "🤖 Claudeが考えています...");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("Worker - 進捗コールバックなしでも動作する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const streamData = [
    '{"type":"result","result":"進捗なしの結果"}\n',
  ];

  const mockExecutor = new MockStreamingClaudeExecutor(streamData);
  const worker = new Worker("test-worker", workspaceManager, mockExecutor);

  // Setup repository
  await worker.setRepository(
    { org: "test", repo: "repo", fullName: "test/repo", localPath: tempDir },
    tempDir,
  );

  // 進捗コールバックなしで呼び出し
  const result = await worker.processMessage("テストメッセージ");

  assertEquals(result, "進捗なしの結果");

  await Deno.remove(tempDir, { recursive: true });
});
