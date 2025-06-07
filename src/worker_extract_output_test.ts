import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Worker } from "./worker.ts";
import { WorkspaceManager } from "./workspace.ts";
import { createMockClaudeCommandExecutor } from "../test/test-utils.ts";

Deno.test("extractOutputMessage - TODOリスト更新（tool_use）を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  // Worker クラスの private メソッドにアクセスするためのヘルパー
  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(
    worker,
  );

  try {
    // TODOリスト更新のClaudeStreamMessageをシミュレート
    const parsedMessage = {
      "type": "assistant",
      "message": {
        "id": "msg_016qk6hg3rkefqrzxprwZMCu",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-4-20250514",
        "content": [{
          "type": "tool_use",
          "id": "toolu_01ChHKW78mBDo3MZWBNsSQFy",
          "name": "TodoWrite",
          "input": {
            "todos": [
              {
                "id": "1",
                "content": "extractOutputMessage関数の現在の実装を確認",
                "status": "completed",
                "priority": "high",
              },
              {
                "id": "2",
                "content":
                  "TODOリスト更新ログを適切にパースして変更後の状態を抽出",
                "status": "completed",
                "priority": "high",
              },
              {
                "id": "3",
                "content": "チェックマーク付きリスト形式で出力する機能を実装",
                "status": "in_progress",
                "priority": "high",
              },
              {
                "id": "4",
                "content": "テストを実行して動作確認",
                "status": "pending",
                "priority": "medium",
              },
            ],
          },
        }],
        "stop_reason": "tool_use",
      },
    };

    const result = extractOutputMessage(parsedMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("📋 **TODOリスト更新:**"), true);
    assertEquals(
      result?.includes("✅ extractOutputMessage関数の現在の実装を確認"),
      true,
    );
    assertEquals(
      result?.includes(
        "✅ TODOリスト更新ログを適切にパースして変更後の状態を抽出",
      ),
      true,
    );
    assertEquals(
      result?.includes("🔄 チェックマーク付きリスト形式で出力する機能を実装"),
      true,
    );
    assertEquals(result?.includes("⬜ テストを実行して動作確認"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 通常のテキストメッセージを正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(
    worker,
  );

  try {
    // 通常のテキストメッセージ
    const parsedMessage = {
      "type": "assistant",
      "message": {
        "id": "msg_123",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-4-20250514",
        "content": [{
          "type": "text",
          "text": "これは通常のメッセージです。",
        }],
        "stop_reason": "end_turn",
      },
    };

    const result = extractOutputMessage(parsedMessage);

    assertEquals(result, "これは通常のメッセージです。");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - resultメッセージは進捗表示しない", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(
    worker,
  );

  try {
    // resultメッセージ
    const parsedMessage = {
      "type": "result",
      "result": "最終的な結果です。",
    };

    const result = extractOutputMessage(parsedMessage);

    // resultメッセージは進捗表示せずnullを返す（最終結果として別途処理される）
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - エラーメッセージを正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(
    worker,
  );

  try {
    // エラーメッセージ
    const parsedMessage = {
      "type": "error",
      "is_error": true,
      "message": {
        "content": [{
          "type": "text",
          "text": "エラーが発生しました。",
        }],
      },
    };

    const result = extractOutputMessage(parsedMessage);

    assertEquals(result, "エラーが発生しました。");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractTodoListUpdate - fallback処理でテキストからTODOリストを抽出する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractTodoListUpdate = (worker as unknown as {
    extractTodoListUpdate: (text: string) => string | null;
  }).extractTodoListUpdate.bind(
    worker,
  );

  try {
    const textWithTodos = `
    "name": "TodoWrite" 
    "todos": [
      {"id": "1", "content": "テスト項目1", "status": "completed"},
      {"id": "2", "content": "テスト項目2", "status": "pending"}
    ]
    `;
    const result = extractTodoListUpdate(textWithTodos);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("📋 **TODOリスト更新:**"), true);
    assertEquals(result?.includes("✅ テスト項目1"), true);
    assertEquals(result?.includes("⬜ テスト項目2"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - Bashツール実行を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // Bashツール実行のメッセージ
    const bashMessage = {
      "type": "assistant",
      "message": {
        "content": [{
          "type": "tool_use",
          "name": "Bash",
          "input": {
            "command": "git commit -m 'feat: 新機能を追加'",
            "description": "変更をコミット",
          },
        }],
      },
    };

    const result = extractOutputMessage(bashMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("⚡ **Bash**:"), true);
    assertEquals(result?.includes("変更をコミット"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - ツール結果（tool_result）を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // ツール結果のメッセージ
    const toolResultMessage = {
      "type": "user",
      "message": {
        "role": "user",
        "content": [{
          "tool_use_id": "toolu_01NM3djouyWg6WNjFfTipaLT",
          "type": "tool_result",
          "content":
            "[worker-123 a66d605] feat: 再起動時のスレッド復旧でworktree存在確認を追加\n 3 files changed, 171 insertions(+), 13 deletions(-)",
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(toolResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("feat: 再起動時のスレッド復旧"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - エラーツール結果を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // エラーツール結果のメッセージ
    const errorResultMessage = {
      "type": "user",
      "message": {
        "role": "user",
        "content": [{
          "tool_use_id": "toolu_123",
          "type": "tool_result",
          "content": "Error: Command failed with exit code 1",
          "is_error": true,
        }],
      },
    };

    const result = extractOutputMessage(errorResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("❌ **ツール実行結果:**"), true);
    assertEquals(result?.includes("Error: Command failed"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 短いツール結果を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    const shortResultMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": "Command executed successfully\nOutput: Hello World",
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(shortResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("Command executed successfully"), true);
    assertEquals(result?.includes("Hello World"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - TodoWrite成功メッセージをスキップする", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // TodoWrite成功の定型文
    const todoSuccessMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content":
            "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(todoSuccessMessage);

    // TodoWrite成功メッセージはnullを返す（スキップされる）
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - TodoWriteエラーメッセージは表示する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // TodoWriteエラーメッセージ
    const todoErrorMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": "Error: Failed to update todos - Invalid todo format",
          "is_error": true,
        }],
      },
    };

    const result = extractOutputMessage(todoErrorMessage);

    // エラーメッセージは表示される
    assertEquals(typeof result, "string");
    assertEquals(result?.includes("❌ **ツール実行結果:**"), true);
    assertEquals(result?.includes("Failed to update todos"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 長いツール結果をスマート要約する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // 長いgit結果をシミュレート
    const longGitResult = [
      "[a1b2c3d] feat: 新機能を追加",
      " 15 files changed, 432 insertions(+), 23 deletions(-)",
      " create mode 100644 src/new-feature.ts",
      " modify src/existing-file.ts",
      ...Array(100).fill("modify another-file.ts"),
      " Done.",
    ].join("\n");

    const longResultMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": longGitResult,
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(longResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("📊 **要約:**"), true);
    assertEquals(result?.includes("コミット a1b2c3d"), true);
    assertEquals(result?.includes("15ファイル変更"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - エラー結果から重要部分を抽出する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // エラー結果をシミュレート
    const errorResult = [
      "Starting process...",
      "Loading configuration...",
      "DEBUG: Loading module A",
      "DEBUG: Loading module B",
      "ERROR: Module C failed to load",
      "INFO: Attempting recovery",
      "FATAL: Recovery failed",
      "Process terminated with errors",
      ...Array(50).fill("DEBUG: Some debug info"),
    ].join("\n");

    const errorResultMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": errorResult,
          "is_error": true,
        }],
      },
    };

    const result = extractOutputMessage(errorResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("❌ **ツール実行結果:**"), true);
    assertEquals(result?.includes("ERROR: Module C failed to load"), true);
    assertEquals(result?.includes("FATAL: Recovery failed"), true);
    // DEBUG行は除外される
    assertEquals(result?.includes("DEBUG: Some debug info"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 中程度の長さの結果を先頭末尾で表示する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    createMockClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // 中程度の長さの結果をシミュレート（20行）
    const mediumResult = Array.from(
      { length: 20 },
      (_, i) => `Line ${i + 1}: Some content here`,
    ).join("\n");

    const mediumResultMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": mediumResult,
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(mediumResultMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("Line 1:"), true); // 先頭部分
    assertEquals(result?.includes("Line 20:"), true); // 末尾部分
    assertEquals(result?.includes("行省略"), true); // 省略表示
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
