import { MessageFormatter } from "./message-formatter.ts";

/**
 * JSON解析エラー
 */
export class JsonParseError extends Error {
  public readonly line: string;
  public override readonly cause: unknown;

  constructor(line: string, cause: unknown) {
    super(`Failed to parse JSON: ${cause}`);
    this.name = "JsonParseError";
    this.line = line;
    this.cause = cause;
  }
}

/**
 * スキーマ検証エラー
 */
export class SchemaValidationError extends Error {
  constructor(public readonly data: unknown, message: string) {
    super(`Schema validation failed: ${message}`);
    this.name = "SchemaValidationError";
  }
}

// Claude Code SDK message schema based on https://docs.anthropic.com/en/docs/claude-code/sdk#message-schema
export type ClaudeStreamMessage =
  | {
    type: "assistant";
    message: {
      id: string;
      type: string;
      role: string;
      model: string;
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
      usage?: {
        input_tokens: number;
        output_tokens: number;
      };
    };
    session_id: string;
  }
  | {
    type: "user";
    message: {
      id: string;
      type: string;
      role: string;
      model: string;
      content: Array<{
        type: string;
        text?: string;
        tool_use_id?: string;
        content?: string | Array<{ type: string; text?: string }>;
        is_error?: boolean;
      }>;
      stop_reason: string;
      usage?: {
        input_tokens: number;
        output_tokens: number;
      };
    };
    session_id: string;
  }
  | {
    type: "result";
    subtype: "success" | "error_max_turns";
    cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
    is_error: boolean;
    num_turns?: number;
    result?: string;
    session_id: string;
  }
  | {
    type: "system";
    subtype: "init";
    session_id: string;
    tools?: string[];
    mcp_servers?: {
      name: string;
      status: string;
    }[];
  }
  | {
    type: "error";
    result?: string;
    is_error: boolean;
    session_id?: string;
  };

export class ClaudeCodeRateLimitError extends Error {
  public readonly timestamp: number;
  public readonly retryAt: number;

  constructor(timestamp: number) {
    super(`Claude AI usage limit reached|${timestamp}`);
    this.name = "ClaudeCodeRateLimitError";
    this.timestamp = timestamp;
    this.retryAt = timestamp;
  }
}

/**
 * Claude CLIのストリーミング出力を処理するクラス
 */
export class ClaudeStreamProcessor {
  private readonly formatter: MessageFormatter;

  constructor(formatter: MessageFormatter) {
    this.formatter = formatter;
  }

  /**
   * JSONライン文字列を安全に解析して型検証を行う
   * @param line JSON文字列の行
   * @returns パースされ、検証されたClaudeStreamMessage
   * @throws {JsonParseError} JSON解析に失敗した場合
   * @throws {SchemaValidationError} スキーマ検証に失敗した場合
   */
  parseJsonLine(line: string): ClaudeStreamMessage {
    // JSON解析
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new JsonParseError(line, error);
    }

    // 基本的な型チェック
    if (typeof parsed !== "object" || parsed === null) {
      throw new SchemaValidationError(parsed, "Parsed value is not an object");
    }

    // 型ガード付き検証
    const validated = this.validateClaudeStreamMessage(parsed);
    if (!validated) {
      throw new SchemaValidationError(
        parsed,
        "Unknown message type or invalid structure",
      );
    }

    return validated;
  }

  /**
   * オブジェクトがClaudeStreamMessageの有効な型かを検証する
   */
  private validateClaudeStreamMessage(
    data: unknown,
  ): ClaudeStreamMessage | null {
    if (!this.isObject(data) || !("type" in data)) {
      return null;
    }

    switch (data.type) {
      case "assistant":
        return this.validateAssistantMessage(data)
          ? data as ClaudeStreamMessage
          : null;
      case "user":
        return this.validateUserMessage(data)
          ? data as ClaudeStreamMessage
          : null;
      case "result":
        return this.validateResultMessage(data)
          ? data as ClaudeStreamMessage
          : null;
      case "system":
        return this.validateSystemMessage(data)
          ? data as ClaudeStreamMessage
          : null;
      case "error":
        return this.validateErrorMessage(data)
          ? data as ClaudeStreamMessage
          : null;
      default:
        return null;
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private validateAssistantMessage(data: unknown): boolean {
    if (!this.isObject(data)) return false;
    if (data.type !== "assistant") return false;
    if (!this.isObject(data.message)) return false;

    const message = data.message;
    if (typeof message.id !== "string") return false;
    if (typeof message.type !== "string") return false;
    if (typeof message.role !== "string") return false;
    if (typeof message.model !== "string") return false;
    if (!Array.isArray(message.content)) return false;
    if (typeof message.stop_reason !== "string") return false;
    if (typeof data.session_id !== "string") return false;

    return true;
  }

  private validateUserMessage(data: unknown): boolean {
    if (!this.isObject(data)) return false;
    if (data.type !== "user") return false;
    if (!this.isObject(data.message)) return false;

    const message = data.message;
    if (typeof message.id !== "string") return false;
    if (typeof message.type !== "string") return false;
    if (typeof message.role !== "string") return false;
    if (typeof message.model !== "string") return false;
    if (!Array.isArray(message.content)) return false;
    if (typeof message.stop_reason !== "string") return false;
    if (typeof data.session_id !== "string") return false;

    return true;
  }

  private validateResultMessage(data: unknown): boolean {
    if (!this.isObject(data)) return false;
    if (data.type !== "result") return false;
    if (typeof data.subtype !== "string") return false;
    if (typeof data.is_error !== "boolean") return false;
    if (typeof data.session_id !== "string") return false;

    // オプショナルフィールドの検証
    if ("result" in data && typeof data.result !== "string") return false;
    if ("cost_usd" in data && typeof data.cost_usd !== "number") return false;
    if ("duration_ms" in data && typeof data.duration_ms !== "number") {
      return false;
    }
    if ("num_turns" in data && typeof data.num_turns !== "number") return false;

    return true;
  }

  private validateSystemMessage(data: unknown): boolean {
    if (!this.isObject(data)) return false;
    if (data.type !== "system") return false;
    if (typeof data.subtype !== "string") return false;
    if (typeof data.session_id !== "string") return false;

    // オプショナルフィールドの検証
    if ("tools" in data && !Array.isArray(data.tools)) return false;
    if ("mcp_servers" in data && !Array.isArray(data.mcp_servers)) return false;

    return true;
  }

  private validateErrorMessage(data: unknown): boolean {
    if (!this.isObject(data)) return false;
    if (data.type !== "error") return false;
    if (typeof data.is_error !== "boolean") return false;

    // オプショナルフィールドの検証
    if ("result" in data && typeof data.result !== "string") return false;
    if ("session_id" in data && typeof data.session_id !== "string") {
      return false;
    }

    return true;
  }

  /**
   * プロセスストリームを処理する
   */
  async processStreams(
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>,
    onData: (data: Uint8Array) => void,
  ): Promise<Uint8Array> {
    const stdoutReader = stdout.getReader();
    const stderrReader = stderr.getReader();
    let stderrOutput = new Uint8Array();

    // stdoutの読み取りPromise
    const stdoutPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          if (value) {
            onData(value);
          }
        }
      } catch (error) {
        if (error instanceof ClaudeCodeRateLimitError) {
          throw error; // レートリミットエラーはそのまま投げる
        }

        console.error("stdout読み取りエラー:", error);
      } finally {
        stdoutReader.releaseLock();
      }
    })();

    // stderrの読み取りPromise
    const stderrPromise = (async () => {
      try {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
          }
        }
        // stderrの内容を結合
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        stderrOutput = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          stderrOutput.set(chunk, offset);
          offset += chunk.length;
        }
      } catch (error) {
        console.error("stderr読み取りエラー:", error);
      } finally {
        stderrReader.releaseLock();
      }
    })();

    await Promise.all([stdoutPromise, stderrPromise]);
    return stderrOutput;
  }

  /**
   * JSONL行からClaude Codeの実際の出力メッセージを抽出する
   */
  extractOutputMessage(parsed: ClaudeStreamMessage): string | null {
    // assistantメッセージの場合
    if (
      parsed.type === "assistant" && "message" in parsed &&
      parsed.message?.content
    ) {
      return this.extractAssistantMessage(parsed.message.content);
    }

    // userメッセージの場合（tool_result等）
    if (
      parsed.type === "user" && "message" in parsed && parsed.message?.content
    ) {
      return this.extractUserMessage(parsed.message.content);
    }

    // systemメッセージの場合（初期化情報）
    if (parsed.type === "system" && parsed.subtype === "init") {
      const tools = parsed.tools?.join(", ") || "なし";
      const mcpServers = parsed.mcp_servers?.map((s) =>
        `${s.name}(${s.status})`
      ).join(", ") || "なし";
      return `🔧 **システム初期化:** ツール: ${tools}, MCPサーバー: ${mcpServers}`;
    }

    // resultメッセージは最終結果として別途処理されるため、ここでは返さない
    if (parsed.type === "result") {
      return null;
    }

    // エラーメッセージの場合
    if (parsed.type === "error" && parsed.result) {
      return `❌ **エラー:** ${parsed.result}`;
    }

    return null;
  }

  /**
   * assistantメッセージのcontentを処理する
   */
  private extractAssistantMessage(
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>,
  ): string | null {
    let textContent = "";

    for (const item of content) {
      if (item.type === "text" && item.text) {
        textContent += item.text;
      } else if (item.type === "tool_use") {
        // ツール使用を進捗として投稿
        const toolMessage = this.formatter.formatToolUse(item);
        if (toolMessage) {
          return toolMessage;
        }
      }
    }

    // テキスト内容からTODOリスト更新の検出も試行（fallback）
    const todoListUpdate = this.formatter.extractTodoListUpdate(textContent);
    if (todoListUpdate) {
      return todoListUpdate;
    }

    return textContent || null;
  }

  /**
   * userメッセージのcontentを処理する（tool_result等）
   */
  private extractUserMessage(
    content: Array<{
      type: string;
      text?: string;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
      is_error?: boolean;
    }>,
  ): string | null {
    for (const item of content) {
      if (item.type === "tool_result") {
        let resultContent = "";

        // contentが配列の場合（タスクエージェントなど）
        if (Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === "text" && contentItem.text) {
              resultContent += contentItem.text;
            }
          }
        } else {
          // contentが文字列の場合（通常のツール結果）
          resultContent = item.content || "";
        }

        // TodoWrite成功の定型文はスキップ
        if (
          !item.is_error &&
          this.formatter.isTodoWriteSuccessMessage(resultContent)
        ) {
          return null;
        }

        // ツール結果を進捗として投稿
        const resultIcon = item.is_error ? "❌" : "✅";

        // 長さに応じて処理を分岐
        const formattedContent = this.formatter.formatToolResult(
          resultContent,
          item.is_error || false,
        );

        return `${resultIcon} **ツール実行結果:**\n${formattedContent}`;
      } else if (item.type === "text" && item.text) {
        return item.text;
      }
    }
    return null;
  }

  /**
   * Claude Codeのレートリミットメッセージかを判定する
   */
  isClaudeCodeRateLimit(result: string): boolean {
    return result.includes("Claude AI usage limit reached|");
  }

  /**
   * レートリミットメッセージからタイムスタンプを抽出する
   */
  extractRateLimitTimestamp(result: string): number | null {
    const match = result.match(/Claude AI usage limit reached\|(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  }

  /**
   * 中断メッセージを作成する
   */
  createInterruptionMessage(
    sessionId: string,
    reason: "user_requested" | "timeout" | "system_error",
    executionTime?: number,
    lastActivity?: string,
  ): ClaudeStreamMessage {
    let content = "Claude Code実行が中断されました。";
    if (reason === "user_requested") {
      content = "ユーザーのリクエストによりClaude Code実行が中断されました。";
    } else if (reason === "timeout") {
      content = "タイムアウトによりClaude Code実行が中断されました。";
    } else if (reason === "system_error") {
      content = "システムエラーによりClaude Code実行が中断されました。";
    }

    if (executionTime !== undefined) {
      const seconds = Math.round(executionTime / 1000);
      content += ` (実行時間: ${seconds}秒)`;
    }

    if (lastActivity) {
      content += ` 最後のアクティビティ: ${lastActivity}`;
    }

    return {
      type: "error",
      result: content,
      is_error: true,
      session_id: sessionId,
    };
  }
}
