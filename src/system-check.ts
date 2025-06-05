export interface SystemRequirement {
  command: string;
  description: string;
  required: boolean;
}

export interface SystemCheckResult {
  command: string;
  available: boolean;
  version?: string;
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
