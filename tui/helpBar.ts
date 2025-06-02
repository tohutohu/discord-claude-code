/**
 * ヘルプバーコンポーネント
 */

import { tui } from '../deps.ts';

/**
 * ヘルプバークラス
 */
export class HelpBar {
  private box: tui.Box;

  constructor(options: tui.BoxOptions) {
    // ボックスを作成
    this.box = tui.box({
      ...options,
      content: this.getHelpContent(),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'magenta',
        },
      },
    });
  }

  /**
   * ヘルプコンテンツを生成する
   * @returns ヘルプ文字列
   */
  private getHelpContent(): string {
    const helps = [
      '{bold}↑/↓{/bold}:移動',
      '{bold}Enter{/bold}:詳細',
      '{bold}d{/bold}:終了',
      '{bold}r{/bold}:再起動',
      '{bold}f{/bold}:フィルタ',
      '{bold}l{/bold}:ログレベル',
      '{bold}q{/bold}:終了',
      '{bold}?{/bold}:ヘルプ',
    ];

    return `{center}ヘルプ{/center}\n` +
      `{center}${helps.join('  ')}{/center}`;
  }

  /**
   * コンテキストに応じたヘルプを表示する
   * @param context コンテキスト ('session' | 'log' | 'default')
   */
  updateContext(context: 'session' | 'log' | 'default'): void {
    let content = '';

    switch (context) {
      case 'session':
        content = this.getSessionHelp();
        break;
      case 'log':
        content = this.getLogHelp();
        break;
      default:
        content = this.getHelpContent();
    }

    this.box.setContent(content);
  }

  /**
   * セッションテーブル用のヘルプを生成する
   * @returns ヘルプ文字列
   */
  private getSessionHelp(): string {
    const helps = [
      '{bold}↑/↓{/bold}:選択',
      '{bold}Enter{/bold}:詳細表示',
      '{bold}d{/bold}:セッション終了',
      '{bold}r{/bold}:再起動',
      '{bold}Tab{/bold}:フォーカス切替',
      '{bold}?{/bold}:ヘルプ',
    ];

    return `{center}セッション操作{/center}\n` +
      `{center}${helps.join('  ')}{/center}`;
  }

  /**
   * ログビュー用のヘルプを生成する
   * @returns ヘルプ文字列
   */
  private getLogHelp(): string {
    const helps = [
      '{bold}↑/↓{/bold}:スクロール',
      '{bold}PageUp/Down{/bold}:ページ送り',
      '{bold}Home/End{/bold}:最初/最後',
      '{bold}l{/bold}:レベル変更',
      '{bold}f{/bold}:検索',
      '{bold}Tab{/bold}:フォーカス切替',
    ];

    return `{center}ログ操作{/center}\n` +
      `{center}${helps.join('  ')}{/center}`;
  }

  /**
   * カスタムメッセージを表示する
   * @param message メッセージ
   * @param type メッセージタイプ
   */
  showMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    const colors = {
      info: 'green',
      warning: 'yellow',
      error: 'red',
    };

    const color = colors[type];
    const content = `{center}{${color}-fg}${message}{/${color}-fg}{/center}`;

    this.box.setContent(content);

    // 3秒後に元のヘルプに戻す
    setTimeout(() => {
      this.box.setContent(this.getHelpContent());
      this.box.screen.render();
    }, 3000);
  }
}
