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
