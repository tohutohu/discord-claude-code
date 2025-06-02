import { assertEquals, assertRejects, exists } from './deps.ts';
import { generateSampleConfig, loadConfig } from './config.ts';

Deno.test('設定ファイルの読み込み', async (t) => {
  await t.step('設定ファイルが存在しない場合、デフォルト設定が返される', async () => {
    const config = await loadConfig('./non-existent-config.yaml');
    assertEquals(config.parallel.maxSessions, 3);
    assertEquals(config.logging.level, 'INFO');
    assertEquals(config.claude.model, 'claude-opus-4-20250514');
  });

  await t.step('環境変数によるオーバーライドが機能する', async () => {
    // 環境変数を設定
    Deno.env.set('CLAUDE_BOT_MAX_SESSIONS', '5');
    Deno.env.set('CLAUDE_BOT_LOG_LEVEL', 'DEBUG');
    Deno.env.set('CLAUDE_BOT_MODEL', 'claude-3-opus-20240229');

    try {
      const config = await loadConfig('./non-existent-config.yaml');
      assertEquals(config.parallel.maxSessions, 5);
      assertEquals(config.logging.level, 'DEBUG');
      assertEquals(config.claude.model, 'claude-3-opus-20240229');
    } finally {
      // 環境変数をクリーンアップ
      Deno.env.delete('CLAUDE_BOT_MAX_SESSIONS');
      Deno.env.delete('CLAUDE_BOT_LOG_LEVEL');
      Deno.env.delete('CLAUDE_BOT_MODEL');
    }
  });

  await t.step('無効な設定値の場合、エラーが発生する', async () => {
    // 一時的な設定ファイルを作成
    const tempConfigPath = await Deno.makeTempFile({ suffix: '.yaml' });
    await Deno.writeTextFile(
      tempConfigPath,
      `
parallel:
  maxSessions: 100  # 最大値10を超えている
logging:
  level: INVALID    # 無効なログレベル
`,
    );

    try {
      await assertRejects(
        async () => await loadConfig(tempConfigPath),
        Error,
        '設定ファイルの検証に失敗しました',
      );
    } finally {
      // 一時ファイルを削除
      await Deno.remove(tempConfigPath);
    }
  });

  await t.step('YAMLパースエラーの場合、適切なエラーメッセージが表示される', async () => {
    // 一時的な設定ファイルを作成
    const tempConfigPath = await Deno.makeTempFile({ suffix: '.yaml' });
    await Deno.writeTextFile(
      tempConfigPath,
      `
invalid yaml:
  - missing value
  key without value:
`,
    );

    try {
      await assertRejects(
        async () => await loadConfig(tempConfigPath),
        Error,
        '設定ファイルの読み込みに失敗しました',
      );
    } finally {
      // 一時ファイルを削除
      await Deno.remove(tempConfigPath);
    }
  });
});

Deno.test('サンプル設定ファイルの生成', async () => {
  const tempFilePath = await Deno.makeTempFile({ suffix: '.yaml' });

  try {
    await generateSampleConfig(tempFilePath);

    // ファイルが作成されたことを確認
    assertEquals(await exists(tempFilePath), true);

    // 生成されたファイルを読み込んで検証
    const config = await loadConfig(tempFilePath);
    assertEquals(config.parallel.maxSessions, 3);
    assertEquals(config.logging.retentionDays, 7);
  } finally {
    // 一時ファイルを削除
    await Deno.remove(tempFilePath);
  }
});

Deno.test('ホームディレクトリの展開', async () => {
  const tempConfigPath = await Deno.makeTempFile({ suffix: '.yaml' });
  await Deno.writeTextFile(
    tempConfigPath,
    `
rootDir: ~/test-repos
`,
  );

  try {
    const config = await loadConfig(tempConfigPath);
    const expectedPath = `${Deno.env.get('HOME')}/test-repos`;
    assertEquals(config.rootDir, expectedPath);
  } finally {
    await Deno.remove(tempConfigPath);
  }
});
