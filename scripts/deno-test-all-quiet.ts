#!/usr/bin/env -S deno run --allow-run --allow-env

/**
 * すべてのテスト・検証コマンドを実行するラッパースクリプト
 * 成功時の出力を最小限に抑えてトークン数を節約する
 */

interface CommandResult {
  name: string;
  success: boolean;
  message: string;
}

async function runCommand(
  name: string,
  args: string[],
): Promise<CommandResult> {
  console.log(`🔄 Running ${name}...`);

  const command = new Deno.Command("deno", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  const decoder = new TextDecoder();
  const stdoutText = decoder.decode(stdout);
  const stderrText = decoder.decode(stderr);

  if (code !== 0) {
    console.error(`❌ ${name} failed:`);
    if (stdoutText) console.log(stdoutText);
    if (stderrText) console.error(stderrText);
    return { name, success: false, message: "Failed" };
  }

  return { name, success: true, message: "Passed" };
}

// すべてのコマンドを実行
const results: CommandResult[] = [];

// format check
results.push(await runCommand("Format", ["fmt", "--check", "-q"]));
if (!results[results.length - 1].success) Deno.exit(1);

// lint
results.push(await runCommand("Lint", ["lint", "-q"]));
if (!results[results.length - 1].success) Deno.exit(1);

// type check
results.push(await runCommand("Type check", ["check", "**/*.ts", "-q"]));
if (!results[results.length - 1].success) Deno.exit(1);

// test
results.push(
  await runCommand("Test", [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-net",
    "--allow-run",
    "-q",
  ]),
);
if (!results[results.length - 1].success) Deno.exit(1);

// サマリー表示
console.log("\n✅ All checks passed!");
for (const result of results) {
  console.log(`  • ${result.name}: ${result.success ? "✅" : "❌"}`);
}
