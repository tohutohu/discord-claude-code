/**
 * TUIアプリケーションのメインコンポーネント
 */

import { assertExists, tui } from '../deps.ts';
import { Config } from '../types/config.ts';
import { LogEntry, logger } from '../logger.ts';
import { SessionTable } from './sessionTable.ts';
import { LogView } from './logView.ts';
import { HelpBar } from './helpBar.ts';

/**
 * TUIアプリケーションクラス
 */
export class TuiApp {
  private config: Config;
  private screen!: tui.Screen;
  private sessionTable!: SessionTable;
  private logView!: LogView;
  private helpBar!: HelpBar;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * アプリケーションを初期化する
   */
  init(): void {
    // スクリーンを作成
    this.screen = new tui.Screen({
      smartCSR: true,
      title: 'Claude Bot',
    });

    // レイアウトを構築
    this.buildLayout();

    // ロガーハンドラを追加
    logger.addHandler((entry: LogEntry) => {
      this.logView.addLog(entry);
      this.screen.render();
    });

    // キーバインディングを設定
    this.setupKeyBindings();

    // 初期描画
    this.screen.render();
  }

  /**
   * レイアウトを構築する
   */
  private buildLayout(): void {
    // ヘッダー
    const header = tui.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: this.getHeaderContent(),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    // セッションテーブル
    this.sessionTable = new SessionTable({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: '40%',
    });

    // ログビュー
    this.logView = new LogView({
      parent: this.screen,
      top: '43%',
      left: 0,
      width: '100%',
      height: '47%',
      level: this.config.logging.level,
    });

    // ヘルプバー
    this.helpBar = new HelpBar({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
    });
  }

  /**
   * ヘッダーコンテンツを生成する
   * @returns ヘッダー文字列
   */
  private getHeaderContent(): string {
    const uptime = this.formatUptime(0); // TODO(@tui): アップタイムを取得
    const sessions = this.sessionTable?.getSessionCount() || 0;
    const maxSessions = this.config.parallel.maxSessions;
    const queue = 0; // TODO(@tui): キュー数を取得

    return `{center}{bold}Claude Bot v0.1.0{/bold}{/center}\n` +
      `{center}Sessions: ${sessions}/${maxSessions} | Queue: ${queue} | Uptime: ${uptime}{/center}`;
  }

  /**
   * アップタイムをフォーマットする
   * @param seconds 秒数
   * @returns フォーマットされた時間
   */
  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:` +
      `${minutes.toString().padStart(2, '0')}:` +
      `${secs.toString().padStart(2, '0')}`;
  }

  /**
   * キーバインディングを設定する
   */
  private setupKeyBindings(): void {
    // 終了
    this.screen.key(['q', 'C-c'], () => {
      this.shutdown();
    });

    // ヘルプ
    this.screen.key('?', () => {
      this.showHelp();
    });

    // ログレベル変更
    this.screen.key('l', () => {
      this.logView.cycleLogLevel();
      this.screen.render();
    });

    // フォーカス切り替え
    this.screen.key('tab', () => {
      if (this.sessionTable.focused) {
        this.sessionTable.blur();
        this.logView.focus();
      } else {
        this.logView.blur();
        this.sessionTable.focus();
      }
      this.screen.render();
    });

    // リフレッシュ
    this.screen.key('r', () => {
      this.refresh();
    });
  }

  /**
   * ヘルプを表示する
   */
  private showHelp(): void {
    const helpBox = tui.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      content: this.getHelpContent(),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
        bg: 'black',
      },
    });

    helpBox.key('escape', () => {
      helpBox.destroy();
      this.screen.render();
    });

    helpBox.focus();
    this.screen.render();
  }

  /**
   * ヘルプコンテンツを生成する
   * @returns ヘルプ文字列
   */
  private getHelpContent(): string {
    return `{center}{bold}ヘルプ{/bold}{/center}\n\n` +
      `{bold}ナビゲーション:{/bold}\n` +
      `  ↑/↓     : 項目を選択\n` +
      `  Tab     : フォーカスを切り替え\n` +
      `  Enter   : 詳細を表示\n\n` +
      `{bold}セッション操作:{/bold}\n` +
      `  d       : セッションを終了\n` +
      `  r       : セッションを再起動\n\n` +
      `{bold}表示:{/bold}\n` +
      `  l       : ログレベルを変更\n` +
      `  f       : ログをフィルタ\n\n` +
      `{bold}その他:{/bold}\n` +
      `  ?       : このヘルプを表示\n` +
      `  q       : アプリケーションを終了\n\n` +
      `{center}{gray}ESCキーでこのヘルプを閉じる{/gray}{/center}`;
  }

  /**
   * 画面をリフレッシュする
   */
  private refresh(): void {
    // ヘッダーを更新
    const header = this.screen.children[0];
    if (header) {
      header.setContent(this.getHeaderContent());
    }

    // セッションテーブルを更新
    this.sessionTable.refresh();

    // 再描画
    this.screen.render();
  }

  /**
   * アプリケーションを起動する
   */
  run(): void {
    // 定期的な更新
    const updateInterval = setInterval(() => {
      this.refresh();
    }, 1000);

    // シャットダウン時にインターバルをクリア
    this.screen.on('destroy', () => {
      clearInterval(updateInterval);
    });
  }

  /**
   * アプリケーションをシャットダウンする
   */
  private shutdown(): void {
    logger.info('TUIをシャットダウンしています...');
    this.screen.destroy();
    Deno.exit(0);
  }
}

// テストコード
Deno.test('TUIアプリケーションの初期化', () => {
  const config: Config = {
    rootDir: '/tmp/test',
    parallel: { maxSessions: 3, queueTimeout: 300 },
    discord: { guildIds: [], commandPrefix: '/claude' },
    claude: { model: 'test', timeout: 600 },
    logging: { level: 'INFO', retentionDays: 7, maxFileSize: '10MB' },
  };

  const app = new TuiApp(config);
  assertExists(app);
});
