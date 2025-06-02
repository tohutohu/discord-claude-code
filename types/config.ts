/**
 * 設定ファイルの型定義
 */

export interface Config {
  /** Git リポジトリをキャッシュするルートディレクトリ */
  rootDir: string;

  /** 並列実行設定 */
  parallel: {
    /** 最大同時実行セッション数 */
    maxSessions: number;
    /** キュー待機タイムアウト（秒） */
    queueTimeout: number;
  };

  /** Discord設定 */
  discord: {
    /** ギルドIDを指定（省略時は全ギルドで有効） */
    guildIds: string[];
    /** コマンドのプレフィックス（省略時は /claude） */
    commandPrefix: string;
  };

  /** Claude設定 */
  claude: {
    /** モデル名（省略時はデフォルト） */
    model: string;
    /** タイムアウト（秒） */
    timeout: number;
  };

  /** ログ設定 */
  logging: {
    /** ログレベル */
    level: LogLevel;
    /** ログ保持日数 */
    retentionDays: number;
    /** 最大ファイルサイズ */
    maxFileSize: string;
  };

  /** リポジトリ設定（オプション） */
  repositories?: Record<string, string>;
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/** デフォルト設定値 */
export const DEFAULT_CONFIG: Config = {
  rootDir: '~/claude-work/repos',
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
};
