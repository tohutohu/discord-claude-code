import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { AuditEntry, ThreadInfo, WorkspaceManager } from "../src/workspace.ts";

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
    worktreePath: null,
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
    worktreePath: null,
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
      worktreePath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T01:00:00.000Z",
      status: "inactive",
    },
    {
      threadId: "thread-new",
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T03:00:00.000Z",
      status: "active",
    },
    {
      threadId: "thread-mid",
      repositoryFullName: null,
      repositoryLocalPath: null,
      worktreePath: null,
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

Deno.test("生のJSONLセッションデータを保存できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const repositoryFullName = "test-org/test-repo";
  const sessionId = "session-12345";
  const rawJsonlContent =
    `{"type":"assistant","subtype":"tool_use","session_id":"session-12345","message":{"id":"msg_123","type":"message","role":"assistant","content":[{"type":"text","text":"Hello World"}]}}
{"type":"result","session_id":"session-12345","result":"Task completed"}`;

  // 生のJSONLを保存
  await workspace.saveRawSessionJsonl(
    repositoryFullName,
    sessionId,
    rawJsonlContent,
  );

  // ファイルが正しい場所に保存されているかチェック
  const expectedDir = join(testDir, "sessions", repositoryFullName);
  const dirStat = await Deno.stat(expectedDir);
  assertEquals(dirStat.isDirectory, true);

  // ファイル一覧を取得して、正しい形式で保存されているかチェック
  const files = [];
  for await (const entry of Deno.readDir(expectedDir)) {
    if (entry.isFile && entry.name.endsWith(".jsonl")) {
      files.push(entry.name);
    }
  }

  assertEquals(files.length, 1);

  // ファイル名の形式をチェック（タイムスタンプ_セッションID.jsonl）
  const fileName = files[0];
  assertEquals(fileName.endsWith(`_${sessionId}.jsonl`), true);

  // ファイル内容をチェック
  const filePath = join(expectedDir, fileName);
  const savedContent = await Deno.readTextFile(filePath);
  assertEquals(savedContent, rawJsonlContent);
});

Deno.test("複数のリポジトリで生のJSONLセッションデータを保存できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const repositories = ["org1/repo1", "org2/repo2"];
  const sessionIds = ["session-001", "session-002"];

  for (let i = 0; i < repositories.length; i++) {
    const repositoryFullName = repositories[i];
    const sessionId = sessionIds[i];
    const rawJsonlContent =
      `{"type":"test","session_id":"${sessionId}","data":"test-${i}"}`;

    await workspace.saveRawSessionJsonl(
      repositoryFullName,
      sessionId,
      rawJsonlContent,
    );

    // 各リポジトリ用ディレクトリが作成されているかチェック
    const expectedDir = join(testDir, "sessions", repositoryFullName);
    const dirStat = await Deno.stat(expectedDir);
    assertEquals(dirStat.isDirectory, true);
  }
});

Deno.test("同じセッションIDでJSONLデータを追記できる", async () => {
  const workspace = new WorkspaceManager(testDir);
  await workspace.initialize();

  const repositoryFullName = "test-org/append-test";
  const sessionId = "session-append-123";

  // 最初のデータを保存
  const firstContent =
    `{"type":"first","session_id":"${sessionId}","data":"first"}`;
  await workspace.saveRawSessionJsonl(
    repositoryFullName,
    sessionId,
    firstContent,
  );

  // 同じセッションIDで追加のデータを保存
  const secondContent =
    `{"type":"second","session_id":"${sessionId}","data":"second"}`;
  await workspace.saveRawSessionJsonl(
    repositoryFullName,
    sessionId,
    secondContent,
  );

  // ファイルが1つだけ存在することを確認
  const expectedDir = join(testDir, "sessions", repositoryFullName);
  const files = [];
  for await (const entry of Deno.readDir(expectedDir)) {
    if (entry.isFile && entry.name.endsWith(".jsonl")) {
      files.push(entry.name);
    }
  }
  assertEquals(files.length, 1);

  // ファイル内容が追記されていることを確認
  const filePath = join(expectedDir, files[0]);
  const savedContent = await Deno.readTextFile(filePath);
  const lines = savedContent.trim().split("\n");
  assertEquals(lines.length, 2);
  assertEquals(lines[0], firstContent);
  assertEquals(lines[1], secondContent);
});

Deno.test("ローカルリポジトリの一覧を取得できる", async () => {
  const uniqueTestDir = await Deno.makeTempDir({
    prefix: "workspace_test_local_repos_",
  });
  const workspace = new WorkspaceManager(uniqueTestDir);
  await workspace.initialize();

  // テスト用のリポジトリディレクトリ構造を作成
  const repoStructure = [
    "org1/repo1",
    "org1/repo2",
    "org2/repo3",
    "user1/personal-project",
  ];

  for (const repo of repoStructure) {
    const [org, repoName] = repo.split("/");
    const repoPath = workspace.getRepositoryPath(org, repoName);
    await Deno.mkdir(repoPath, { recursive: true });
  }

  // ローカルリポジトリ一覧を取得
  const localRepos = await workspace.getLocalRepositories();

  assertEquals(localRepos.length, 4);
  assertEquals(localRepos, [
    "org1/repo1",
    "org1/repo2",
    "org2/repo3",
    "user1/personal-project",
  ]);

  // テストディレクトリをクリーンアップ
  await Deno.remove(uniqueTestDir, { recursive: true });
});

Deno.test("ローカルリポジトリが存在しない場合は空の配列を返す", async () => {
  const uniqueTestDir = await Deno.makeTempDir({
    prefix: "workspace_test_empty_repos_",
  });
  const workspace = new WorkspaceManager(uniqueTestDir);
  await workspace.initialize();

  const localRepos = await workspace.getLocalRepositories();
  assertEquals(localRepos, []);

  // テストディレクトリをクリーンアップ
  await Deno.remove(uniqueTestDir, { recursive: true });
});

Deno.test("不正なディレクトリ構造があってもエラーにならない", async () => {
  const uniqueTestDir = await Deno.makeTempDir({
    prefix: "workspace_test_invalid_repos_",
  });
  const workspace = new WorkspaceManager(uniqueTestDir);
  await workspace.initialize();

  // 正常なリポジトリ
  const validRepoPath = workspace.getRepositoryPath("valid-org", "valid-repo");
  await Deno.mkdir(validRepoPath, { recursive: true });

  // org レベルに不正なファイルを作成
  await Deno.writeTextFile(
    join(workspace.getRepositoriesDir(), "not-a-directory.txt"),
    "test",
  );

  // repo レベルに不正なファイルを作成
  const orgPath = join(workspace.getRepositoriesDir(), "test-org");
  await Deno.mkdir(orgPath, { recursive: true });
  await Deno.writeTextFile(join(orgPath, "not-a-repo.txt"), "test");

  const localRepos = await workspace.getLocalRepositories();
  assertEquals(localRepos, ["valid-org/valid-repo"]);

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
