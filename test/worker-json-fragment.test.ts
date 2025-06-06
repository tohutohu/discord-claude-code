import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Worker } from "../src/worker.ts";
import { WorkspaceManager } from "../src/workspace.ts";
import { ClaudeCommandExecutor } from "../src/worker.ts";

// 不完全なJSON断片を送信するモック
class JsonFragmentStreamExecutor implements ClaudeCommandExecutor {
  async executeStreaming(
    _args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const encoder = new TextEncoder();

    // 完全なJSON
    onData(encoder.encode('{"type":"session","session_id":"test-session"}\n'));

    // 部分的なJSON（改行で終わるがJSON解析エラーになる）
    onData(
      encoder.encode(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"これは\n',
      ),
    );
    onData(encoder.encode('長いテキストです"}]}}\n'));

    // 通常のエラーメッセージ（JSONではない）
    onData(encoder.encode("Error: This is a normal error message\n"));

    // 最終結果
    onData(encoder.encode('{"type":"result","result":"完了"}\n'));

    return { code: 0, stderr: new Uint8Array() };
  }
}

Deno.test("JSON断片が長大なログ行で投稿されない", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new JsonFragmentStreamExecutor();
    const worker = new Worker("test-worker", workspaceManager, mockExecutor);
    worker.setThreadId("test-thread");
    await worker.setRepository(
      { org: "test", repo: "repo", fullName: "test/repo", localPath: tempDir },
      tempDir,
    );

    const progressMessages: string[] = [];
    await worker.processMessage(
      "テストメッセージ",
      async (content) => {
        progressMessages.push(content);
      },
    );

    // JSON断片が投稿されていないことを確認
    for (const message of progressMessages) {
      assertEquals(
        message.includes(
          '{"type":"assistant","message":{"content":[{"type":"text","text":"これは',
        ),
        false,
        "不完全なJSON断片が投稿されています",
      );
    }

    // 通常のエラーメッセージは投稿されることを確認
    const hasErrorMessage = progressMessages.some((msg) =>
      msg.includes("Error: This is a normal error message")
    );
    assertEquals(
      hasErrorMessage,
      true,
      "通常のエラーメッセージが投稿されていません",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// 長大な一行JSONのテスト
class SingleLineLongJsonExecutor implements ClaudeCommandExecutor {
  async executeStreaming(
    _args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const encoder = new TextEncoder();

    // 非常に長い一行のJSON（10MB以上）
    const longText = "A".repeat(10 * 1024 * 1024); // 10MB
    const longJson =
      `{"type":"assistant","message":{"content":[{"type":"text","text":"${longText}"}]}}\n`;

    // チャンクに分けて送信
    const chunkSize = 1024 * 1024; // 1MB chunks
    for (let i = 0; i < longJson.length; i += chunkSize) {
      onData(
        encoder.encode(
          longJson.slice(i, Math.min(i + chunkSize, longJson.length)),
        ),
      );
    }

    onData(encoder.encode('{"type":"result","result":"完了"}\n'));

    return { code: 0, stderr: new Uint8Array() };
  }
}

Deno.test("非常に長い一行JSONが正しく処理される", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new SingleLineLongJsonExecutor();
    const worker = new Worker("test-worker", workspaceManager, mockExecutor);
    worker.setThreadId("test-thread");
    await worker.setRepository(
      { org: "test", repo: "repo", fullName: "test/repo", localPath: tempDir },
      tempDir,
    );

    const progressMessages: string[] = [];
    const result = await worker.processMessage(
      "テストメッセージ",
      async (content) => {
        progressMessages.push(content);
      },
    );

    // 長いテキストが正しく処理されていることを確認
    const hasLongText = progressMessages.some((msg) => msg.includes("AAAA"));
    assertEquals(hasLongText, true, "長いテキストが処理されていません");

    // 結果が正しく取得できていることを確認
    assertEquals(result, "完了");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
