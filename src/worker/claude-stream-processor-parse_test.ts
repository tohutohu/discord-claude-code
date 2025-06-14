import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  ClaudeStreamProcessor,
  JsonParseError,
  SchemaValidationError,
} from "./claude-stream-processor.ts";
import { MessageFormatter } from "./message-formatter.ts";

Deno.test("ClaudeStreamProcessor parseJsonLine - 正常なassistantメッセージをパース", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [{ type: "text", text: "Hello world" }],
      stop_reason: "end_turn",
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  assertEquals(result.session_id, "session_123");
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 正常なresultメッセージをパース", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Task completed",
    session_id: "session_123",
    cost_usd: 0.05,
    duration_ms: 1000,
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "result");
  if (result.type === "result") {
    assertEquals(result.subtype, "success");
    assertEquals(result.result, "Task completed");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 正常なsystemメッセージをパース", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "session_123",
    tools: ["Read", "Write", "Edit"],
    mcp_servers: [{ name: "server1", status: "connected" }],
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "system");
  if (result.type === "system") {
    assertEquals(result.subtype, "init");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 正常なerrorメッセージをパース", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "error",
    is_error: true,
    result: "Something went wrong",
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "error");
  if (result.type === "error") {
    assertEquals(result.is_error, true);
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 空文字列でJsonParseErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  assertThrows(
    () => processor.parseJsonLine(""),
    JsonParseError,
    "Failed to parse JSON",
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 無効なJSONでJsonParseErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  assertThrows(
    () => processor.parseJsonLine("not json"),
    JsonParseError,
    "Failed to parse JSON",
  );

  assertThrows(
    () => processor.parseJsonLine("{invalid json}"),
    JsonParseError,
    "Failed to parse JSON",
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 非オブジェクトでSchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  assertThrows(
    () => processor.parseJsonLine('"string"'),
    SchemaValidationError,
    "Parsed value is not an object",
  );

  assertThrows(
    () => processor.parseJsonLine("123"),
    SchemaValidationError,
    "Parsed value is not an object",
  );

  assertThrows(
    () => processor.parseJsonLine("null"),
    SchemaValidationError,
    "Parsed value is not an object",
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - typeフィールドがない場合SchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  assertThrows(
    () => processor.parseJsonLine('{"message": "hello"}'),
    SchemaValidationError,
    "Unknown message type",
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 不明なtypeでSchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  assertThrows(
    () => processor.parseJsonLine('{"type": "unknown"}'),
    SchemaValidationError,
    "Unknown message type",
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 必須フィールドが不足している場合SchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // assistantメッセージでsession_idが欠落
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
        },
      })),
    SchemaValidationError,
  );

  // resultメッセージでis_errorが欠落
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 型が間違っている場合SchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // session_idが数値
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: 123,
      })),
    SchemaValidationError,
  );

  // is_errorが文字列
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: "false",
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

// ContentBlock型の検証テスト

Deno.test("ClaudeStreamProcessor parseJsonLine - TextContent型が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [
        { type: "text", text: "Hello world" },
        { type: "text", text: "Second message" },
      ],
      stop_reason: "end_turn",
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  if (result.type === "assistant") {
    assertEquals(result.message.content.length, 2);
    assertEquals(result.message.content[0].type, "text");
    assertEquals(
      (result.message.content[0] as { type: "text"; text: string }).text,
      "Hello world",
    );
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - ToolUseContent型が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "Read",
          input: { file_path: "/path/to/file" },
        },
      ],
      stop_reason: "tool_use",
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  if (result.type === "assistant") {
    assertEquals(result.message.content[0].type, "tool_use");
    const toolUse = result.message.content[0] as {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };
    assertEquals(toolUse.id, "tool_123");
    assertEquals(toolUse.name, "Read");
    assertEquals(toolUse.input.file_path, "/path/to/file");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - ToolResultContent型（文字列）が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "user",
    message: {
      id: "msg_123",
      type: "message",
      role: "user",
      model: "claude-3-opus",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_123",
          content: "File contents here",
        },
      ],
      stop_reason: null,
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "user");
  if (result.type === "user") {
    assertEquals(result.message.content[0].type, "tool_result");
    const toolResult = result.message.content[0] as {
      type: "tool_result";
      tool_use_id: string;
      content: string | Array<{ type: "text"; text: string }>;
    };
    assertEquals(toolResult.tool_use_id, "tool_123");
    assertEquals(toolResult.content, "File contents here");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - ToolResultContent型（配列）が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "user",
    message: {
      id: "msg_123",
      type: "message",
      role: "user",
      model: "claude-3-opus",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_123",
          content: [
            { type: "text", text: "Line 1" },
            { type: "text", text: "Line 2" },
          ],
          is_error: false,
        },
      ],
      stop_reason: null,
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "user");
  if (result.type === "user") {
    const toolResult = result.message.content[0] as {
      type: "tool_result";
      tool_use_id: string;
      content: string | Array<{ type: "text"; text: string }>;
      is_error?: boolean;
    };
    assertEquals(toolResult.is_error, false);
    assertEquals(Array.isArray(toolResult.content), true);
    if (Array.isArray(toolResult.content)) {
      assertEquals(toolResult.content.length, 2);
      assertEquals(toolResult.content[0].text, "Line 1");
    }
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 混在したcontent型が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [
        { type: "text", text: "Let me read the file" },
        {
          type: "tool_use",
          id: "tool_123",
          name: "Read",
          input: { file_path: "/test.txt" },
        },
        { type: "text", text: "File read complete" },
      ],
      stop_reason: null,
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  if (result.type === "assistant") {
    assertEquals(result.message.content.length, 3);
    assertEquals(result.message.content[0].type, "text");
    assertEquals(result.message.content[1].type, "tool_use");
    assertEquals(result.message.content[2].type, "text");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - 空のcontent配列が正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [],
      stop_reason: "end_turn",
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  if (result.type === "assistant") {
    assertEquals(result.message.content.length, 0);
  }
});

// ContentBlock型の無効なケース

Deno.test("ClaudeStreamProcessor parseJsonLine - 無効なContentBlock型でSchemaValidationErrorをスロー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // 不明な型
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "unknown", data: "test" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // TextContentでtextフィールドが欠落
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // ToolUseContentでnameフィールドが欠落
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "tool_use", id: "tool_123", input: {} }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // ToolResultContentでtool_use_idフィールドが欠落
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "user",
        message: {
          id: "msg_123",
          type: "message",
          role: "user",
          model: "claude-3-opus",
          content: [{ type: "tool_result", content: "result" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - assistantメッセージに不正なContentBlock型が含まれる場合エラー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // assistantメッセージにtool_resultが含まれる（許可されていない）
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: "result",
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - userメッセージに不正なContentBlock型が含まれる場合エラー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // userメッセージにtool_useが含まれる（許可されていない）
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "user",
        message: {
          id: "msg_123",
          type: "message",
          role: "user",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Read",
              input: {},
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

// リテラル型の検証

Deno.test("ClaudeStreamProcessor parseJsonLine - message.typeのリテラル型が検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // message.typeが"message"以外
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "other",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - message.roleのリテラル型が検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // assistantメッセージでroleが"user"
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "user",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // userメッセージでroleが"assistant"
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "user",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - resultメッセージのsubtypeリテラル型が検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // 無効なsubtype
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "invalid",
        is_error: false,
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - systemメッセージのsubtypeリテラル型が検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // 無効なsubtype
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "system",
        subtype: "other",
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

// エッジケース

Deno.test("ClaudeStreamProcessor parseJsonLine - ToolResultContentの無効なcontent配列形式でエラー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // content配列内の要素がtext型でない
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "user",
        message: {
          id: "msg_123",
          type: "message",
          role: "user",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: [{ type: "other", text: "text" }],
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // content配列内の要素にtextフィールドがない
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "user",
        message: {
          id: "msg_123",
          type: "message",
          role: "user",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: [{ type: "text" }],
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - ToolUseContentのinputが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // inputがオブジェクトでない
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Read",
              input: "not an object",
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // inputがnull
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Read",
              input: null,
            },
          ],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - contentがオブジェクトでない場合エラー", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // contentの要素が文字列
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: ["not an object"],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // contentの要素がnull
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [null],
          stop_reason: null,
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

Deno.test("ClaudeStreamProcessor parseJsonLine - オプショナルなusageフィールドが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // 正常なusageフィールド
  const validJson = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    },
    session_id: "session_123",
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "assistant");
  if (result.type === "assistant" && result.message.usage) {
    assertEquals(result.message.usage.input_tokens, 100);
    assertEquals(result.message.usage.output_tokens, 50);
  }

  // usageがオブジェクトでない
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: null,
          usage: "invalid",
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );

  // input_tokensが数値でない
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-3-opus",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: null,
          usage: {
            input_tokens: "100",
            output_tokens: 50,
          },
        },
        session_id: "session_123",
      })),
    SchemaValidationError,
  );
});

// resultメッセージの新しいフィールドに関するテスト

Deno.test("ClaudeStreamProcessor parseJsonLine - resultメッセージのerror_during_executionサブタイプが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  const validJson = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "Execution failed due to an error",
    session_id: "session_123",
    duration_ms: 5000,
  });

  const result = processor.parseJsonLine(validJson);
  assertEquals(result.type, "result");
  if (result.type === "result") {
    assertEquals(result.subtype, "error_during_execution");
    assertEquals(result.is_error, true);
    assertEquals(result.result, "Execution failed due to an error");
  }
});

Deno.test("ClaudeStreamProcessor parseJsonLine - resultメッセージのtotal_cost_usdフィールドが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // total_cost_usdが存在する場合
  const withTotalCostJson = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Task completed",
    session_id: "session_123",
    cost_usd: 0.05,
    total_cost_usd: 0.15,
    duration_ms: 1000,
  });

  const resultWithTotalCost = processor.parseJsonLine(withTotalCostJson);
  assertEquals(resultWithTotalCost.type, "result");
  if (resultWithTotalCost.type === "result") {
    assertEquals(resultWithTotalCost.cost_usd, 0.05);
    assertEquals(resultWithTotalCost.total_cost_usd, 0.15);
  }

  // total_cost_usdが存在しない場合（オプショナルフィールド）
  const withoutTotalCostJson = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Task completed",
    session_id: "session_123",
    cost_usd: 0.05,
    duration_ms: 1000,
  });

  const resultWithoutTotalCost = processor.parseJsonLine(withoutTotalCostJson);
  assertEquals(resultWithoutTotalCost.type, "result");
  if (resultWithoutTotalCost.type === "result") {
    assertEquals(resultWithoutTotalCost.cost_usd, 0.05);
    assertEquals(resultWithoutTotalCost.total_cost_usd, undefined);
  }

  // total_cost_usdが数値でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "session_123",
        total_cost_usd: "0.15",
      })),
    SchemaValidationError,
  );
});

// systemメッセージの新しいオプショナルフィールドに関するテスト

Deno.test("ClaudeStreamProcessor parseJsonLine - systemメッセージの新しいオプショナルフィールドが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // 全てのオプショナルフィールドを含むケース
  const fullSystemJson = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "session_123",
    tools: ["Read", "Write", "Edit"],
    mcp_servers: [{ name: "server1", status: "connected" }],
    apiKeySource: "environment",
    cwd: "/home/user/project",
    model: "claude-3-opus",
    permissionMode: "strict",
  });

  const fullResult = processor.parseJsonLine(fullSystemJson);
  assertEquals(fullResult.type, "system");
  if (fullResult.type === "system") {
    assertEquals(fullResult.apiKeySource, "environment");
    assertEquals(fullResult.cwd, "/home/user/project");
    assertEquals(fullResult.model, "claude-3-opus");
    assertEquals(fullResult.permissionMode, "strict");
  }

  // オプショナルフィールドの一部のみ含むケース
  const partialSystemJson = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "session_123",
    cwd: "/workspace",
    model: "claude-3-haiku",
  });

  const partialResult = processor.parseJsonLine(partialSystemJson);
  assertEquals(partialResult.type, "system");
  if (partialResult.type === "system") {
    assertEquals(partialResult.cwd, "/workspace");
    assertEquals(partialResult.model, "claude-3-haiku");
    assertEquals(partialResult.apiKeySource, undefined);
    assertEquals(partialResult.permissionMode, undefined);
  }

  // apiKeySourceが文字列でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_123",
        apiKeySource: 123,
      })),
    SchemaValidationError,
  );

  // cwdが文字列でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_123",
        cwd: { path: "/workspace" },
      })),
    SchemaValidationError,
  );

  // modelが文字列でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_123",
        model: null,
      })),
    SchemaValidationError,
  );

  // permissionModeが文字列でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_123",
        permissionMode: true,
      })),
    SchemaValidationError,
  );
});

// resultメッセージのオプショナルフィールドに関する追加テスト

Deno.test("ClaudeStreamProcessor parseJsonLine - resultメッセージのduration_api_msとnum_turnsフィールドが正しく検証される", () => {
  const formatter = new MessageFormatter();
  const processor = new ClaudeStreamProcessor(formatter);

  // duration_api_msとnum_turnsが存在する場合
  const withApiDurationJson = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "session_123",
    duration_ms: 5000,
    duration_api_ms: 3000,
    num_turns: 3,
  });

  const result = processor.parseJsonLine(withApiDurationJson);
  assertEquals(result.type, "result");
  if (result.type === "result") {
    assertEquals(result.duration_ms, 5000);
    assertEquals(result.duration_api_ms, 3000);
    assertEquals(result.num_turns, 3);
  }

  // duration_api_msが数値でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "session_123",
        duration_api_ms: "3000",
      })),
    SchemaValidationError,
  );

  // num_turnsが数値でない場合のエラー
  assertThrows(
    () =>
      processor.parseJsonLine(JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "session_123",
        num_turns: "3",
      })),
    SchemaValidationError,
  );
});
