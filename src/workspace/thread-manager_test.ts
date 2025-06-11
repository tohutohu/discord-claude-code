import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { ThreadManager } from "./thread-manager.ts";
import type { ThreadInfo } from "../workspace.ts";

Deno.test("ThreadManager - スレッド情報の保存と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadInfo: ThreadInfo = {
      threadId: "test-thread-123",
      repositoryFullName: "test-org/test-repo",
      repositoryLocalPath: "/path/to/repo",
      worktreePath: "/path/to/worktree",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    };

    const saveResult = await manager.saveThreadInfo(threadInfo);
    assertEquals(saveResult.isOk(), true);

    const loadResult = await manager.loadThreadInfo(threadInfo.threadId);
    assertEquals(loadResult.isOk(), true);
    assertEquals(loadResult._unsafeUnwrap(), threadInfo);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - 存在しないスレッド情報の読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const loadResult = await manager.loadThreadInfo("non-existent");
    assertEquals(loadResult.isOk(), true);
    assertEquals(loadResult._unsafeUnwrap(), null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - 最終アクティブ時刻の更新", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadInfo: ThreadInfo = {
      threadId: "test-thread-456",
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: "2024-01-01T00:00:00Z",
      lastActiveAt: "2024-01-01T00:00:00Z",
      status: "active",
    };

    const saveResult = await manager.saveThreadInfo(threadInfo);
    assertEquals(saveResult.isOk(), true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const updateResult = await manager.updateThreadLastActive(
      threadInfo.threadId,
    );
    assertEquals(updateResult.isOk(), true);

    const loadResult = await manager.loadThreadInfo(threadInfo.threadId);
    assertEquals(loadResult.isOk(), true);

    const updated = loadResult._unsafeUnwrap();
    assertExists(updated);
    assertEquals(updated.threadId, threadInfo.threadId);
    assertEquals(updated.createdAt, threadInfo.createdAt);
    // lastActiveAtは更新されているはず
    assertEquals(updated.lastActiveAt > threadInfo.lastActiveAt, true);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - すべてのスレッド情報の取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadInfos: ThreadInfo[] = [
      {
        threadId: "thread-1",
        repositoryFullName: "org/repo1",
        repositoryLocalPath: "/path/to/repo1",
        worktreePath: null,
        createdAt: "2024-01-01T00:00:00Z",
        lastActiveAt: "2024-01-01T12:00:00Z",
        status: "active",
      },
      {
        threadId: "thread-2",
        repositoryFullName: "org/repo2",
        repositoryLocalPath: "/path/to/repo2",
        worktreePath: null,
        createdAt: "2024-01-01T00:00:00Z",
        lastActiveAt: "2024-01-01T13:00:00Z",
        status: "inactive",
      },
      {
        threadId: "thread-3",
        repositoryFullName: "org/repo3",
        repositoryLocalPath: "/path/to/repo3",
        worktreePath: null,
        createdAt: "2024-01-01T00:00:00Z",
        lastActiveAt: "2024-01-01T11:00:00Z",
        status: "archived",
      },
    ];

    for (const info of threadInfos) {
      const saveResult = await manager.saveThreadInfo(info);
      assertEquals(saveResult.isOk(), true);
    }

    const getAllResult = await manager.getAllThreadInfos();
    assertEquals(getAllResult.isOk(), true);

    const all = getAllResult._unsafeUnwrap();
    assertEquals(all.length, 3);
    // 最新のlastActiveAtが最初に来る
    assertEquals(all[0].threadId, "thread-2");
    assertEquals(all[1].threadId, "thread-1");
    assertEquals(all[2].threadId, "thread-3");
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - ディレクトリが存在しない場合の getAllThreadInfos", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    // initializeを呼ばずに getAllThreadInfos を呼ぶ

    const getAllResult = await manager.getAllThreadInfos();
    assertEquals(getAllResult.isOk(), true);
    assertEquals(getAllResult._unsafeUnwrap(), []);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - worktreeパスの取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const worktreePath = manager.getWorktreePath("test-thread");
    assertEquals(worktreePath.endsWith("worktrees/test-thread"), true);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - worktreeのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const threadId = "test-thread";
    const worktreePath = manager.getWorktreePath(threadId);
    await ensureDir(worktreePath);

    // worktreeが存在することを確認
    const statBefore = await Deno.stat(worktreePath);
    assertEquals(statBefore.isDirectory, true);

    // クリーンアップ
    const cleanupResult = await manager.cleanupWorktree(threadId);
    assertEquals(cleanupResult.isOk(), true);

    // worktreeが削除されたことを確認
    let exists = true;
    try {
      await Deno.stat(worktreePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        exists = false;
      }
    }
    assertEquals(exists, false);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("ThreadManager - 存在しないworktreeのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new ThreadManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    // 存在しないworktreeをクリーンアップしてもエラーにならない
    const cleanupResult = await manager.cleanupWorktree("non-existent-thread");
    assertEquals(cleanupResult.isOk(), true);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
