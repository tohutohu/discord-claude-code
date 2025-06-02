import { ensureDir, exists, join, parseYaml, resolve, z } from './deps.ts';

// 設定ファイルのスキーマ定義
const ConfigSchema = z.object({
  // Git リポジトリをキャッシュするルートディレクトリ
  rootDir: z.string().transform((val) => resolve(val.replace(/^~/, Deno.env.get('HOME') || ''))),

  // 並列実行設定
  parallel: z.object({
    maxSessions: z.number().min(1).max(10).default(3),
    queueTimeout: z.number().min(60).max(3600).default(300),
  }).default({}),

  // Discord設定
  discord: z.object({
    guildIds: z.array(z.string()).default([]),
    commandPrefix: z.string().default('/claude'),
  }).default({}),

  // Claude設定
  claude: z.object({
    model: z.string().default('claude-opus-4-20250514'),
    timeout: z.number().min(60).max(3600).default(600),
  }).default({}),

  // ログ設定
  logging: z.object({
    level: z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']).default('INFO'),
    retentionDays: z.number().min(1).max(365).default(7),
    maxFileSize: z.string().regex(/^\d+[KMG]B$/i).default('10MB'),
  }).default({}),

  // リポジトリ設定（オプション）
  repositories: z.record(z.string(), z.string()).default({}),
});

// 設定ファイルの型定義
export type Config = z.infer<typeof ConfigSchema>;

// デフォルト設定
const DEFAULT_CONFIG: Config = {
  rootDir: resolve(Deno.env.get('HOME') || '', 'claude-work', 'repos'),
  parallel: {
    maxSessions: 3,
    queueTimeout: 300,
  },
  discord: {
    guildIds: [],
    commandPrefix: '/claude',
  },
  claude: {
    model: 'claude-opus-4-20250514',
    timeout: 600,
  },
  logging: {
    level: 'INFO',
    retentionDays: 7,
    maxFileSize: '10MB',
  },
  repositories: {},
};

// 環境変数からのオーバーライド
function applyEnvironmentOverrides(config: Config): Config {
  const envOverrides: Partial<Config> = {};

  // rootDir
  const rootDir = Deno.env.get('CLAUDE_BOT_ROOT_DIR');
  if (rootDir) {
    envOverrides.rootDir = resolve(rootDir.replace(/^~/, Deno.env.get('HOME') || ''));
  }

  // parallel
  const maxSessions = Deno.env.get('CLAUDE_BOT_MAX_SESSIONS');
  if (maxSessions) {
    envOverrides.parallel = {
      ...config.parallel,
      maxSessions: parseInt(maxSessions, 10),
    };
  }

  // claude
  const claudeModel = Deno.env.get('CLAUDE_BOT_MODEL');
  if (claudeModel) {
    envOverrides.claude = {
      ...config.claude,
      model: claudeModel,
    };
  }

  // logging
  const logLevel = Deno.env.get('CLAUDE_BOT_LOG_LEVEL');
  if (logLevel && ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(logLevel)) {
    envOverrides.logging = {
      ...config.logging,
      level: logLevel as Config['logging']['level'],
    };
  }

  return { ...config, ...envOverrides };
}

// 設定ファイルの読み込み
export async function loadConfig(configPath?: string): Promise<Config> {
  let configData: Record<string, unknown> = {};

  // 設定ファイルパスの決定
  const actualConfigPath = configPath ||
    Deno.env.get('CLAUDE_BOT_CONFIG') ||
    './claude-bot.yaml';

  // 設定ファイルが存在する場合は読み込み
  if (await exists(actualConfigPath)) {
    try {
      const yamlContent = await Deno.readTextFile(actualConfigPath);
      const parsed = parseYaml(yamlContent);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        configData = parsed as Record<string, unknown>;
      }
    } catch (error) {
      throw new Error(
        `設定ファイルの読み込みに失敗しました: ${actualConfigPath}\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // デフォルト値とマージ
  const mergedConfig = { ...DEFAULT_CONFIG, ...configData };

  // スキーマ検証
  let parsedConfig: Config;
  try {
    parsedConfig = ConfigSchema.parse(mergedConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`設定ファイルの検証に失敗しました:\n${issues}`);
    }
    throw error;
  }

  // 環境変数によるオーバーライド
  const finalConfig = applyEnvironmentOverrides(parsedConfig);

  // 必要なディレクトリを作成
  await ensureDir(finalConfig.rootDir);
  await ensureDir(join(Deno.env.get('HOME') || '', '.claude-bot', 'logs'));

  return finalConfig;
}

// サンプル設定ファイルの生成
export async function generateSampleConfig(outputPath: string): Promise<void> {
  const sampleYaml = `# Git リポジトリをキャッシュするルートディレクトリ
rootDir: ~/claude-work/repos

# 並列実行設定
parallel:
  maxSessions: 3 # 最大同時実行セッション数
  queueTimeout: 300 # キュー待機タイムアウト（秒）

# Discord設定
discord:
  # ギルドIDを指定（省略時は全ギルドで有効）
  guildIds: []
  # コマンドのプレフィックス（省略時は /claude）
  commandPrefix: /claude

# Claude設定
claude:
  # モデル名（省略時はデフォルト）
  model: claude-opus-4-20250514
  # タイムアウト（秒）
  timeout: 600

# ログ設定
logging:
  level: INFO # TRACE, DEBUG, INFO, WARN, ERROR, FATAL
  retentionDays: 7
  maxFileSize: 10MB

# リポジトリ設定（オプション）
repositories: {}
  # リポジトリ名とURLのマッピング（自動検出に追加）
  # core-api: https://github.com/myorg/core-api.git
  # web-admin: https://github.com/myorg/web-admin.git
`;

  await Deno.writeTextFile(outputPath, sampleYaml);
}
