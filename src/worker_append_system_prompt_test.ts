import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { ClaudeCommandExecutor, Worker } from "./worker.ts";
import { WorkspaceManager } from "./workspace.ts";
import { parseRepository } from "./git-utils.ts";

class MockClaudeExecutor implements ClaudeCommandExecutor {
  capturedArgs: string[] = [];

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    this.capturedArgs = args;
    console.log("MockExecutor called with args:", args);

    // Claude実行時のエラーを防ぐため、verboseがない場合はエラーを返す
    const hasVerbose = args.includes("--verbose");
    const hasStreamJson = args.includes("--output-format") &&
      args[args.indexOf("--output-format") + 1] === "stream-json";
    const hasPrint = args.includes("-p");

    if (hasPrint && hasStreamJson && !hasVerbose) {
      const errorMessage =
        "Error: When using --print, --output-format=stream-json requires --verbose\n";
      return {
        code: 1,
        stderr: new TextEncoder().encode(errorMessage),
      };
    }

    // Mock response - 最初にsessionメッセージを送信
    const sessionMessage = JSON.stringify({
      type: "session",
      session_id: "test-session-id",
    }) + "\n";
    onData(new TextEncoder().encode(sessionMessage));

    // その後resultメッセージを送信
    const mockResponse = JSON.stringify({
      type: "result",
      result: "テスト応答",
    }) + "\n";
    onData(new TextEncoder().encode(mockResponse));

    return { code: 0, stderr: new Uint8Array() };
  }
}

describe("Worker --append-system-prompt オプション", () => {
  it("appendSystemPromptが設定されている場合、コマンドに含まれる", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const workspaceManager = new WorkspaceManager(tempDir);
      await workspaceManager.initialize();

      const mockExecutor = new MockClaudeExecutor();
      const appendPrompt = "追加のシステムプロンプトです";

      // Gitリポジトリを作成
      const repoPath = await Deno.makeTempDir();
      const gitInit = new Deno.Command("git", {
        args: ["init"],
        cwd: repoPath,
      });
      await gitInit.output();

      try {
        // Workerを作成（コンストラクタでmockExecutorを渡す）
        const worker = new Worker(
          "test-worker",
          workspaceManager,
          mockExecutor,
          true, // verboseをtrueに設定
          appendPrompt,
        );

        // threadIdを設定してからリポジトリを設定
        worker.setThreadId("test-thread-1");

        const repository = parseRepository("test/repo");
        if (repository) {
          await worker.setRepository(repository, repoPath);
        }

        // devcontainer設定を完了させる（executorを保持したまま）
        // まずdevcontainerChoiceMadeをtrueにする最小限の実装
        // Worker内部でprivateなdevcontainerChoiceMadeにアクセスできないため、
        // setUseDevcontainerを呼ぶが、その後executorを復元する
        const savedExecutor = mockExecutor;
        worker.setUseDevcontainer(false);
        // executorを復元（TypeScriptの制限を回避）
        Object.defineProperty(worker, "claudeExecutor", {
          value: savedExecutor,
          writable: true,
          configurable: true,
        });

        const result = await worker.processMessage("テストメッセージ");
        console.log("processMessage result:", result);

        // デバッグ: 受け取った引数を確認
        console.log("Captured args:", mockExecutor.capturedArgs);

        // コマンドラインに --append-system-prompt が含まれることを確認
        const appendIndex = mockExecutor.capturedArgs.indexOf(
          "--append-system-prompt",
        );
        assertEquals(appendIndex !== -1, true);

        // 次の引数が追加プロンプトであることを確認
        if (appendIndex !== -1) {
          assertEquals(
            mockExecutor.capturedArgs[appendIndex + 1],
            appendPrompt,
          );
        }
      } finally {
        await Deno.remove(repoPath, { recursive: true });
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("appendSystemPromptが未設定の場合、コマンドに含まれない", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const workspaceManager = new WorkspaceManager(tempDir);
      await workspaceManager.initialize();

      const mockExecutor = new MockClaudeExecutor();

      // Gitリポジトリを作成
      const repoPath = await Deno.makeTempDir();
      const gitInit = new Deno.Command("git", {
        args: ["init"],
        cwd: repoPath,
      });
      await gitInit.output();

      try {
        // Workerを作成（コンストラクタでmockExecutorを渡す）
        const worker = new Worker(
          "test-worker",
          workspaceManager,
          mockExecutor,
          true, // verboseをtrueに設定
          undefined, // appendSystemPrompt未設定
        );

        // threadIdを設定してからリポジトリを設定
        worker.setThreadId("test-thread-2");

        const repository = parseRepository("test/repo");
        if (repository) {
          await worker.setRepository(repository, repoPath);
        }

        // devcontainer設定を完了させる（executorを保持したまま）
        const savedExecutor = mockExecutor;
        worker.setUseDevcontainer(false);
        // executorを復元
        Object.defineProperty(worker, "claudeExecutor", {
          value: savedExecutor,
          writable: true,
          configurable: true,
        });

        await worker.processMessage("テストメッセージ");

        // コマンドラインに --append-system-prompt が含まれないことを確認
        const appendIndex = mockExecutor.capturedArgs.indexOf(
          "--append-system-prompt",
        );
        assertEquals(appendIndex, -1);
      } finally {
        await Deno.remove(repoPath, { recursive: true });
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
