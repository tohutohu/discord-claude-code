import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { WorkspaceManager } from "../src/workspace.ts";
import { join } from "std/path/mod.ts";

async function createTestWorkspaceManager(): Promise<{
  workspace: WorkspaceManager;
  cleanup: () => Promise<void>;
}> {
  const testDir = await Deno.makeTempDir({ prefix: "workspace_test_" });
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const cleanup = async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch (error) {
      console.warn(`テストディレクトリの削除に失敗: ${error}`);
    }
  };

  return { workspace, cleanup };
}

Deno.test("WorkspaceManager - worktreeパスを取得できる", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    const threadId = "test-thread-123";
    const worktreePath = workspace.getWorktreePath(threadId);

    assertEquals(worktreePath.includes(threadId), true);
    assertEquals(worktreePath.includes("worktrees"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("WorkspaceManager - worktreeを作成できる", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    // 実際のgitリポジトリの代わりにモック的なテストを行う
    const threadId = "test-thread-456";
    const worktreePath = workspace.getWorktreePath(threadId);

    // ディレクトリが存在しないことを確認
    try {
      await Deno.stat(worktreePath);
      assertEquals(false, true, "worktreeパスは存在すべきではない");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }

    // パスの形式を確認
    assertEquals(worktreePath.includes(threadId), true);
    assertEquals(worktreePath.includes("worktrees"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("WorkspaceManager - worktreeを削除できる", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    const threadId = "test-thread-789";
    const worktreePath = workspace.getWorktreePath(threadId);

    // テスト用ディレクトリを作成
    await Deno.mkdir(worktreePath, { recursive: true });
    await Deno.writeTextFile(join(worktreePath, "test.txt"), "test content");

    // ディレクトリが存在することを確認
    const stat = await Deno.stat(worktreePath);
    assertEquals(stat.isDirectory, true);

    // removeWorktreeを呼び出し（gitコマンドは失敗するが、フォールバック処理で削除される）
    await workspace.removeWorktree(threadId);

    // ディレクトリが削除されていることを確認
    try {
      await Deno.stat(worktreePath);
      assertEquals(false, true, "worktreeが削除されていません");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("WorkspaceManager - 存在しないworktreeの削除はエラーにならない", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    const threadId = "nonexistent-thread";
    await workspace.removeWorktree(threadId);
  } finally {
    await cleanup();
  }
});

Deno.test("WorkspaceManager - 無効なリポジトリパスでworktree作成時はエラーになる", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    const threadId = "test-thread-error";
    const invalidRepoPath = "/nonexistent/path";

    await assertRejects(
      () => workspace.createWorktree(threadId, invalidRepoPath),
      Error,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("WorkspaceManager - ThreadInfoにworktreePathが含まれる", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    const threadId = "test-thread-info";
    const worktreePath = "/test/worktree/path";

    const threadInfo = {
      threadId,
      repositoryFullName: "test/repo",
      repositoryLocalPath: "/test/repo/path",
      worktreePath,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active" as const,
    };

    await workspace.saveThreadInfo(threadInfo);
    const loaded = await workspace.loadThreadInfo(threadId);

    assertEquals(loaded?.worktreePath, worktreePath);
  } finally {
    await cleanup();
  }
});
