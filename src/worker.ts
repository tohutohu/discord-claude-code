import { GitRepository } from "./git-utils.ts";
import { SessionLog, WorkspaceManager } from "./workspace.ts";

interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id: string;
    type: string;
    role: string;
    model: string;
    content: Array<{
      type: string;
      text?: string;
    }>;
    stop_reason: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  result?: string;
  is_error?: boolean;
}

export interface ClaudeCommandExecutor {
  execute(
    args: string[],
    cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

class DefaultClaudeCommandExecutor implements ClaudeCommandExecutor {
  async execute(
    args: string[],
    cwd: string,
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const command = new Deno.Command("claude", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    return { code, stdout, stderr };
  }
}

export interface IWorker {
  processMessage(message: string): Promise<string>;
  getName(): string;
  getRepository(): GitRepository | null;
  setRepository(repository: GitRepository, localPath: string): void;
  setThreadId(threadId: string): void;
}

export class Worker implements IWorker {
  private readonly name: string;
  private repository: GitRepository | null = null;
  private localPath: string | null = null;
  private sessionId: string | null = null;
  private threadId: string | null = null;
  private readonly claudeExecutor: ClaudeCommandExecutor;
  private readonly workspaceManager: WorkspaceManager;

  constructor(
    name: string,
    workspaceManager: WorkspaceManager,
    claudeExecutor?: ClaudeCommandExecutor,
  ) {
    this.name = name;
    this.workspaceManager = workspaceManager;
    this.claudeExecutor = claudeExecutor || new DefaultClaudeCommandExecutor();
  }

  async processMessage(message: string): Promise<string> {
    if (!this.repository || !this.localPath) {
      return "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。";
    }

    try {
      // セッションログの記録（コマンド）
      if (this.threadId) {
        await this.logSessionActivity("command", message);
      }

      const result = await this.executeClaude(message);
      const formattedResponse = this.formatResponse(result);

      // セッションログの記録（レスポンス）
      if (this.threadId) {
        await this.logSessionActivity("response", formattedResponse);
      }

      return formattedResponse;
    } catch (error) {
      console.error(`Worker ${this.name} - Claude実行エラー:`, error);
      const errorMessage = `エラーが発生しました: ${(error as Error).message}`;

      // エラーもセッションログに記録
      if (this.threadId) {
        await this.logSessionActivity("error", errorMessage, {
          originalError: (error as Error).message,
          stack: (error as Error).stack,
        });
      }

      return errorMessage;
    }
  }

  private async executeClaude(prompt: string): Promise<string> {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    // セッション継続の場合
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    const { code, stdout, stderr } = await this.claudeExecutor.execute(
      args,
      this.localPath!,
    );

    if (code !== 0) {
      const errorMessage = new TextDecoder().decode(stderr);
      throw new Error(`Claude実行失敗 (終了コード: ${code}): ${errorMessage}`);
    }

    const output = new TextDecoder().decode(stdout);
    return this.parseStreamJsonOutput(output);
  }

  private parseStreamJsonOutput(output: string): string {
    const lines = output.trim().split("\n");
    let result = "";
    let newSessionId: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed: ClaudeStreamMessage = JSON.parse(line);

        // セッションIDを更新
        if (parsed.session_id) {
          newSessionId = parsed.session_id;
        }

        // アシスタントメッセージからテキストを抽出
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === "text" && content.text) {
              result += content.text;
            }
          }
        }

        // 最終結果を取得
        if (parsed.type === "result" && parsed.result) {
          result = parsed.result;
        }
      } catch (parseError) {
        console.warn(`JSON解析エラー: ${parseError}, 行: ${line}`);
        // JSON解析できない行はそのまま結果に含める
        result += line + "\n";
      }
    }

    // セッションIDを更新
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    return result.trim() || "Claude からの応答を取得できませんでした。";
  }

  private formatResponse(response: string): string {
    // Discordの文字数制限（2000文字）を考慮
    const maxLength = 1900; // 余裕を持って少し短く

    if (response.length <= maxLength) {
      // ANSIエスケープシーケンスを除去
      return this.stripAnsiCodes(response);
    }

    // 長すぎる場合は分割して最初の部分だけ返す
    const truncated = response.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf("\n");

    // 改行で綺麗に切れる位置があれば、そこで切る
    const finalResponse = lastNewline > maxLength * 0.8
      ? truncated.substring(0, lastNewline)
      : truncated;

    return this.stripAnsiCodes(finalResponse) +
      "\n\n*（応答が長いため、一部のみ表示しています）*";
  }

  private stripAnsiCodes(text: string): string {
    // ANSIエスケープシーケンスを除去する正規表現
    // deno-lint-ignore no-control-regex
    return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
  }

  getName(): string {
    return this.name;
  }

  getRepository(): GitRepository | null {
    return this.repository;
  }

  setRepository(repository: GitRepository, localPath: string): void {
    this.repository = repository;
    this.localPath = localPath;
    // 新しいリポジトリが設定された場合、セッションIDをリセット
    this.sessionId = null;
  }

  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }

  private async logSessionActivity(
    type: "command" | "response" | "error",
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.threadId) return;

    const sessionLog: SessionLog = {
      sessionId: this.sessionId || "no-session",
      threadId: this.threadId,
      timestamp: new Date().toISOString(),
      type,
      content,
      metadata: {
        ...metadata,
        repository: this.repository?.fullName,
        workerName: this.name,
      },
    };

    try {
      await this.workspaceManager.saveSessionLog(sessionLog);
    } catch (error) {
      console.error("セッションログの保存に失敗しました:", error);
    }
  }
}
