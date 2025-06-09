import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { Admin } from "./admin.ts";
import { ClaudeCodeRateLimitError, IWorker } from "./worker.ts";
import { QueuedMessage, WorkspaceManager } from "./workspace.ts";
import { GitRepository } from "./git-utils.ts";

// テスト用の型定義
interface TestableAdmin {
  workers: Map<string, IWorker>;
  autoResumeTimers: Map<string, number>;
  executeAutoResume(threadId: string): Promise<void>;
}

async function createTestDir(): Promise<string> {
  const testDir = await Deno.makeTempDir({
    prefix: "admin_rate_limit_test_",
  });
  return testDir;
}

// モックWorkerクラス
class MockWorker implements IWorker {
  private name: string;
  private shouldThrowRateLimit = false;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  getRepository() {
    return null;
  }

  async setRepository(
    _repository: GitRepository,
    _localPath: string,
  ): Promise<void> {}

  setWorktreePath() {}

  setThreadId() {}

  setSessionId() {}

  setRateLimitBehavior(shouldThrow: boolean) {
    this.shouldThrowRateLimit = shouldThrow;
  }

  async processMessage(
    message: string,
    _onProgress?: (content: string) => Promise<void>,
    _onReaction?: (emoji: string) => Promise<void>,
  ): Promise<string> {
    if (this.shouldThrowRateLimit) {
      throw new ClaudeCodeRateLimitError(Math.floor(Date.now() / 1000));
    }
    return `処理済み: ${message}`;
  }

  async terminateDevcontainer(): Promise<void> {}

  async setDevcontainerChoice(): Promise<void> {}

  async waitForDevcontainerChoice(): Promise<void> {}

  isUsingDevcontainer(): boolean {
    return false;
  }
}

Deno.test("Admin - レートリミット時のメッセージキュー追加", async () => {
  const testDir = await createTestDir();
  try {
    const workspaceManager = new WorkspaceManager(testDir);
    await workspaceManager.initialize();

    const admin = new Admin(workspaceManager, undefined, undefined);
    const threadId = "test-thread-rate-limit";

    // スレッド情報を作成
    await workspaceManager.saveThreadInfo({
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    });

    // Worker状態を作成（レートリミット中）
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      status: "active",
      rateLimitTimestamp: Math.floor(Date.now() / 1000), // レートリミット中
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // レートリミット中のメッセージ送信
    const result = await admin.routeMessage(
      threadId,
      "テストメッセージ",
      undefined,
      undefined,
      "msg-123",
      "user-123",
    );

    assertEquals(
      result,
      "レートリミット中です。このメッセージは制限解除後に自動的に処理されます。",
    );

    // キューに追加されていることを確認
    const updatedWorkerState = await workspaceManager.loadWorkerState(threadId);
    assertExists(updatedWorkerState);
    assertExists(updatedWorkerState!.queuedMessages);
    assertEquals(updatedWorkerState!.queuedMessages!.length, 1);
    assertEquals(updatedWorkerState!.queuedMessages![0].messageId, "msg-123");
    assertEquals(
      updatedWorkerState!.queuedMessages![0].content,
      "テストメッセージ",
    );
    assertEquals(updatedWorkerState!.queuedMessages![0].authorId, "user-123");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("Admin - レートリミットエラー時の自動タイマー設定", async () => {
  const testDir = await createTestDir();
  try {
    const workspaceManager = new WorkspaceManager(testDir);
    await workspaceManager.initialize();

    const admin = new Admin(workspaceManager, undefined, undefined);
    const threadId = "test-thread-auto-timer";

    // モックWorkerを作成
    const mockWorker = new MockWorker("test-worker");
    mockWorker.setRateLimitBehavior(true);

    // Workerを直接設定（プライベートプロパティへのアクセス）
    const testableAdmin = admin as unknown as TestableAdmin;
    testableAdmin.workers.set(threadId, mockWorker);

    // スレッド情報を作成
    await workspaceManager.saveThreadInfo({
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    });

    // Worker状態も作成
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // レートリミットエラーを発生させる
    const result = await admin.routeMessage(threadId, "テスト");

    // レートリミットメッセージが返されることを確認
    assert(typeof result === "string");
    assert(result.includes("Claude Codeのレートリミットに達しました"));

    // Worker状態が更新されていることを確認
    const workerState = await workspaceManager.loadWorkerState(threadId);
    assertExists(workerState);
    assertExists(workerState!.rateLimitTimestamp);
    assertEquals(workerState!.autoResumeAfterRateLimit, true);

    // タイマーが設定されていることを確認
    const testableAdmin2 = admin as unknown as TestableAdmin;
    assert(testableAdmin2.autoResumeTimers.has(threadId));

    // タイマーをクリア
    const timerId = testableAdmin2.autoResumeTimers.get(threadId);
    if (timerId) {
      clearTimeout(timerId);
    }
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("Admin - 自動再開時のキュー処理", async () => {
  const testDir = await createTestDir();
  try {
    const workspaceManager = new WorkspaceManager(testDir);
    await workspaceManager.initialize();

    const admin = new Admin(workspaceManager, undefined, undefined);
    const threadId = "test-thread-auto-resume";

    // キューにメッセージを追加
    const queuedMessages: QueuedMessage[] = [
      {
        messageId: "msg-1",
        content: "最初のメッセージ",
        timestamp: Date.now(),
        authorId: "user-1",
      },
      {
        messageId: "msg-2",
        content: "二番目のメッセージ",
        timestamp: Date.now() + 1000,
        authorId: "user-2",
      },
    ];

    // Worker状態を作成する際にqueuedMessagesを含める（後で設定）

    // スレッド情報を作成
    await workspaceManager.saveThreadInfo({
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    });

    // Worker状態を作成（レートリミット中、自動再開有効）
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      status: "active",
      rateLimitTimestamp: Math.floor(Date.now() / 1000),
      autoResumeAfterRateLimit: true,
      queuedMessages: queuedMessages,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // 自動再開コールバックを設定
    let resumedThreadId: string | null = null;
    let resumedMessage: string | null = null;
    admin.setAutoResumeCallback(async (threadId, message) => {
      resumedThreadId = threadId;
      resumedMessage = message;
    });

    // executeAutoResumeを直接呼び出し（プライベートメソッドへのアクセス）
    const testableAdmin = admin as unknown as TestableAdmin;
    await testableAdmin.executeAutoResume(threadId);

    // コールバックが呼ばれたことを確認
    assertEquals(resumedThreadId, threadId);
    assertEquals(resumedMessage, "最初のメッセージ");

    // キューがクリアされていることを確認
    const workerState = await workspaceManager.loadWorkerState(threadId);
    assertExists(workerState);
    assertEquals(workerState!.queuedMessages?.length || 0, 0);
    assertEquals(workerState!.rateLimitTimestamp, undefined);
    assertEquals(workerState!.autoResumeAfterRateLimit, undefined);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("Admin - キューが空の場合は「続けて」を送信", async () => {
  const testDir = await createTestDir();
  try {
    const workspaceManager = new WorkspaceManager(testDir);
    await workspaceManager.initialize();

    const admin = new Admin(workspaceManager, undefined, undefined);
    const threadId = "test-thread-empty-queue";

    // スレッド情報を作成
    await workspaceManager.saveThreadInfo({
      threadId,
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
    });

    // Worker状態を作成（レートリミット中、自動再開有効、キューは空）
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      status: "active",
      rateLimitTimestamp: Math.floor(Date.now() / 1000),
      autoResumeAfterRateLimit: true,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // 自動再開コールバックを設定
    let resumedMessage: string | null = null;
    admin.setAutoResumeCallback(async (_threadId, message) => {
      resumedMessage = message;
    });

    // executeAutoResumeを直接呼び出し
    const testableAdmin = admin as unknown as TestableAdmin;
    await testableAdmin.executeAutoResume(threadId);

    // 「続けて」が送信されたことを確認
    assertEquals(resumedMessage, "続けて");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
