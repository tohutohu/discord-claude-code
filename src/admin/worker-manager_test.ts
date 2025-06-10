import { assertEquals, assertExists } from "std/assert/mod.ts";
import { WorkerManager } from "./worker-manager.ts";
import { WorkspaceManager } from "../workspace.ts";

Deno.test("WorkerManager - Workerの作成と取得", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const threadId = "test-thread-1";

    // Workerを作成
    const worker = await workerManager.createWorker(threadId);
    assertExists(worker);
    assertEquals(typeof worker.getName(), "string");

    // 同じthreadIdで再度作成すると同じWorkerが返される
    const sameWorker = await workerManager.createWorker(threadId);
    assertEquals(worker.getName(), sameWorker.getName());

    // Workerを取得
    const retrievedWorker = workerManager.getWorker(threadId);
    assertExists(retrievedWorker);
    assertEquals(worker.getName(), retrievedWorker?.getName());

    // Worker数の確認
    assertEquals(workerManager.getWorkerCount(), 1);

    // ThreadInfoが保存されていることを確認
    const threadInfo = await workspaceManager.loadThreadInfo(threadId);
    assertExists(threadInfo);
    assertEquals(threadInfo?.threadId, threadId);
    assertEquals(threadInfo?.status, "active");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("WorkerManager - Workerの削除", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);
    const threadId = "test-thread-2";

    // Workerを作成
    await workerManager.createWorker(threadId);
    assertEquals(workerManager.getWorkerCount(), 1);

    // Workerを削除
    const removedWorker = workerManager.removeWorker(threadId);
    assertExists(removedWorker);
    assertEquals(workerManager.getWorkerCount(), 0);

    // 削除後は取得できない
    const notFound = workerManager.getWorker(threadId);
    assertEquals(notFound, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("WorkerManager - 存在しないWorkerの削除", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const workerManager = new WorkerManager(workspaceManager);

    // 存在しないWorkerを削除
    const result = workerManager.removeWorker("non-existent");
    assertEquals(result, null);
    assertEquals(workerManager.getWorkerCount(), 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
