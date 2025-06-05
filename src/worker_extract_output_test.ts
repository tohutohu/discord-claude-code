import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Worker } from "./worker.ts";
import { WorkspaceManager } from "./workspace.ts";

// テスト用のClaudeCommandExecutor
class TestClaudeCommandExecutor {
  async executeStreaming(
    _args: string[],
    _cwd: string,
    _onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    return { code: 0, stderr: new Uint8Array() };
  }
}

Deno.test("extractOutputMessage - TODOリスト更新（tool_use）を正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    new TestClaudeCommandExecutor(),
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
    new TestClaudeCommandExecutor(),
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

Deno.test("extractOutputMessage - resultメッセージを正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const worker = new Worker(
    "test-worker",
    workspaceManager,
    new TestClaudeCommandExecutor(),
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

    assertEquals(result, "最終的な結果です。");
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
    new TestClaudeCommandExecutor(),
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
    new TestClaudeCommandExecutor(),
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
