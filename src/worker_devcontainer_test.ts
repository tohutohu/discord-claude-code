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
      threadId: "1234567890123456789", // Discord形式のスレッドID
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
      const repositoryResult = parseRepository("test-org/test-repo");
      if (repositoryResult.isErr()) {
        throw new Error("Failed to parse repository");
      }
      const repository = repositoryResult.value;
      const mockLocalPath = tempDir; // テスト用にtempDirを使用

      await worker.setRepository(repository, mockLocalPath);

      // リポジトリが設定されたことを確認
      assertEquals(worker.getRepository()?.fullName, "test-org/test-repo");
    });

    await t.step("updateClaudeExecutorForDevcontainerのテスト", async () => {
      // devcontainerが無効な場合は何もしない
      worker.setUseDevcontainer(false);
      await worker.updateClaudeExecutorForDevcontainer();
      assertEquals(worker.isDevcontainerStarted(), false);

      // devcontainerを有効にしてworktreePathを設定
      worker.setUseDevcontainer(true);
      // worktreePathを設定するために、setRepositoryを使う
      const repository = parseRepository("test-org/test-repo");
      const worktreePath = await Deno.makeTempDir();
      try {
        await worker.setRepository(repository, worktreePath);

        // updateClaudeExecutorForDevcontainerを呼び出す
        await worker.updateClaudeExecutorForDevcontainer();

        // devcontainerが起動済みとしてマークされていることを確認
        assertEquals(worker.isDevcontainerStarted(), true);

        // Worker状態が保存されていることを確認
        const savedState = await workspaceManager.loadWorkerState(
          "1234567890123456789",
        );
        assertEquals(savedState?.devcontainerConfig.isStarted, true);
      } finally {
        await Deno.remove(worktreePath, { recursive: true });
      }
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
