import { assertEquals } from "std/assert/mod.ts";
import * as path from "std/path/mod.ts";
import { SessionManager } from "./session-manager.ts";

Deno.test("SessionManager - セッションログの保存と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const repositoryFullName = "test-org/test-repo";
    const sessionId = "test-session-123";

    const jsonlContent1 = JSON.stringify({
      timestamp: "2024-01-01T00:00:00Z",
      sessionId,
      type: "request",
      content: "test request",
    });

    const jsonlContent2 = JSON.stringify({
      timestamp: "2024-01-01T00:00:01Z",
      sessionId,
      type: "response",
      content: "test response",
    });

    // 新規作成
    const saveResult1 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      sessionId,
      jsonlContent1,
    );
    assertEquals(saveResult1.isOk(), true);

    // 追記
    const saveResult2 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      sessionId,
      jsonlContent2,
    );
    assertEquals(saveResult2.isOk(), true);

    // 読み込み
    const loadResult = await manager.loadSessionLogs(
      repositoryFullName,
      sessionId,
    );
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      const logs = loadResult.value;
      assertEquals(logs.length, 2);
      assertEquals(logs[0].type, "request");
      assertEquals(logs[0].content, "test request");
      assertEquals(logs[1].type, "response");
      assertEquals(logs[1].content, "test response");
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - 存在しないセッションの読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const loadResult = await manager.loadSessionLogs(
      "test-org/test-repo",
      "non-existent",
    );
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      assertEquals(loadResult.value, []);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - セッションIDの一覧取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const repositoryFullName = "test-org/test-repo";

    // 複数のセッションを作成
    const saveResult1 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      "session-1",
      "{}",
    );
    assertEquals(saveResult1.isOk(), true);
    const saveResult2 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      "session-2",
      "{}",
    );
    assertEquals(saveResult2.isOk(), true);
    const saveResult3 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      "session-3",
      "{}",
    );
    assertEquals(saveResult3.isOk(), true);

    // 同じセッションに追記
    const saveResult4 = await manager.saveRawSessionJsonl(
      repositoryFullName,
      "session-1",
      "{}",
    );
    assertEquals(saveResult4.isOk(), true);

    const getResult = await manager.getSessionIds(repositoryFullName);
    assertEquals(getResult.isOk(), true);
    if (getResult.isOk()) {
      const sessionIds = getResult.value;
      assertEquals(sessionIds.length, 3);
      assertEquals(sessionIds, ["session-1", "session-2", "session-3"]);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - 存在しないリポジトリのセッションID一覧", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const getResult = await manager.getSessionIds("non-existent/repo");
    assertEquals(getResult.isOk(), true);
    if (getResult.isOk()) {
      assertEquals(getResult.value, []);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - セッションログの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const repositoryFullName = "test-org/test-repo";
    const sessionId = "test-session-456";

    // セッション作成
    const saveResult = await manager.saveRawSessionJsonl(
      repositoryFullName,
      sessionId,
      "{}",
    );
    assertEquals(saveResult.isOk(), true);

    // 削除前の確認
    let getResult = await manager.getSessionIds(repositoryFullName);
    assertEquals(getResult.isOk(), true);
    if (getResult.isOk()) {
      assertEquals(getResult.value.length, 1);
      assertEquals(getResult.value[0], sessionId);
    }

    // 削除
    const deleteResult = await manager.deleteSessionLogs(
      repositoryFullName,
      sessionId,
    );
    assertEquals(deleteResult.isOk(), true);

    // 削除後の確認
    getResult = await manager.getSessionIds(repositoryFullName);
    assertEquals(getResult.isOk(), true);
    if (getResult.isOk()) {
      assertEquals(getResult.value.length, 0);
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - 存在しないセッションの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    // 存在しないセッションを削除してもエラーにならない
    const deleteResult = await manager.deleteSessionLogs(
      "test-org/test-repo",
      "non-existent",
    );
    assertEquals(deleteResult.isOk(), true);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("SessionManager - 空行を含むJSONLの処理", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new SessionManager(testBaseDir);
    const initResult = await manager.initialize();
    assertEquals(initResult.isOk(), true);

    const repositoryFullName = "test-org/test-repo";
    const sessionId = "test-session-789";

    // 空行を含むJSONLコンテンツを作成
    const sessionLogs = [
      {
        timestamp: new Date().toISOString(),
        sessionId,
        type: "request",
        content: "1",
      },
      {
        timestamp: new Date().toISOString(),
        sessionId,
        type: "response",
        content: "2",
      },
    ];

    // JSONLファイルを直接作成（空行を含む）
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionFilePath = path.join(
      testBaseDir,
      "sessions",
      repositoryFullName,
      `${timestamp}_${sessionId}.jsonl`,
    );
    await Deno.mkdir(path.dirname(sessionFilePath), { recursive: true });

    // 空行を間に挟んでJSONLを書き込む
    const content = [
      JSON.stringify(sessionLogs[0]),
      "", // 空行
      JSON.stringify(sessionLogs[1]),
    ].join("\n");

    await Deno.writeTextFile(sessionFilePath, content);

    const loadResult = await manager.loadSessionLogs(
      repositoryFullName,
      sessionId,
    );
    assertEquals(loadResult.isOk(), true);
    if (loadResult.isOk()) {
      const logs = loadResult.value;
      // 空行は除外される
      assertEquals(logs.length, 2);
      assertEquals(logs[0].content, "1");
      assertEquals(logs[1].content, "2");
    }
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
