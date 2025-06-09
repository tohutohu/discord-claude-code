/**
 * システム要件を表すインターフェース
 *
 * Discord Botの実行に必要または推奨されるコマンドラインツールの
 * 要件を定義します。
 */
export interface SystemRequirement {
  /** チェック対象のコマンド名（例: "git", "claude"） */
  command: string;
  /** コマンドの説明（日本語でユーザーに表示される） */
  description: string;
  /** 必須コマンドかどうか（falseの場合は推奨コマンド） */
  required: boolean;
}

/**
 * システムチェックの結果を表すインターフェース
 *
 * 各コマンドの利用可能性とバージョン情報、
 * エラー情報を含むチェック結果を格納します。
 */
export interface SystemCheckResult {
  /** チェックしたコマンド名 */
  command: string;
  /** コマンドが利用可能かどうか */
  available: boolean;
  /** コマンドのバージョン情報（--versionの出力） */
  version?: string;
  /** エラーメッセージ（コマンドが利用不可の場合） */
  error?: string;
}

const REQUIRED_COMMANDS: SystemRequirement[] = [
  {
    command: "git",
    description: "Git version control system",
    required: true,
  },
  {
    command: "claude",
    description: "Claude CLI tool",
    required: true,
  },
];

const OPTIONAL_COMMANDS: SystemRequirement[] = [
  {
    command: "gh",
    description: "GitHub CLI (recommended for enhanced repository management)",
    required: false,
  },
  {
    command: "devcontainer",
    description: "Dev Container CLI (for development container support)",
    required: false,
  },
];

/**
 * システム要件をチェックする非同期関数
 *
 * Discord Botの実行に必要な必須コマンドと推奨コマンドの
 * 利用可能性をチェックします。各コマンドに対して`--version`を
 * 実行し、その結果を収集します。
 *
 * @returns チェック結果を含むオブジェクト
 * @returns {boolean} success - すべての必須コマンドが利用可能な場合true
 * @returns {SystemCheckResult[]} results - 各コマンドのチェック結果の配列
 * @returns {string[]} missingRequired - 不足している必須コマンド名の配列
 *
 * @example
 * ```typescript
 * const { success, results, missingRequired } = await checkSystemRequirements();
 * if (!success) {
 *   console.error(`必須コマンドが不足: ${missingRequired.join(", ")}`);
 *   process.exit(1);
 * }
 * ```
 */
export async function checkSystemRequirements(): Promise<{
  success: boolean;
  results: SystemCheckResult[];
  missingRequired: string[];
}> {
  const results: SystemCheckResult[] = [];
  const missingRequired: string[] = [];

  // 必須コマンドのチェック
  for (const requirement of REQUIRED_COMMANDS) {
    const result = await checkCommand(requirement.command);
    results.push(result);

    if (!result.available) {
      missingRequired.push(requirement.command);
    }
  }

  // オプションコマンドのチェック
  for (const requirement of OPTIONAL_COMMANDS) {
    const result = await checkCommand(requirement.command);
    results.push(result);
  }

  return {
    success: missingRequired.length === 0,
    results,
    missingRequired,
  };
}

/**
 * 指定されたコマンドの利用可能性をチェックする非同期関数
 *
 * コマンドに`--version`引数を付けて実行し、その結果から
 * コマンドの利用可能性とバージョン情報を取得します。
 * コマンドが見つからない場合やエラーが発生した場合は、
 * 適切なエラー情報を含む結果を返します。
 *
 * @param command - チェック対象のコマンド名
 * @returns コマンドのチェック結果
 *
 * @example
 * ```typescript
 * const result = await checkCommand("git");
 * if (result.available) {
 *   console.log(`Git version: ${result.version}`);
 * } else {
 *   console.error(`Git not found: ${result.error}`);
 * }
 * ```
 */
async function checkCommand(command: string): Promise<SystemCheckResult> {
  try {
    const process = new Deno.Command(command, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await process.output();

    if (result.success) {
      const version = new TextDecoder().decode(result.stdout).trim();
      return {
        command,
        available: true,
        version,
      };
    } else {
      const error = new TextDecoder().decode(result.stderr).trim();
      return {
        command,
        available: false,
        error,
      };
    }
  } catch (error) {
    return {
      command,
      available: false,
      error: (error as Error).message,
    };
  }
}

/**
 * システムチェック結果を人間が読みやすい形式にフォーマットする関数
 *
 * チェック結果を必須コマンドと推奨コマンドに分けて表示し、
 * 各コマンドの利用可能性を絵文字（✅/❌/⚠️）で示します。
 * 必須コマンドが不足している場合は、インストール方法の
 * 案内も含めて表示します。
 *
 * @param results - 各コマンドのチェック結果の配列
 * @param missingRequired - 不足している必須コマンド名の配列
 * @returns フォーマットされた結果の文字列（改行区切り）
 *
 * @example
 * ```typescript
 * const { results, missingRequired } = await checkSystemRequirements();
 * const formatted = formatSystemCheckResults(results, missingRequired);
 * console.log(formatted);
 * // 出力例:
 * // システム要件チェック結果:
 * //
 * // 【必須コマンド】
 * //   ✅ git (git version 2.40.0)
 * //   ❌ claude
 * //       エラー: Command not found
 * //
 * // 【推奨コマンド】
 * //   ⚠️ gh
 * //       GitHub CLI (recommended for enhanced repository management)
 * ```
 */
export function formatSystemCheckResults(
  results: SystemCheckResult[],
  missingRequired: string[],
): string {
  const lines: string[] = [];

  lines.push("システム要件チェック結果:");
  lines.push("");

  // 必須コマンド
  lines.push("【必須コマンド】");
  for (const requirement of REQUIRED_COMMANDS) {
    const result = results.find((r) => r.command === requirement.command);
    if (result) {
      const status = result.available ? "✅" : "❌";
      const versionInfo = result.version ? ` (${result.version})` : "";
      lines.push(`  ${status} ${requirement.command}${versionInfo}`);
      if (!result.available && result.error) {
        lines.push(`      エラー: ${result.error}`);
      }
    }
  }

  lines.push("");

  // オプションコマンド
  lines.push("【推奨コマンド】");
  for (const requirement of OPTIONAL_COMMANDS) {
    const result = results.find((r) => r.command === requirement.command);
    if (result) {
      const status = result.available ? "✅" : "⚠️";
      const versionInfo = result.version ? ` (${result.version})` : "";
      lines.push(`  ${status} ${requirement.command}${versionInfo}`);
      if (!result.available) {
        lines.push(`      ${requirement.description}`);
      }
    }
  }

  if (missingRequired.length > 0) {
    lines.push("");
    lines.push("❌ 以下の必須コマンドが見つかりません:");
    for (const command of missingRequired) {
      const requirement = REQUIRED_COMMANDS.find((r) => r.command === command);
      lines.push(`   - ${command}: ${requirement?.description}`);
    }
    lines.push("");
    lines.push("インストール方法:");
    lines.push("  - Git: https://git-scm.com/downloads");
    lines.push(
      "  - Claude CLI: https://docs.anthropic.com/en/docs/claude-code",
    );
  }

  return lines.join("\n");
}
