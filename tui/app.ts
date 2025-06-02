// TUIアプリケーション（簡略版）
import { Config } from '../config.ts';
import { SessionTable } from './sessionTable.ts';
import { LogView } from './logView.ts';
import { HelpBar } from './helpBar.ts';

/**
 * TUIアプリケーションのメインコンポーネント（簡略版）
 */
export class App {
  private isRunning = true;

  constructor(config: Config) {
    // コンポーネントを初期化（簡略化のため実際には使用しない）
    new SessionTable();
    new LogView(config.logging.level);
    new HelpBar();
  }

  /**
   * アプリケーションを起動
   */
  async run(): Promise<void> {
    // デモ用の簡略化された実装
    console.log('🚀 TUIモードが起動しました (PR-2.4で完全実装予定)');
    console.log('キー操作: q=終了, ↑/↓=移動, l=ログレベル, ?=ヘルプ');
    console.log('');

    // デモ用のセッション表示
    console.log('セッション一覧:');
    console.log('1. [🟢 Run ] core-api   - 00:12:34');
    console.log('2. [⏸️ Wait] web-admin  - 00:03:10');
    console.log('3. [❌ Err ] auth-svc   - 00:45:23');

    // TUIの終了を待つ
    while (this.isRunning) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * アプリケーションを停止
   */
  stop(): void {
    this.isRunning = false;
    // TUIの停止処理は簡略化
  }
}
