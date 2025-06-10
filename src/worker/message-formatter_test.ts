import { assertEquals } from "https://deno.land/std@0.211.0/assert/mod.ts";
import { MessageFormatter } from "./message-formatter.ts";

Deno.test("MessageFormatter - formatResponse - 短いメッセージはそのまま返す", () => {
  const formatter = new MessageFormatter();
  const message = "これは短いメッセージです。";
  const result = formatter.formatResponse(message);
  assertEquals(result, message);
});

Deno.test("MessageFormatter - formatResponse - 長いメッセージは切り詰める", () => {
  const formatter = new MessageFormatter();
  const message = "あ".repeat(2000);
  const result = formatter.formatResponse(message);

  // 1900文字以下であることを確認
  assertEquals(result.length <= 1900 + 50, true); // 省略メッセージ分の余裕を持つ
  assertEquals(
    result.includes("*（応答が長いため、一部のみ表示しています）*"),
    true,
  );
});

Deno.test("MessageFormatter - formatResponse - ANSIコードを除去", () => {
  const formatter = new MessageFormatter();
  const message = "\x1b[31m赤いテキスト\x1b[0m";
  const result = formatter.formatResponse(message);
  assertEquals(result, "赤いテキスト");
});

Deno.test("MessageFormatter - formatToolUse - Bashツール", () => {
  const formatter = new MessageFormatter();
  const item = {
    type: "tool_use",
    name: "Bash",
    input: {
      command: "ls -la",
      description: "ファイル一覧表示",
    },
  };
  const result = formatter.formatToolUse(item);
  assertEquals(result, "⚡ **Bash**: ファイル一覧表示");
});

Deno.test("MessageFormatter - formatToolUse - TodoWriteツール", () => {
  const formatter = new MessageFormatter();
  const item = {
    type: "tool_use",
    name: "TodoWrite",
    input: {
      todos: [
        { status: "completed", content: "タスク1" },
        { status: "in_progress", content: "タスク2" },
        { status: "pending", content: "タスク3" },
      ],
    },
  };
  const result = formatter.formatToolUse(item);
  assertEquals(
    result,
    "📋 **TODOリスト更新:**\n✅ タスク1\n🔄 タスク2\n⬜ タスク3",
  );
});

Deno.test("MessageFormatter - formatToolUse - MultiEdit", () => {
  const formatter = new MessageFormatter();
  const item = {
    type: "tool_use",
    name: "MultiEdit",
    input: {
      file_path: "/path/to/file.ts",
      edits: [
        { old_string: "old1", new_string: "new1" },
        { old_string: "old2", new_string: "new2" },
      ],
    },
  };
  const result = formatter.formatToolUse(item);
  assertEquals(result, "🔧 **MultiEdit**: ファイル一括編集: file.ts");
});

Deno.test("MessageFormatter - formatToolUse - MultiEdit with repository path", () => {
  const formatter = new MessageFormatter();
  const item = {
    type: "tool_use",
    name: "MultiEdit",
    input: {
      file_path: "/work/repositories/org/repo/src/file.ts",
      edits: [
        { old_string: "old1", new_string: "new1" },
      ],
    },
  };
  const result = formatter.formatToolUse(item);
  assertEquals(result, "🔧 **MultiEdit**: ファイル一括編集: src/file.ts");
});

Deno.test("MessageFormatter - formatToolResult - 短い結果", () => {
  const formatter = new MessageFormatter();
  const content = "実行成功しました";
  const result = formatter.formatToolResult(content, false);
  assertEquals(result, "```\n実行成功しました\n```");
});

Deno.test("MessageFormatter - formatToolResult - エラー結果", () => {
  const formatter = new MessageFormatter();
  const content = "Error: ファイルが見つかりません\n詳細情報\nデバッグ情報";
  const result = formatter.formatToolResult(content, true);
  assertEquals(result.includes("Error: ファイルが見つかりません"), true);
  assertEquals(result.includes("```"), true);
});

Deno.test("MessageFormatter - formatTodoList", () => {
  const formatter = new MessageFormatter();
  const todos = [
    { status: "completed", content: "完了タスク" },
    { status: "in_progress", content: "進行中タスク" },
    { status: "pending", content: "未着手タスク" },
  ];
  const result = formatter.formatTodoList(todos);
  const expected =
    "📋 **TODOリスト更新:**\n✅ 完了タスク\n🔄 進行中タスク\n⬜ 未着手タスク";
  assertEquals(result, expected);
});

Deno.test("MessageFormatter - isTodoWriteSuccessMessage", () => {
  const formatter = new MessageFormatter();

  // 成功メッセージ
  assertEquals(
    formatter.isTodoWriteSuccessMessage(
      "Todos have been modified successfully",
    ),
    true,
  );
  assertEquals(
    formatter.isTodoWriteSuccessMessage("Todo list has been updated"),
    true,
  );

  // 成功メッセージでない
  assertEquals(
    formatter.isTodoWriteSuccessMessage("何か他のメッセージ"),
    false,
  );
});

Deno.test("MessageFormatter - extractTodoListUpdate - TodoWrite検出", () => {
  const formatter = new MessageFormatter();
  const textContent = `
    何か他のテキスト
    "name": "TodoWrite"
    "todos": [
      {"status": "completed", "content": "タスク1"},
      {"status": "pending", "content": "タスク2"}
    ]
  `;
  const result = formatter.extractTodoListUpdate(textContent);
  assertEquals(result, "📋 **TODOリスト更新:**\n✅ タスク1\n⬜ タスク2");
});

Deno.test("MessageFormatter - extractTodoListUpdate - TodoWriteがない場合", () => {
  const formatter = new MessageFormatter();
  const textContent = "通常のテキスト";
  const result = formatter.extractTodoListUpdate(textContent);
  assertEquals(result, null);
});
