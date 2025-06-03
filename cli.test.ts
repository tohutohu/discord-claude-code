/**
 * CLIテスト
 */

import { assertEquals, assertExists, assertStringIncludes } from './deps.ts';
// テストユーティリティは必要に応じて使用

/**
 * CLIを実行してテストする
 */
async function runCli(args: string[]): Promise<{
  output: string;
  errorOutput: string;
  exitCode?: number | undefined;
  success: boolean;
}> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', 'cli.ts', ...args],
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();

  // タイムアウトを設定（2秒）
  const timeout = setTimeout(() => {
    try {
      process.kill();
    } catch {
      // プロセスが既に終了している場合は無視
    }
  }, 2000);

  const output = await process.output();
  clearTimeout(timeout);

  const outputText = new TextDecoder().decode(output.stdout);
  const errorText = new TextDecoder().decode(output.stderr);

  return {
    output: outputText,
    errorOutput: errorText,
    exitCode: output.code,
    success: output.success,
  };
}

Deno.test('CLI: versionコマンドでバージョン情報を表示', async () => {
  const result = await runCli(['version']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'Claude Bot v');
  assertStringIncludes(result.output, 'Deno ');
  assertStringIncludes(result.output, 'V8 ');
  assertStringIncludes(result.output, 'TypeScript ');
});

Deno.test('CLI: helpコマンドでヘルプを表示', async () => {
  const result = await runCli(['help']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'Claude Code');
  assertStringIncludes(result.output, 'run');
  assertStringIncludes(result.output, 'list');
  assertStringIncludes(result.output, 'end');
  assertStringIncludes(result.output, 'clean');
  assertStringIncludes(result.output, 'init-config');
  assertStringIncludes(result.output, 'version');
});

Deno.test('CLI: listコマンドでセッション一覧を表示（通常形式）', async () => {
  const result = await runCli(['list']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'アクティブなセッション');
  assertStringIncludes(result.output, 'PR-4 で実装予定');
});

Deno.test('CLI: listコマンドでセッション一覧を表示（JSON形式）', async () => {
  const result = await runCli(['list', '--json']);

  assertEquals(result.success, true);
  const json = JSON.parse(result.output);
  assertExists(json.sessions);
  assertEquals(Array.isArray(json.sessions), true);
  assertStringIncludes(json.message, 'PR-4 で実装予定');
});

Deno.test('CLI: endコマンドでセッションを終了', async () => {
  const result = await runCli(['end', 'thread-123']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'thread-123');
  assertStringIncludes(result.output, '終了しています');
  assertStringIncludes(result.output, 'PR-4 で実装予定');
});

Deno.test('CLI: cleanコマンド（確認なし）', async () => {
  const result = await runCli(['clean']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, '終了済みセッション');
  assertStringIncludes(result.output, '--force');
});

Deno.test('CLI: cleanコマンド（--forceオプション付き）', async () => {
  const result = await runCli(['clean', '--force']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'クリーンアップ中');
  assertStringIncludes(result.output, 'PR-4 で実装予定');
});

Deno.test('CLI: init-configコマンドで設定ファイルを生成', async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/test-config.yaml`;

  try {
    const result = await runCli(['init-config', configPath]);

    assertEquals(result.success, true);
    assertStringIncludes(result.output, 'サンプル設定ファイルを生成しました');

    // ファイルが作成されたことを確認
    const stat = await Deno.stat(configPath);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('CLI: 引数なしで実行するとrunコマンドが実行される', async () => {
  // デフォルトの設定ファイルが存在しない前提で、引数なしで実行
  const result = await runCli([]);

  // タイムアウトで終了するため、exitCode は 143 (SIGTERM)
  assertEquals(result.exitCode, 143);
  // TUIの起動メッセージを確認（デフォルト設定で起動）
  assertStringIncludes(result.output, 'TUIモードが起動しました');
});

Deno.test('CLI: runコマンドで存在しない設定ファイルでもデフォルト設定で起動', async () => {
  const result = await runCli(['run', '--config', '/non-existent-file.yaml']);

  // タイムアウトで終了するため、exitCode は 143 (SIGTERM)
  assertEquals(result.exitCode, 143);
  // TUIの起動メッセージを確認（デフォルト設定で起動）
  assertStringIncludes(result.output, 'TUIモードが起動しました');
});

Deno.test('CLI: グローバルオプション --verbose', async () => {
  const result = await runCli(['--verbose', 'version']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'Claude Bot v');
});

Deno.test('CLI: グローバルオプション --quiet', async () => {
  const result = await runCli(['--quiet', 'version']);

  assertEquals(result.success, true);
  assertStringIncludes(result.output, 'Claude Bot v');
});

Deno.test('CLI: 不明なコマンドでエラー', async () => {
  const result = await runCli(['unknown-command']);

  assertEquals(result.success, false);
  assertStringIncludes(result.errorOutput, 'Unknown command');
});
