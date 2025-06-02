/**
 * 設定ファイルの読み込みと管理
 */

import { assertEquals, assertThrows, fs, path, yaml } from './deps.ts';
import { Config, DEFAULT_CONFIG, LogLevel } from './types/config.ts';

/** 設定ファイルのデフォルトパス */
const DEFAULT_CONFIG_PATH = path.join(
  Deno.env.get('HOME') || '~',
  '.claude-bot',
  'claude-bot.yaml',
);

/**
 * 設定ファイルを読み込む
 * @param configPath 設定ファイルのパス（省略時はデフォルトパス）
 * @returns 設定オブジェクト
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const filePath = configPath || DEFAULT_CONFIG_PATH;

  try {
    // 設定ファイルが存在しない場合はデフォルト設定を返す
    if (!await fs.exists(filePath)) {
      console.warn(`設定ファイルが見つかりません: ${filePath}`);
      console.info('デフォルト設定を使用します');
      return applyEnvironmentOverrides(DEFAULT_CONFIG);
    }

    // YAMLファイルを読み込む
    const content = await Deno.readTextFile(filePath);
    const parsed = yaml.parse(content) as Partial<Config>;

    // デフォルト値とマージ
    const config = mergeConfig(DEFAULT_CONFIG, parsed);

    // 環境変数でオーバーライド
    return applyEnvironmentOverrides(config);
  } catch (error) {
    console.error(`設定ファイルの読み込みエラー: ${error}`);
    throw error;
  }
}

/**
 * 設定をディープマージする
 * @param defaults デフォルト設定
 * @param overrides 上書き設定
 * @returns マージされた設定
 */
function mergeConfig(defaults: Config, overrides: Partial<Config>): Config {
  return {
    rootDir: expandPath(overrides.rootDir || defaults.rootDir),
    parallel: {
      ...defaults.parallel,
      ...overrides.parallel,
    },
    discord: {
      ...defaults.discord,
      ...overrides.discord,
    },
    claude: {
      ...defaults.claude,
      ...overrides.claude,
    },
    logging: {
      ...defaults.logging,
      ...overrides.logging,
    },
    repositories: {
      ...defaults.repositories,
      ...overrides.repositories,
    },
  };
}

/**
 * 環境変数による設定のオーバーライド
 * @param config 元の設定
 * @returns オーバーライドされた設定
 */
function applyEnvironmentOverrides(config: Config): Config {
  const env = Deno.env.toObject();

  // CLAUDE_BOT_ROOT_DIR
  if (env.CLAUDE_BOT_ROOT_DIR) {
    config.rootDir = expandPath(env.CLAUDE_BOT_ROOT_DIR);
  }

  // CLAUDE_BOT_MAX_SESSIONS
  if (env.CLAUDE_BOT_MAX_SESSIONS) {
    config.parallel.maxSessions = parseInt(env.CLAUDE_BOT_MAX_SESSIONS, 10);
  }

  // CLAUDE_BOT_LOG_LEVEL
  if (env.CLAUDE_BOT_LOG_LEVEL) {
    config.logging.level = env.CLAUDE_BOT_LOG_LEVEL as LogLevel;
  }

  // CLAUDE_MODEL
  if (env.CLAUDE_MODEL) {
    config.claude.model = env.CLAUDE_MODEL;
  }

  return config;
}

/**
 * パスを展開する（~をホームディレクトリに置換）
 * @param inputPath 入力パス
 * @returns 展開されたパス
 */
function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '~';
    return path.join(home, inputPath.slice(1));
  }
  return path.resolve(inputPath);
}

/**
 * 設定を検証する
 * @param config 検証する設定
 * @throws 設定が無効な場合
 */
export function validateConfig(config: Config): void {
  // rootDirの検証
  if (!config.rootDir) {
    throw new Error('rootDirは必須です');
  }

  // 並列実行設定の検証
  if (config.parallel.maxSessions < 1 || config.parallel.maxSessions > 10) {
    throw new Error('maxSessionsは1〜10の範囲で指定してください');
  }

  if (config.parallel.queueTimeout < 0) {
    throw new Error('queueTimeoutは0以上の値を指定してください');
  }

  // ログレベルの検証
  const validLogLevels: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  if (!validLogLevels.includes(config.logging.level)) {
    throw new Error(`無効なログレベル: ${config.logging.level}`);
  }

  // タイムアウトの検証
  if (config.claude.timeout < 1) {
    throw new Error('claude.timeoutは1秒以上を指定してください');
  }
}

// テストコード
if (import.meta.main) {
  const config = await loadConfig();
  validateConfig(config);
  console.log('設定:', config);
}
