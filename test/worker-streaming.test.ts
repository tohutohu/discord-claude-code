import { assertEquals } from "std/assert/mod.ts";
import { Worker } from "../src/worker/worker.ts";
import {
  createMockStreamingClaudeCommandExecutor,
  createTestRepository,
  createTestWorkerState,
  createTestWorkspaceManager,
} from "./test-utils.ts";

Deno.test("Worker - ストリーミング進捗コールバックが呼ばれる", async () => {
  const workspace = await createTestWorkspaceManager();
  const tempDir = await Deno.makeTempDir();

  try {
    const streamData = [
      '{"type":"system","subtype":"init","session_id":"test-session","tools":["Read","Write"]}\n',
      '{"type":"assistant","message":{"id":"msg_001","type":"message","role":"assistant","model":"claude-3-opus","content":[{"type":"text","text":"こんにちは。"}],"stop_reason":"end_turn"},"session_id":"test-session"}\n',
      '{"type":"assistant","message":{"id":"msg_002","type":"message","role":"assistant","model":"claude-3-opus","content":[{"type":"text","text":"テストメッセージです。\\n"}],"stop_reason":"end_turn"},"session_id":"test-session"}\n',
      '{"type":"assistant","message":{"id":"msg_003","type":"message","role":"assistant","model":"claude-3-opus","content":[{"type":"text","text":"これは進捗表示のテストです。"}],"stop_reason":"end_turn"},"session_id":"test-session"}\n',
      '{"type":"result","subtype":"success","is_error":false,"result":"完了しました。","session_id":"test-session"}\n',
    ];

    const mockExecutor = createMockStreamingClaudeCommandExecutor();

    // ストリーミングデータを設定
    const allData = streamData.join("");
    mockExecutor.setResponse("test", allData);

    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new Worker(
      state,
      workspace,
      mockExecutor,
      undefined,
      undefined,
    );

    // Setup repository
    const repository = createTestRepository("test", "repo");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

    await worker.setRepository(repository, tempDir);

    const progressUpdates: string[] = [];
    const onProgress = async (content: string) => {
      progressUpdates.push(content);
    };

    const result = await worker.processMessage("test", onProgress);

    // Verify progress updates were made
    assertEquals(progressUpdates.length > 0, true);

    // The final result should be returned (最終的な結果のみ)
    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(result.value, "完了しました。");
    }

    // Verify some progress messages
    const hasWelcomeMessage = progressUpdates.some((msg) =>
      msg.includes("こんにちは")
    );
    assertEquals(hasWelcomeMessage, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - エラー時のストリーミング処理", async () => {
  const workspace = await createTestWorkspaceManager();
  const tempDir = await Deno.makeTempDir();

  try {
    const streamData = [
      '{"type":"session","session_id":"test-session"}\n',
      '{"type":"error","error":"エラーが発生しました"}\n',
    ];

    const mockExecutor = createMockStreamingClaudeCommandExecutor();

    // エラーを返すように設定
    const allData = streamData.join("");
    mockExecutor.setResponse("error test", allData);

    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new Worker(
      state,
      workspace,
      mockExecutor,
      undefined,
      undefined,
    );

    const repository = createTestRepository("test", "repo");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

    await worker.setRepository(repository, tempDir);

    const progressUpdates: string[] = [];
    const onProgress = async (content: string) => {
      progressUpdates.push(content);
    };

    const result = await worker.processMessage("error test", onProgress);

    // JSONエラーレスポンスは正常に処理され、エラーメッセージとして返される
    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(
        result.value,
        "Claude からの応答を取得できませんでした。",
      );
    }

    // Verify that some progress was made before error
    assertEquals(progressUpdates.length > 0, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - 進捗コールバックなしでも動作する", async () => {
  const workspace = await createTestWorkspaceManager();
  const tempDir = await Deno.makeTempDir();

  try {
    const streamData = [
      '{"type":"system","subtype":"init","session_id":"test-session","tools":[]}\n',
      '{"type":"assistant","message":{"id":"msg_001","type":"message","role":"assistant","model":"claude-3-opus","content":[{"type":"text","text":"コールバックなしのテスト"}],"stop_reason":"end_turn"},"session_id":"test-session"}\n',
      '{"type":"result","subtype":"success","is_error":false,"result":"完了","session_id":"test-session"}\n',
    ];

    const mockExecutor = createMockStreamingClaudeCommandExecutor();

    const allData = streamData.join("");
    mockExecutor.setResponse("no callback test", allData);

    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new Worker(
      state,
      workspace,
      mockExecutor,
      undefined,
      undefined,
    );

    const repository = createTestRepository("test", "repo");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択

    await worker.setRepository(repository, tempDir);

    // No progress callback provided
    const result = await worker.processMessage("no callback test");

    // Should still work without progress callback
    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(result.value, "完了");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
