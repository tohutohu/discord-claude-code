import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Admin } from "../src/admin.ts";
import { WorkspaceManager } from "../src/workspace.ts";

async function createTestWorkspaceManager(): Promise<{
  workspace: WorkspaceManager;
  cleanup: () => Promise<void>;
}> {
  const testDir = await Deno.makeTempDir({ prefix: "persistence_test_" });
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

Deno.test("永続化統合テスト - スレッド作成から復旧まで完全なサイクル", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    // Phase 1: 初回起動とスレッド作成
    const adminState1 = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin1 = new Admin(adminState1, workspace, undefined, undefined);
    const threadId = "integration-test-thread";

    // Worker作成
    const worker1 = await admin1.createWorker(threadId);
    assertExists(worker1);

    // devcontainer設定を保存
    const devcontainerConfig = {
      useDevcontainer: true,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: true,
      containerId: "test-container-integration",
      isStarted: true,
    };
    await admin1.saveDevcontainerConfig(threadId, devcontainerConfig);

    // Admin状態を保存
    await admin1.save();

    // Phase 2: 再起動シミュレーション
    const adminState2 = await workspace.loadAdminState() || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin2 = new Admin(adminState2, workspace, undefined, undefined);

    // 復旧前はWorkerが存在しない
    assertEquals(admin2.getWorker(threadId), null);

    // アクティブスレッドを復旧
    await admin2.restoreActiveThreads();

    // Phase 3: 復旧後の確認
    const restoredWorker = admin2.getWorker(threadId);
    assertExists(restoredWorker);
    assertEquals(typeof restoredWorker.getName(), "string");

    // devcontainer設定が正しく復旧されている
    const restoredConfig = await admin2.getDevcontainerConfig(threadId);
    assertEquals(restoredConfig?.useDevcontainer, true);
    assertEquals(restoredConfig?.hasDevcontainerFile, true);
    assertEquals(restoredConfig?.hasAnthropicsFeature, true);
    assertEquals(restoredConfig?.containerId, "test-container-integration");
    assertEquals(restoredConfig?.isStarted, true);

    // ThreadInfo が正しく永続化されている
    const threadInfo = await workspace.loadThreadInfo(threadId);
    assertExists(threadInfo);
    assertEquals(threadInfo.status, "active");

    // Phase 4: スレッド終了
    await admin2.terminateThread(threadId);

    // スレッドが終了状態になっている
    assertEquals(admin2.getWorker(threadId), null);
    const terminatedThreadInfo = await workspace.loadThreadInfo(threadId);
    assertEquals(terminatedThreadInfo?.status, "archived");

    // Phase 5: 再度復旧を試行（アーカイブされたスレッドは復旧されない）
    const adminState3 = await workspace.loadAdminState() || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin3 = new Admin(adminState3, workspace, undefined, undefined);
    await admin3.restoreActiveThreads();
    assertEquals(admin3.getWorker(threadId), null);
  } finally {
    await cleanup();
  }
});

Deno.test("永続化統合テスト - 複数スレッドの管理と復旧", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    // Phase 1: 複数スレッドを作成
    const adminState1 = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin1 = new Admin(adminState1, workspace, undefined, undefined);
    const threadIds = ["thread-1", "thread-2", "thread-3"];

    for (const threadId of threadIds) {
      await admin1.createWorker(threadId);

      // 各スレッドに異なるdevcontainer設定
      const config = {
        useDevcontainer: threadId === "thread-1",
        hasDevcontainerFile: threadId !== "thread-3",
        hasAnthropicsFeature: threadId === "thread-1",
        containerId: threadId === "thread-1"
          ? `container-${threadId}`
          : undefined,
        isStarted: threadId === "thread-1",
      };
      await admin1.saveDevcontainerConfig(threadId, config);
    }

    // 1つのスレッドを終了
    await admin1.terminateThread("thread-2");

    // Admin状態を保存
    await admin1.save();

    // Phase 2: 再起動と復旧
    const adminState2 = await workspace.loadAdminState() || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin2 = new Admin(adminState2, workspace, undefined, undefined);
    await admin2.restoreActiveThreads();

    // Phase 3: 復旧結果確認
    // アクティブなスレッドのみ復旧される
    assertExists(admin2.getWorker("thread-1"));
    assertEquals(admin2.getWorker("thread-2"), null); // 終了済み
    assertExists(admin2.getWorker("thread-3"));

    // 各スレッドの設定が正しく復旧されている
    const config1 = await admin2.getDevcontainerConfig("thread-1");
    assertEquals(config1?.useDevcontainer, true);
    assertEquals(config1?.hasAnthropicsFeature, true);
    assertEquals(config1?.containerId, "container-thread-1");

    const config3 = await admin2.getDevcontainerConfig("thread-3");
    assertEquals(config3?.useDevcontainer, false);
    assertEquals(config3?.hasDevcontainerFile, false);
  } finally {
    await cleanup();
  }
});

Deno.test("永続化統合テスト - セッションログとワークスペース情報の整合性", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    // Phase 1: スレッド作成とセッションログ記録
    const adminState1 = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin1 = new Admin(adminState1, workspace, undefined, undefined);
    const threadId = "session-log-thread";

    await admin1.createWorker(threadId);

    // devcontainer設定を保存
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    };
    await admin1.saveDevcontainerConfig(threadId, config);

    // Phase 2: ワークスペース情報の確認
    const allThreadInfos = await workspace.getAllThreadInfos();
    const targetThread = allThreadInfos.find((t) => t.threadId === threadId);
    assertExists(targetThread);
    assertEquals(targetThread.status, "active");

    // Phase 3: 再起動と復旧
    const adminState2 = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin2 = new Admin(adminState2, workspace, undefined, undefined);
    await admin2.restoreActiveThreads();

    // 復旧後の設定確認
    const restoredConfig = await admin2.getDevcontainerConfig(threadId);
    assertEquals(restoredConfig?.useDevcontainer, false);

    // Phase 4: 設定変更と再保存
    const updatedConfig = {
      ...config,
      useDevcontainer: true,
      containerId: "new-container-123",
      isStarted: true,
    };
    await admin2.saveDevcontainerConfig(threadId, updatedConfig);

    // Admin状態を保存
    await admin2.save();

    // Phase 5: 再度復旧して変更が永続化されているか確認
    const adminState3 = await workspace.loadAdminState() || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin3 = new Admin(adminState3, workspace, undefined, undefined);
    await admin3.restoreActiveThreads();

    const finalConfig = await admin3.getDevcontainerConfig(threadId);
    assertEquals(finalConfig?.useDevcontainer, true);
    assertEquals(finalConfig?.containerId, "new-container-123");
    assertEquals(finalConfig?.isStarted, true);
  } finally {
    await cleanup();
  }
});

Deno.test("永続化統合テスト - エラー耐性と部分復旧", async () => {
  const { workspace, cleanup } = await createTestWorkspaceManager();

  try {
    // Phase 1: 正常なスレッドと問題のあるスレッドを混在させる
    const adminState1 = {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin1 = new Admin(adminState1, workspace, undefined, undefined);

    // 正常なスレッド
    const goodThreadId = "good-thread";
    await admin1.createWorker(goodThreadId);
    await admin1.saveDevcontainerConfig(goodThreadId, {
      useDevcontainer: false,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: true,
      isStarted: false,
    });

    // 問題のあるスレッド情報を直接作成
    const badThreadId = "bad-thread";
    const badThreadInfo = {
      threadId: badThreadId,
      repositoryFullName: "invalid/repo",
      repositoryLocalPath: "/nonexistent/path",
      worktreePath: "/nonexistent/worktree",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active" as const,
    };
    await workspace.saveThreadInfo(badThreadInfo);

    // アクティブスレッドリストに追加
    await workspace.addActiveThread(badThreadId);

    // Admin状態を保存する前に、最新のAdminStateを取得して保存
    const currentAdminState = await workspace.loadAdminState();
    if (currentAdminState) {
      await workspace.saveAdminState(currentAdminState);
    }

    // Phase 2: 復旧処理（エラーハンドリング）
    const adminState2 = await workspace.loadAdminState() || {
      activeThreadIds: [],
      lastUpdated: new Date().toISOString(),
    };
    const admin2 = new Admin(adminState2, workspace, undefined, undefined);

    // エラーログをキャプチャ
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const errorMessages: string[] = [];
    const warnMessages: string[] = [];

    console.error = (...args: unknown[]) => {
      errorMessages.push(args.join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.join(" "));
    };

    try {
      await admin2.restoreActiveThreads();

      // Phase 3: 部分復旧の確認
      // 正常なスレッドは復旧される
      const goodWorker = admin2.getWorker(goodThreadId);
      assertExists(goodWorker);

      // 問題のあるスレッドはworktreeが存在しないためアーカイブされ、Workerは作成されない
      const badWorker = admin2.getWorker(badThreadId);
      assertEquals(badWorker, null);

      // スレッドはアーカイブされている
      const badThreadInfo = await workspace.loadThreadInfo(badThreadId);
      assertEquals(badThreadInfo?.status, "archived");

      // エラーハンドリングが適切に動作していることを確認
      // 実際のエラーが発生するかは環境に依存するため、ここではWorkerの状態のみを確認
    } finally {
      // コンソールを元に戻す
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    }
  } finally {
    await cleanup();
  }
});
