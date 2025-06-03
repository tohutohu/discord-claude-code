/**
 * 設定管理のテスト
 */

import { assertEquals, assertExists, assertRejects } from './deps.ts';
import { generateSampleConfig, loadConfig } from './config.ts';
import { withTempDir, withTempFile } from './types/test-utils.ts';

Deno.test('Config: デフォルト設定で読み込み', async () => {
  // 設定ファイルが存在しない場合、デフォルト設定が使用される
  const config = await loadConfig('/non-existent-config.yaml');

  assertExists(config);
  assertEquals(config.parallel.maxSessions, 3);
  assertEquals(config.parallel.queueTimeout, 300);
  assertEquals(config.discord.commandPrefix, '/claude');
  assertEquals(config.claude.model, 'claude-opus-4-20250514');
  assertEquals(config.claude.timeout, 600);
  assertEquals(config.logging.level, 'INFO');
  assertEquals(config.logging.retentionDays, 7);
  assertEquals(config.logging.maxFileSize, '10MB');
});

Deno.test('Config: YAMLファイルから設定を読み込み', async () => {
  const yamlContent = `
rootDir: /tmp/test-repos
parallel:
  maxSessions: 5
  queueTimeout: 600
discord:
  guildIds:
    - "123456789"
    - "987654321"
  commandPrefix: /bot
claude:
  model: claude-3-opus-20240229
  timeout: 900
logging:
  level: DEBUG
  retentionDays: 14
  maxFileSize: 20MB
repositories:
  test-repo: https://github.com/test/repo.git
`;

  await withTempFile(yamlContent, async (configPath) => {
    const config = await loadConfig(configPath);

    assertEquals(config.rootDir, '/tmp/test-repos');
    assertEquals(config.parallel.maxSessions, 5);
    assertEquals(config.parallel.queueTimeout, 600);
    assertEquals(config.discord.guildIds, ['123456789', '987654321']);
    assertEquals(config.discord.commandPrefix, '/bot');
    assertEquals(config.claude.model, 'claude-3-opus-20240229');
    assertEquals(config.claude.timeout, 900);
    assertEquals(config.logging.level, 'DEBUG');
    assertEquals(config.logging.retentionDays, 14);
    assertEquals(config.logging.maxFileSize, '20MB');
    assertEquals(config.repositories['test-repo'], 'https://github.com/test/repo.git');
  });
});

Deno.test('Config: 部分的な設定でデフォルト値が適用される', async () => {
  await withTempDir(async (tempDir) => {
    const yamlContent = `
rootDir: ${tempDir}/custom/path
parallel:
  maxSessions: 8
`;

    await withTempFile(yamlContent, async (configPath) => {
      const config = await loadConfig(configPath);

      // 指定された値
      assertEquals(config.rootDir, `${tempDir}/custom/path`);
      assertEquals(config.parallel.maxSessions, 8);

      // デフォルト値
      assertEquals(config.parallel.queueTimeout, 300);
      assertEquals(config.discord.commandPrefix, '/claude');
      assertEquals(config.claude.model, 'claude-opus-4-20250514');
      assertEquals(config.logging.level, 'INFO');
    });
  });
});

Deno.test('Config: 環境変数によるオーバーライド', async () => {
  await withTempDir(async (tempDir) => {
    const originalEnv = {
      CLAUDE_BOT_ROOT_DIR: Deno.env.get('CLAUDE_BOT_ROOT_DIR'),
      CLAUDE_BOT_MAX_SESSIONS: Deno.env.get('CLAUDE_BOT_MAX_SESSIONS'),
      CLAUDE_BOT_MODEL: Deno.env.get('CLAUDE_BOT_MODEL'),
      CLAUDE_BOT_LOG_LEVEL: Deno.env.get('CLAUDE_BOT_LOG_LEVEL'),
    };

    try {
      // 環境変数を設定
      Deno.env.set('CLAUDE_BOT_ROOT_DIR', `${tempDir}/env/override/path`);
      Deno.env.set('CLAUDE_BOT_MAX_SESSIONS', '10');
      Deno.env.set('CLAUDE_BOT_MODEL', 'claude-env-model');
      Deno.env.set('CLAUDE_BOT_LOG_LEVEL', 'DEBUG');

      const config = await loadConfig('/non-existent-config.yaml');

      assertEquals(config.rootDir, `${tempDir}/env/override/path`);
      assertEquals(config.parallel.maxSessions, 10);
      assertEquals(config.claude.model, 'claude-env-model');
      assertEquals(config.logging.level, 'DEBUG');
    } finally {
      // 環境変数を元に戻す
      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) {
          Deno.env.delete(key);
        } else {
          Deno.env.set(key, value);
        }
      });
    }
  });
});

Deno.test('Config: 無効なYAMLファイルでエラー', async () => {
  const invalidYaml = `
invalid: yaml: content
  - not proper
  indentation:
`;

  await withTempFile(invalidYaml, async (configPath) => {
    await assertRejects(
      async () => await loadConfig(configPath),
      Error,
      '設定ファイルの読み込みに失敗しました',
    );
  });
});

Deno.test('Config: スキーマ検証エラー', async () => {
  const invalidConfig = `
parallel:
  maxSessions: 0  # 最小値は1
  queueTimeout: 5000  # 最大値は3600
logging:
  level: INVALID_LEVEL
  maxFileSize: 10  # 正規表現パターンに一致しない
`;

  await withTempFile(invalidConfig, async (configPath) => {
    await assertRejects(
      async () => await loadConfig(configPath),
      Error,
      '設定ファイルの検証に失敗しました',
    );
  });
});

Deno.test('Config: ホームディレクトリの展開', async () => {
  const homeDir = Deno.env.get('HOME') || '';
  const yamlContent = `
rootDir: ~/test-repos
`;

  await withTempFile(yamlContent, async (configPath) => {
    const config = await loadConfig(configPath);

    assertEquals(config.rootDir, `${homeDir}/test-repos`);
  });
});

Deno.test('Config: サンプル設定ファイルの生成', async () => {
  await withTempDir(async (tempDir) => {
    const samplePath = `${tempDir}/sample-config.yaml`;

    await generateSampleConfig(samplePath);

    // ファイルが生成されたことを確認
    const stat = await Deno.stat(samplePath);
    assertEquals(stat.isFile, true);

    // 内容を確認
    const content = await Deno.readTextFile(samplePath);
    assertExists(content);
    assertEquals(content.includes('rootDir:'), true);
    assertEquals(content.includes('parallel:'), true);
    assertEquals(content.includes('discord:'), true);
    assertEquals(content.includes('claude:'), true);
    assertEquals(content.includes('logging:'), true);
    assertEquals(content.includes('repositories:'), true);

    // 生成された設定ファイルが有効であることを確認
    const config = await loadConfig(samplePath);
    assertExists(config);
  });
});

Deno.test('Config: 必要なディレクトリが作成される', async () => {
  await withTempDir(async (tempDir) => {
    const yamlContent = `
rootDir: ${tempDir}/repos
`;

    await withTempFile(yamlContent, async (configPath) => {
      const config = await loadConfig(configPath);

      // rootDirが作成されたことを確認
      const stat = await Deno.stat(config.rootDir);
      assertEquals(stat.isDirectory, true);
    });
  });
});

Deno.test('Config: CLAUDE_BOT_CONFIGが使用される', async () => {
  const originalConfigEnv = Deno.env.get('CLAUDE_BOT_CONFIG');

  const yamlContent = `
parallel:
  maxSessions: 7
`;

  try {
    await withTempFile(yamlContent, async (configPath) => {
      Deno.env.set('CLAUDE_BOT_CONFIG', configPath);

      // configPathを指定しなくても環境変数から読み込まれる
      const config = await loadConfig();

      assertEquals(config.parallel.maxSessions, 7);
    });
  } finally {
    if (originalConfigEnv === undefined) {
      Deno.env.delete('CLAUDE_BOT_CONFIG');
    } else {
      Deno.env.set('CLAUDE_BOT_CONFIG', originalConfigEnv);
    }
  }
});
