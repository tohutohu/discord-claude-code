import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import {
  AuditEntry,
  SessionLog,
  ThreadInfo,
  WorkspaceManager,
} from "../src/workspace.ts";

const testDir = await Deno.makeTempDir({ prefix: "workspace_test_" });

Deno.test("WorkspaceManagerを初期化できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  // ディレクトリが作成されているかチェック
  const stat = await Deno.stat(workspace.getRepositoriesDir());
  assertEquals(stat.isDirectory, true);
});

Deno.test("スレッド情報を保存・読み込みできる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const threadInfo: ThreadInfo = {
    threadId: "test-thread-001",
    repositoryFullName: "owner/repo",
    repositoryLocalPath: "/path/to/repo",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T01:00:00.000Z",
    status: "active",
  };

  // 保存
  await workspace.saveThreadInfo(threadInfo);

  // 読み込み
  const loaded = await workspace.loadThreadInfo("test-thread-001");
  assertExists(loaded);
  assertEquals(loaded.threadId, threadInfo.threadId);
  assertEquals(loaded.repositoryFullName, threadInfo.repositoryFullName);
  assertEquals(loaded.status, threadInfo.status);
});

Deno.test("存在しないスレッド情報を読み込むとnullが返る", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const loaded = await workspace.loadThreadInfo("non-existent");
  assertEquals(loaded, null);
});

Deno.test("スレッドの最終アクティブ時刻を更新できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const threadInfo: ThreadInfo = {
    threadId: "test-thread-002",
    repositoryFullName: null,
    repositoryLocalPath: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T00:00:00.000Z",
    status: "active",
  };

  await workspace.saveThreadInfo(threadInfo);

  // 時間を少し待って更新
  await new Promise((resolve) => setTimeout(resolve, 10));
  await workspace.updateThreadLastActive("test-thread-002");

  const updated = await workspace.loadThreadInfo("test-thread-002");
  assertExists(updated);
  assertEquals(updated.lastActiveAt !== threadInfo.lastActiveAt, true);
});

Deno.test("セッションログを保存・読み込みできる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const sessionLog: SessionLog = {
    sessionId: "session-001",
    threadId: "thread-001",
    timestamp: "2024-01-01T00:00:00.000Z",
    type: "command",
    content: "テストコマンド",
    metadata: { test: true },
  };

  // 保存
  await workspace.saveSessionLog(sessionLog);

  // 読み込み
  const logs = await workspace.loadSessionLogs("thread-001");
  assertEquals(logs.length, 1);
  assertEquals(logs[0].sessionId, sessionLog.sessionId);
  assertEquals(logs[0].type, sessionLog.type);
  assertEquals(logs[0].content, sessionLog.content);
});

Deno.test("複数のセッションログを時系列順で読み込める", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const logs = [
    {
      sessionId: "session-002",
      threadId: "thread-002",
      timestamp: "2024-01-01T02:00:00.000Z",
      type: "response" as const,
      content: "レスポンス2",
    },
    {
      sessionId: "session-001",
      threadId: "thread-002",
      timestamp: "2024-01-01T01:00:00.000Z",
      type: "command" as const,
      content: "コマンド1",
    },
    {
      sessionId: "session-003",
      threadId: "thread-002",
      timestamp: "2024-01-01T03:00:00.000Z",
      type: "error" as const,
      content: "エラー3",
    },
  ];

  // 順序をわざと入れ替えて保存
  for (const log of logs) {
    await workspace.saveSessionLog(log);
  }

  // 読み込み（時系列順になっているかチェック）
  const loaded = await workspace.loadSessionLogs("thread-002");
  assertEquals(loaded.length, 3);
  assertEquals(loaded[0].content, "コマンド1");
  assertEquals(loaded[1].content, "レスポンス2");
  assertEquals(loaded[2].content, "エラー3");
});

Deno.test("監査ログを追記できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const auditEntry: AuditEntry = {
    timestamp: "2024-01-01T00:00:00.000Z",
    threadId: "thread-audit",
    action: "test_action",
    details: { test: "data" },
  };

  // 監査ログを追記
  await workspace.appendAuditLog(auditEntry);

  // ファイルが作成されているかチェック（実際の日付を使用）
  const actualDate = new Date().toISOString().split("T")[0];
  const auditFilePath = join(testDir, "audit", actualDate, "activity.jsonl");
  const content = await Deno.readTextFile(auditFilePath);

  const lines = content.trim().split("\n");
  assertEquals(lines.length, 1);

  const parsed = JSON.parse(lines[0]);
  assertEquals(parsed.threadId, auditEntry.threadId);
  assertEquals(parsed.action, auditEntry.action);
});

Deno.test("リポジトリパスを正しく生成できる", async () => {
  const workspace = new WorkspaceManager(testDir);

  const repoPath = workspace.getRepositoryPath("owner", "repo");
  const expected = join(testDir, "repositories", "owner", "repo");
  assertEquals(repoPath, expected);
});

Deno.test("すべてのスレッド情報を最終アクティブ時刻順で取得できる", async () => {
  // 独立したテストディレクトリを使用
  const uniqueTestDir = await Deno.makeTempDir({
    prefix: "workspace_test_unique_",
  });
  const workspace = new WorkspaceManager(uniqueTestDir);
  await workspace.initialize();

  const threads: ThreadInfo[] = [
    {
      threadId: "thread-old",
      repositoryFullName: null,
      repositoryLocalPath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T01:00:00.000Z",
      status: "inactive",
    },
    {
      threadId: "thread-new",
      repositoryFullName: null,
      repositoryLocalPath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T03:00:00.000Z",
      status: "active",
    },
    {
      threadId: "thread-mid",
      repositoryFullName: null,
      repositoryLocalPath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T02:00:00.000Z",
      status: "active",
    },
  ];

  // 順序をわざと入れ替えて保存
  for (const thread of threads) {
    await workspace.saveThreadInfo(thread);
  }

  const allThreads = await workspace.getAllThreadInfos();
  assertEquals(allThreads.length, 3);
  assertEquals(allThreads[0].threadId, "thread-new");
  assertEquals(allThreads[1].threadId, "thread-mid");
  assertEquals(allThreads[2].threadId, "thread-old");

  // テストディレクトリをクリーンアップ
  await Deno.remove(uniqueTestDir, { recursive: true });
});

// テスト後のクリーンアップ
Deno.test({
  name: "テストディレクトリをクリーンアップ",
  fn: async () => {
    await Deno.remove(testDir, { recursive: true });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
