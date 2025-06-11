import { MessageFormatter } from "./message-formatter.ts";

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
}
