import { assertEquals } from "std/assert/mod.ts";
import { Worker } from "./worker.ts";
import { WorkerState, WorkspaceManager } from "./workspace.ts";
import { parseRepository } from "./git-utils.ts";
import { createMockClaudeCommandExecutor } from "../test/test-utils.ts";

Deno.test("Worker devcontainer機能のテスト", async (t) => {
  const tempDir = await Deno.makeTempDir();
  let workspaceManager: WorkspaceManager;
  let worker: Worker;

  try {
    workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const state: WorkerState = {
      workerName: "test-worker",
      threadId: "test-thread-123",
      devcontainerConfig: {
        useDevcontainer: false,
        useFallbackDevcontainer: false,
        hasDevcontainerFile: false,
        hasAnthropicsFeature: false,
        isStarted: false,
      },
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    worker = new Worker(
      state,
      workspaceManager,
      createMockClaudeCommandExecutor("Claude からのテスト応答"),
      undefined,
      undefined,
    );

    await t.step("devcontainerの使用設定", () => {
      assertEquals(worker.isUsingDevcontainer(), false);
      assertEquals(worker.isDevcontainerStarted(), false);

      worker.setUseDevcontainer(true);
      assertEquals(worker.isUsingDevcontainer(), true);
      assertEquals(worker.isDevcontainerStarted(), false);
    });

    await t.step("リポジトリ設定前のdevcontainer起動", async () => {
      const result = await worker.startDevcontainer();
      assertEquals(result.success, false);
      assertEquals(result.error, "リポジトリが設定されていません");
      assertEquals(worker.isDevcontainerStarted(), false);
    });

    await t.step("リポジトリ設定後のdevcontainer設定", async () => {
      const repository = parseRepository("test-org/test-repo");
      const mockLocalPath = tempDir; // テスト用にtempDirを使用

      await worker.setRepository(repository, mockLocalPath);

      // リポジトリが設定されたことを確認
      assertEquals(worker.getRepository()?.fullName, "test-org/test-repo");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DevcontainerClaudeExecutorのテスト", async (t) => {
  await t.step("execInDevcontainerの呼び出し", async () => {
    // DevcontainerClaudeExecutorは実際のdevcontainer環境が必要なため、
    // ここでは構造のテストのみ実行
    const { DevcontainerClaudeExecutor } = await import("./worker.ts");

    // プライベートクラスなので、テストは構造確認のみ
    // 実際の動作テストは統合テストで行う
    assertEquals(typeof DevcontainerClaudeExecutor, "function");
  });
});
