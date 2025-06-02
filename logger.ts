/**
 * 構造化ロガー実装
 * TUIとファイルへの二重出力をサポート
 */

import { assert, assertEquals, assertExists, colors, datetime, fs, path } from './deps.ts';
import { LogLevel } from './types/config.ts';

/** ログエントリの型 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  sessionId?: string;
}

/** ログレベルの優先度 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

/** ログレベルごとの色設定 */
const LOG_LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  TRACE: colors.gray,
  DEBUG: colors.blue,
  INFO: colors.green,
  WARN: colors.yellow,
  ERROR: colors.red,
  FATAL: colors.bgRed,
};

/** ログレベルごとのアイコン */
const LOG_LEVEL_ICONS: Record<LogLevel, string> = {
  TRACE: '🔍',
  DEBUG: '🐛',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌',
  FATAL: '💀',
};

/**
 * ロガークラス
 */
export class Logger {
  private currentLevel: LogLevel;
  private logDir: string;
  private logFile?: Deno.FsFile;
  private logHandlers: ((entry: LogEntry) => void)[] = [];

  constructor(level: LogLevel = 'INFO', logDir = '~/.claude-bot/logs') {
    this.currentLevel = level;
    this.logDir = this.expandPath(logDir);
  }

  /**
   * ロガーを初期化する
   */
  async init(): Promise<void> {
    // ログディレクトリを作成
    await fs.ensureDir(this.logDir);

    // ログファイルを開く
    const logFileName = `claude-bot-${datetime.format(new Date(), 'yyyy-MM-dd')}.log`;
    const logFilePath = path.join(this.logDir, logFileName);

    this.logFile = await Deno.open(logFilePath, {
      write: true,
      append: true,
      create: true,
    });

    // 古いログファイルを削除
    await this.cleanOldLogs();
  }

  /**
   * ログハンドラを追加する（TUI連携用）
   * @param handler ログハンドラ関数
   */
  addHandler(handler: (entry: LogEntry) => void): void {
    this.logHandlers.push(handler);
  }

  /**
   * ログレベルを設定する
   * @param level 新しいログレベル
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * ログを出力する
   * @param level ログレベル
   * @param message メッセージ
   * @param context コンテキスト情報
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // ログレベルチェック
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.currentLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    // コンソール出力（Pretty形式）
    this.logToConsole(entry);

    // ファイル出力（JSON形式）
    this.logToFile(entry);

    // ハンドラ呼び出し（TUI連携）
    this.logHandlers.forEach((handler) => handler(entry));
  }

  /**
   * コンソールに出力する
   * @param entry ログエントリ
   */
  private logToConsole(entry: LogEntry): void {
    const color = LOG_LEVEL_COLORS[entry.level];
    const icon = LOG_LEVEL_ICONS[entry.level];
    const time = datetime.format(new Date(entry.timestamp), 'HH:mm:ss');

    let output = `${time} ${icon} ${color(`[${entry.level.padEnd(5)}]`)} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${colors.gray(JSON.stringify(entry.context))}`;
    }

    console.log(output);
  }

  /**
   * ファイルに出力する
   * @param entry ログエントリ
   */
  private async logToFile(entry: LogEntry): Promise<void> {
    if (!this.logFile) return;

    const line = JSON.stringify(entry) + '\n';
    const encoder = new TextEncoder();

    try {
      await this.logFile.write(encoder.encode(line));
    } catch (error) {
      console.error('ログファイルへの書き込みエラー:', error);
    }
  }

  /**
   * 古いログファイルを削除する
   */
  private async cleanOldLogs(): Promise<void> {
    const retentionDays = 7; // TODO(@logger): 設定から取得
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      for await (const entry of Deno.readDir(this.logDir)) {
        if (!entry.isFile || !entry.name.startsWith('claude-bot-')) continue;

        const filePath = path.join(this.logDir, entry.name);
        const stat = await Deno.stat(filePath);

        if (stat.mtime && stat.mtime < cutoffDate) {
          await Deno.remove(filePath);
          this.debug(`古いログファイルを削除: ${entry.name}`);
        }
      }
    } catch (error) {
      this.error('ログファイルの削除エラー:', { error });
    }
  }

  /**
   * パスを展開する
   * @param inputPath 入力パス
   * @returns 展開されたパス
   */
  private expandPath(inputPath: string): string {
    if (inputPath.startsWith('~')) {
      const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '~';
      return path.join(home, inputPath.slice(1));
    }
    return path.resolve(inputPath);
  }

  /**
   * クリーンアップ処理
   */
  cleanup(): void {
    if (this.logFile) {
      this.logFile.close();
    }
  }

  // ログレベル別メソッド
  trace(message: string, context?: Record<string, unknown>): void {
    this.log('TRACE', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('FATAL', message, context);
  }
}

// シングルトンインスタンス
export const logger = new Logger();
