import { assertEquals } from './deps.ts';

// CLIのテストヘルパー関数
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // 絶対パスでcli.tsを参照
  const cliPath = new URL('./cli.ts', import.meta.url).pathname;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', cliPath, ...args],
    stdout: 'piped',
    stderr: 'piped',
  });

  const output = await cmd.output();
  const decoder = new TextDecoder();

  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

Deno.test('CLIサブコマンド', async (t) => {
  await t.step('versionコマンドがバージョン情報を表示する', async () => {
    const result = await runCli(['version']);
    if (result.code !== 0) {
      console.log('stdout:', result.stdout);
      console.log('stderr:', result.stderr);
    }
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('Claude Bot v0.1.0-dev'), true);
    assertEquals(result.stdout.includes('Deno'), true);
    assertEquals(result.stdout.includes('V8'), true);
    assertEquals(result.stdout.includes('TypeScript'), true);
  });

  await t.step('helpコマンドがヘルプを表示する', async () => {
    const result = await runCli(['help']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('Discord から Claude Code を並列操作するツール'), true);
    assertEquals(result.stdout.includes('run'), true);
    assertEquals(result.stdout.includes('list'), true);
    assertEquals(result.stdout.includes('end'), true);
    assertEquals(result.stdout.includes('clean'), true);
  });

  await t.step('listコマンドが動作する', async () => {
    const result = await runCli(['list']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('アクティブなセッション'), true);
  });

  await t.step('list --jsonがJSON形式で出力する', async () => {
    const result = await runCli(['list', '--json']);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json.sessions), true);
    assertEquals(json.message, 'セッション管理は PR-4 で実装予定');
  });

  await t.step('endコマンドがスレッドIDを受け取る', async () => {
    const result = await runCli(['end', 'test-thread-123']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('test-thread-123'), true);
  });

  await t.step('cleanコマンドが--forceなしで警告を表示する', async () => {
    const result = await runCli(['clean']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('--force'), true);
  });

  await t.step('clean --forceが実行される', async () => {
    const result = await runCli(['clean', '--force']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('クリーンアップ中'), true);
  });

  await t.step('不明なコマンドでエラーを表示する', async () => {
    const result = await runCli(['unknown-command']);
    if (result.code !== 2) {
      console.log('stdout:', result.stdout);
      console.log('stderr:', result.stderr);
      console.log('code:', result.code);
    }
    assertEquals(result.code, 2); // Cliffyは不明なコマンドで2を返す
    assertEquals(
      result.stderr.includes('Unknown command') || result.stdout.includes('Unknown command'),
      true,
    );
  });
});

Deno.test('グローバルオプション', async (t) => {
  await t.step('--versionがバージョンを表示する', async () => {
    const result = await runCli(['--version']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('0.1.0-dev'), true);
  });

  await t.step('--helpがヘルプを表示する', async () => {
    const result = await runCli(['--help']);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.includes('Discord から Claude Code を並列操作するツール'), true);
  });
});

Deno.test('init-configサブコマンド', async (t) => {
  await t.step('デフォルトパスにサンプル設定ファイルを生成する', async () => {
    const tempDir = await Deno.makeTempDir();
    const originalCwd = Deno.cwd();

    try {
      Deno.chdir(tempDir);
      const result = await runCli(['init-config']);
      if (result.code !== 0) {
        console.log('stdout:', result.stdout);
        console.log('stderr:', result.stderr);
        console.log('code:', result.code);
      }
      assertEquals(result.code, 0);
      assertEquals(result.stdout.includes('サンプル設定ファイルを生成しました'), true);

      // ファイルが作成されたことを確認
      const fileInfo = await Deno.stat('./claude-bot.example.yaml');
      assertEquals(fileInfo.isFile, true);
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step('指定したパスにサンプル設定ファイルを生成する', async () => {
    const tempFile = await Deno.makeTempFile({ suffix: '.yaml' });

    try {
      const result = await runCli(['init-config', tempFile]);
      assertEquals(result.code, 0);
      assertEquals(result.stdout.includes(tempFile), true);

      // ファイルの内容を確認
      const content = await Deno.readTextFile(tempFile);
      assertEquals(content.includes('rootDir:'), true);
      assertEquals(content.includes('parallel:'), true);
    } finally {
      await Deno.remove(tempFile);
    }
  });
});
