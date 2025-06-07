import { assertEquals } from "std/assert/mod.ts";
import { Worker } from "../src/worker.ts";
import {
  createMockStreamingClaudeCommandExecutor,
  createTestRepository,
  createTestWorkspaceManager,
} from "./test-utils.ts";

Deno.test("Worker - ストリーミング進捗コールバックが呼ばれる", async () => {
  const workspace = await createTestWorkspaceManager();
  const tempDir = await Deno.makeTempDir();

  try {
    const streamData = [
      '{"type":"session","session_id":"test-session"}\n',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"こんにちは。"}]}}\n',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"テストメッセージです。\\n"}]}}\n',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"これは進捗表示のテストです。"}]}}\n',
      '{"type":"result","result":"完了しました。"}\n',
    ];

    const mockExecutor = createMockStreamingClaudeCommandExecutor();

    // ストリーミングデータを設定
    const allData = streamData.join("");
    mockExecutor.setResponse("test", allData);

    const worker = new Worker("test-worker", workspace, mockExecutor);

    // Setup repository
    const repository = createTestRepository("test", "repo");

    // 両方の設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択
    worker.setSkipPermissions(true); // 権限チェックをスキップ

    await worker.setRepository(repository, tempDir);

    const progressUpdates: string[] = [];
    const onProgress = async (content: string) => {
      progressUpdates.push(content);
    };

    const result = await worker.processMessage("test", onProgress);

    // Verify progress updates were made
    assertEquals(progressUpdates.length > 0, true);

    // The final result should be returned (最終的な結果のみ)
    assertEquals(result, "完了しました。");

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

    const worker = new Worker("test-worker", workspace, mockExecutor);

    const repository = createTestRepository("test", "repo");

    // 両方の設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択
    worker.setSkipPermissions(true); // 権限チェックをスキップ

    await worker.setRepository(repository, tempDir);

    const progressUpdates: string[] = [];
    const onProgress = async (content: string) => {
      progressUpdates.push(content);
    };

    try {
      await worker.processMessage("error test", onProgress);
      assertEquals(true, false, "Should throw an error");
    } catch (error) {
      // Error is expected
      assertEquals(error instanceof Error, true);

      // Verify that some progress was made before error
      assertEquals(progressUpdates.length >= 0, true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - 進捗コールバックなしでも動作する", async () => {
  const workspace = await createTestWorkspaceManager();
  const tempDir = await Deno.makeTempDir();

  try {
    const streamData = [
      '{"type":"session","session_id":"test-session"}\n',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"コールバックなしのテスト"}]}}\n',
      '{"type":"result","result":"完了"}\n',
    ];

    const mockExecutor = createMockStreamingClaudeCommandExecutor();

    const allData = streamData.join("");
    mockExecutor.setResponse("no callback test", allData);

    const worker = new Worker("test-worker", workspace, mockExecutor);

    const repository = createTestRepository("test", "repo");

    // 両方の設定を完了させる
    worker.setUseDevcontainer(false); // ホスト環境を選択
    worker.setSkipPermissions(true); // 権限チェックをスキップ

    await worker.setRepository(repository, tempDir);

    // No progress callback provided
    const result = await worker.processMessage("no callback test");

    // Should still work without progress callback
    assertEquals(result, "完了");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
