import { DISCORD, FORMATTING } from "../constants.ts";
import { validateTodoWriteInput } from "../schemas/external-api-schema.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

/**
 * メッセージフォーマット関連の責務を担当するクラス
 */
export class MessageFormatter {
  private readonly worktreePath?: string;

  constructor(worktreePath?: string) {
    this.worktreePath = worktreePath;
  }

  /**
   * Discordの文字数制限を考慮してレスポンスをフォーマット
   */
  formatResponse(response: string): string {
    const maxLength = DISCORD.TRUNCATE_LENGTH; // 余裕を持って少し短く

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

    return `${
      this.stripAnsiCodes(finalResponse)
    }\n\n*（応答が長いため、一部のみ表示しています）*`;
  }

  /**
   * ANSIエスケープシーケンスを除去
   */
  private stripAnsiCodes(text: string): string {
    // ANSIエスケープシーケンスを除去する正規表現
    // \x1b (ESC) は制御文字ですが、ANSIエスケープシーケンスの開始を示すため必要です
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSIエスケープシーケンスの処理に必要
    // deno-lint-ignore no-control-regex
    return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
  }

  /**
   * ツール使用を進捗メッセージとしてフォーマット
   */
  formatToolUse(item: Anthropic.Messages.ToolUseBlock): string | null {
    if (!item.name) return null;

    // TodoWriteツールの場合は特別処理
    if (item.name === "TodoWrite") {
      const todoWriteInput = item.input as {
        todos?: Array<{
          status: string;
          content: string;
        }>;
      };
      if (todoWriteInput?.todos && Array.isArray(todoWriteInput.todos)) {
        return this.formatTodoList(todoWriteInput.todos);
      }
      return null;
    }

    // その他のツール（Bash、Read、Write等）の場合
    const toolIcon = this.getToolIcon(item.name);
    const description = this.getToolDescription(
      item.name,
      item.input as Record<string, unknown>,
    );

    return `${toolIcon} **${item.name}**: ${description}`;
  }

  /**
   * ツール実行結果を長さと内容に応じてフォーマット
   */
  formatToolResult(content: string, isError: boolean): string {
    if (!content.trim()) {
      return "```\n(空の結果)\n```";
    }

    const maxLength = 1500; // Discord制限を考慮した最大長

    // 短い場合は全文表示
    if (content.length <= FORMATTING.SHORT_RESULT_THRESHOLD) {
      return `\`\`\`\n${content}\n\`\`\``;
    }

    // エラーの場合は特別処理
    if (isError) {
      return this.formatErrorResult(content, maxLength);
    }

    // 中程度の長さの場合
    if (content.length <= FORMATTING.LONG_RESULT_THRESHOLD) {
      return this.formatMediumResult(content, maxLength);
    }

    // 非常に長い場合はスマート要約
    return this.formatLongResult(content, maxLength);
  }

  /**
   * エラー結果をフォーマット
   */
  private formatErrorResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const errorLines: string[] = [];
    const importantLines: string[] = [];

    // エラーや重要な情報を含む行を抽出
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (
        lowerLine.includes("error") || lowerLine.includes("failed") ||
        lowerLine.includes("exception") || lowerLine.startsWith("fatal:")
      ) {
        errorLines.push(line);
      } else if (
        line.trim() && !lowerLine.includes("debug") &&
        !lowerLine.includes("info")
      ) {
        importantLines.push(line);
      }
    }

    // エラー行を優先して表示
    const displayLines = [...errorLines, ...importantLines.slice(0, 5)];
    const result = displayLines.join("\n");

    if (result.length <= maxLength) {
      return `\`\`\`\n${result}\n\`\`\``;
    }

    return `\`\`\`\n${
      result.substring(0, maxLength - 100)
    }...\n\n[${lines.length}行中の重要部分を表示]\n\`\`\``;
  }

  /**
   * 中程度の長さの結果をフォーマット
   */
  private formatMediumResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const headLines = lines.slice(0, 10).join("\n");
    const tailLines = lines.slice(-5).join("\n");

    const result = lines.length > 15
      ? `${headLines}\n\n... [${lines.length - 15}行省略] ...\n\n${tailLines}`
      : content;

    if (result.length <= maxLength) {
      return `\`\`\`\n${result}\n\`\`\``;
    }

    return `\`\`\`\n${result.substring(0, maxLength - 100)}...\n\`\`\``;
  }

  /**
   * 長い結果をスマート要約
   */
  private formatLongResult(content: string, maxLength: number): string {
    const lines = content.split("\n");
    const summary = this.extractSummaryInfo(content);

    if (summary) {
      const summaryDisplay = `📊 **要約:** ${summary}\n\`\`\`\n${
        lines.slice(0, 3).join("\n")
      }\n... [${lines.length}行の詳細結果] ...\n${
        lines.slice(-2).join("\n")
      }\n\`\`\``;

      // maxLengthを超える場合は更に短縮
      if (summaryDisplay.length > maxLength) {
        return `📊 **要約:** ${summary}\n\`\`\`\n${
          lines.slice(0, 2).join("\n")
        }\n... [${lines.length}行の結果] ...\n\`\`\``;
      }
      return summaryDisplay;
    }

    // 要約できない場合は先頭部分のみ
    const preview = lines.slice(0, 8).join("\n");
    const result =
      `\`\`\`\n${preview}\n\n... [全${lines.length}行中の先頭部分のみ表示] ...\n\`\`\``;

    // maxLengthを超える場合は更に短縮
    if (result.length > maxLength) {
      const shortPreview = lines.slice(0, 4).join("\n");
      return `\`\`\`\n${shortPreview}\n... [${lines.length}行の結果] ...\n\`\`\``;
    }

    return result;
  }

  /**
   * 内容から要約情報を抽出
   */
  private extractSummaryInfo(content: string): string | null {
    // gitコミット結果（ブランチ名を含む形式とハッシュのみの形式の両方に対応）
    const gitCommitMatch = content.match(/\[(?:[^\s]+\s+)?([a-f0-9]+)\] (.+)/);
    if (gitCommitMatch) {
      const filesChanged = content.match(/(\d+) files? changed/);
      const insertions = content.match(/(\d+) insertions?\(\+\)/);
      const deletions = content.match(/(\d+) deletions?\(-\)/);

      let summary = `コミット ${gitCommitMatch[1].substring(0, 7)}: ${
        gitCommitMatch[2]
      }`;
      if (filesChanged) {
        summary += ` (${filesChanged[1]}ファイル変更`;
        if (insertions) summary += `, +${insertions[1]}`;
        if (deletions) summary += `, -${deletions[1]}`;
        summary += ")";
      }
      return summary;
    }

    // テスト結果
    const testMatch = content.match(/(\d+) passed.*?(\d+) failed/);
    if (testMatch) {
      return `テスト結果: ${testMatch[1]}件成功, ${testMatch[2]}件失敗`;
    }

    // ファイル操作結果
    const fileCountMatch = content.match(/(\d+) files?/);
    if (fileCountMatch && content.includes("files")) {
      return `${fileCountMatch[1]}ファイルの操作完了`;
    }

    return null;
  }

  /**
   * TODOリストをチェックマーク付きリスト形式でフォーマット
   */
  formatTodoList(
    todos: Array<{
      status: string;
      content: string;
    }>,
  ): string {
    const todoList = todos.map((todo) => {
      const checkbox = todo.status === "completed"
        ? "✅"
        : todo.status === "in_progress"
        ? "🔄"
        : "⬜";
      return `${checkbox} ${todo.content}`;
    }).join("\n");

    return `📋 **TODOリスト更新:**\n${todoList}`;
  }

  /**
   * TODOリストの更新ログから変更後の状態を抽出
   */
  extractTodoListUpdate(textContent: string): string | null {
    try {
      // TodoWriteツールの使用を検出
      if (
        !textContent.includes('"name": "TodoWrite"') &&
        !textContent.includes("TodoWrite")
      ) {
        return null;
      }

      // JSONからtodosを抽出する正規表現
      const todoWriteMatch = textContent.match(/"todos":\s*(\[[\s\S]*?\])/);
      if (!todoWriteMatch) {
        return null;
      }

      // 安全なスキーマ検証でJSONをパース
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(todoWriteMatch[1]);
      } catch {
        return null;
      }

      // TodoWriteInputスキーマで検証
      const validatedInput = validateTodoWriteInput({ todos: parsedData });
      if (!validatedInput || validatedInput.todos.length === 0) {
        return null;
      }

      return this.formatTodoList(validatedInput.todos);
    } catch (_error) {
      // エラーの場合は通常の処理を続行
      return null;
    }
  }

  /**
   * TodoWrite成功メッセージかどうかを判定
   */
  isTodoWriteSuccessMessage(content: string): boolean {
    // TodoWrite成功時の定型文パターン
    const successPatterns = [
      "Todos have been modified successfully",
      "Todo list has been updated",
      "Todos updated successfully",
      "Task list updated successfully",
    ];

    return successPatterns.some((pattern) => content.includes(pattern));
  }

  /**
   * ファイルパスから作業ディレクトリを除外した相対パスを取得
   */
  private getRelativePath(filePath: string): string {
    if (!filePath) return "";

    // worktreePathが設定されている場合はそれを基準に
    if (
      this.worktreePath && filePath.startsWith(this.worktreePath)
    ) {
      return filePath.slice(this.worktreePath.length).replace(/^\//, "");
    }

    // worktreePathがない場合は、リポジトリのパスパターンを探す
    const repoPattern = /\/repositories\/[^\/]+\/[^\/]+\//;
    const match = filePath.match(repoPattern);
    if (match && match.index !== undefined) {
      // リポジトリディレクトリ以降のパスを返す
      return filePath.slice(match.index + match[0].length);
    }

    // threadsディレクトリのパターンも探す
    const threadsPattern = /\/threads\/[^\/]+\/worktree\//;
    const threadsMatch = filePath.match(threadsPattern);
    if (threadsMatch && threadsMatch.index !== undefined) {
      // worktreeディレクトリ以降のパスを返す
      return filePath.slice(threadsMatch.index + threadsMatch[0].length);
    }

    // それ以外はファイル名のみ返す
    return filePath.split("/").pop() || "";
  }

  /**
   * ツール名に対応するアイコンを取得
   */
  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      "Bash": "⚡",
      "Read": "📖",
      "Write": "✏️",
      "Edit": "🔧",
      "MultiEdit": "🔧",
      "Glob": "🔍",
      "Grep": "🔍",
      "LS": "📁",
      "Task": "🤖",
      "WebFetch": "🌐",
      "WebSearch": "🔎",
      "NotebookRead": "📓",
      "NotebookEdit": "📝",
      "TodoRead": "📋",
      "TodoWrite": "📋",
    };
    return iconMap[toolName] || "🔧";
  }

  /**
   * ツールの説明を生成
   */
  private getToolDescription(
    toolName: string,
    input?: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case "Bash": {
        const command = input?.command as string;
        const description = input?.description as string;
        if (description) {
          return description;
        }
        if (command) {
          // コマンドが長い場合は短縮
          return command.length > 50
            ? `${command.substring(0, 50)}...`
            : command;
        }
        return "コマンド実行";
      }
      case "Read":
        return `ファイル読み込み: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Write":
        return `ファイル書き込み: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Edit":
        return `ファイル編集: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "MultiEdit":
        return `ファイル一括編集: ${
          this.getRelativePath(input?.file_path as string || "")
        }`;
      case "Glob":
        return `ファイル検索: ${input?.pattern || ""}`;
      case "Grep":
        return `コンテンツ検索: ${input?.pattern || ""}`;
      case "LS":
        return `ディレクトリ一覧: ${
          this.getRelativePath(input?.path as string || "")
        }`;
      case "Task":
        return `エージェントタスク: ${input?.description || ""}`;
      case "WebFetch":
        return `Web取得: ${input?.url || ""}`;
      case "WebSearch":
        return `Web検索: ${input?.query || ""}`;
      case "NotebookRead":
        return `ノートブック読み込み: ${
          this.getRelativePath(input?.notebook_path as string || "")
        }`;
      case "NotebookEdit":
        return `ノートブック編集: ${
          this.getRelativePath(input?.notebook_path as string || "")
        }`;
      case "TodoRead":
        return "TODOリスト確認";
      default:
        return `${toolName}実行`;
    }
  }
}
