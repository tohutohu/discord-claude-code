/**
 * ログビューコンポーネント
 */

import { colors, tui } from '../deps.ts';
import { LogLevel } from '../types/config.ts';
import { LogEntry } from '../logger.ts';

/** ログレベルの優先度 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

/**
 * ログビュークラス
 */
export class LogView {
  private log: tui.Log;
  private currentLevel: LogLevel;
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  constructor(options: tui.BoxOptions & { level: LogLevel }) {
    this.currentLevel = options.level;

    // ログウィジェットを作成
    this.log = tui.log({
      ...options,
      label: ` ログ [${this.currentLevel}+] `,
      tags: true,
      keys: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        style: {
          bg: 'gray',
        },
      },
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
    });

    // イベントハンドラを設定
    this.setupEventHandlers();
  }

  /**
   * イベントハンドラを設定する
   */
  private setupEventHandlers(): void {
    // PageUp/PageDownでスクロール
    this.log.key(['pageup', 'C-b'], () => {
      this.log.scroll(-this.log.height);
      this.log.screen.render();
    });

    this.log.key(['pagedown', 'C-f'], () => {
      this.log.scroll(this.log.height);
      this.log.screen.render();
    });

    // Home/Endで最初/最後へ
    this.log.key('home', () => {
      this.log.setScrollPerc(0);
      this.log.screen.render();
    });

    this.log.key('end', () => {
      this.log.setScrollPerc(100);
      this.log.screen.render();
    });
  }

  /**
   * ログを追加する
   * @param entry ログエントリ
   */
  addLog(entry: LogEntry): void {
    // ログレベルチェック
    if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.currentLevel]) {
      return;
    }

    // ログを保存
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // フォーマットして追加
    const formatted = this.formatLogEntry(entry);
    this.log.log(formatted);
  }

  /**
   * ログエントリをフォーマットする
   * @param entry ログエントリ
   * @returns フォーマットされた文字列
   */
  private formatLogEntry(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toTimeString().split(' ')[0];
    const levelColor = this.getLevelColor(entry.level);
    const levelText = `[${entry.level.padEnd(5)}]`;

    let message = entry.message;

    // セッションIDがある場合は追加
    if (entry.sessionId) {
      message = `[${entry.sessionId}] ${message}`;
    }

    // コンテキストがある場合は追加
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = JSON.stringify(entry.context);
      message += ` {gray-fg}${contextStr}{/gray-fg}`;
    }

    return `${time} {${levelColor}-fg}${levelText}{/${levelColor}-fg} ${message}`;
  }

  /**
   * ログレベルの色を取得する
   * @param level ログレベル
   * @returns 色名
   */
  private getLevelColor(level: LogLevel): string {
    const colors: Record<LogLevel, string> = {
      TRACE: 'gray',
      DEBUG: 'blue',
      INFO: 'green',
      WARN: 'yellow',
      ERROR: 'red',
      FATAL: 'red-bg',
    };

    return colors[level] || 'white';
  }

  /**
   * ログレベルを循環変更する
   */
  cycleLogLevel(): void {
    const levels: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
    const currentIndex = levels.indexOf(this.currentLevel);
    const nextIndex = (currentIndex + 1) % levels.length;

    this.currentLevel = levels[nextIndex];
    this.log.setLabel(` ログ [${this.currentLevel}+] `);

    // 既存のログを再フィルタリング
    this.refilterLogs();
  }

  /**
   * ログを再フィルタリングする
   */
  private refilterLogs(): void {
    // クリア
    this.log.setContent('');

    // フィルタリングして再表示
    this.logs.forEach((entry) => {
      if (LOG_LEVEL_PRIORITY[entry.level] >= LOG_LEVEL_PRIORITY[this.currentLevel]) {
        const formatted = this.formatLogEntry(entry);
        this.log.log(formatted);
      }
    });
  }

  /**
   * ログレベルを設定する
   * @param level 新しいログレベル
   */
  setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.log.setLabel(` ログ [${this.currentLevel}+] `);
    this.refilterLogs();
  }

  /**
   * ログをクリアする
   */
  clear(): void {
    this.logs = [];
    this.log.setContent('');
  }

  /**
   * ログを検索する
   * @param query 検索クエリ
   */
  search(query: string): void {
    const matches = this.logs.filter((entry) => {
      const searchText = `${entry.message} ${JSON.stringify(entry.context || {})}`;
      return searchText.toLowerCase().includes(query.toLowerCase());
    });

    // 検索結果を表示
    this.log.setContent('');
    matches.forEach((entry) => {
      if (LOG_LEVEL_PRIORITY[entry.level] >= LOG_LEVEL_PRIORITY[this.currentLevel]) {
        const formatted = this.formatLogEntry(entry);
        this.log.log(formatted);
      }
    });

    this.log.setLabel(` ログ [${this.currentLevel}+] - 検索: "${query}" (${matches.length}件) `);
  }

  /**
   * 検索をクリアする
   */
  clearSearch(): void {
    this.log.setLabel(` ログ [${this.currentLevel}+] `);
    this.refilterLogs();
  }

  /**
   * フォーカスを取得する
   */
  focus(): void {
    this.log.focus();
  }

  /**
   * フォーカスを外す
   */
  blur(): void {
    this.log.blur();
  }

  /**
   * フォーカス状態を取得する
   */
  get focused(): boolean {
    return this.log.focused;
  }
}
