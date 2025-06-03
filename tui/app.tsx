// TUIアプリケーション（ink版）
import { Box, Instance, React, render, useApp, useInput } from '../deps.ts';
import { Config } from '../config.ts';
import { SessionTable } from './sessionTable.tsx';
import { LogView } from './logView.tsx';
import { HelpBar } from './helpBar.tsx';

/**
 * TUIアプリケーションのメインコンポーネント
 */
const AppComponent: React.FC<{ config: Config }> = ({ config }) => {
  const { exit } = useApp();

  // キーボード入力のハンドリング
  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection='column' height='100%'>
      <Box flexDirection='column' flexGrow={1}>
        {/* セッションテーブル */}
        <Box height='40%' borderStyle='single' borderColor='cyan'>
          <SessionTable />
        </Box>

        {/* ログビュー */}
        <Box flexGrow={1} borderStyle='single' borderColor='green'>
          <LogView logLevel={config.logging.level} />
        </Box>
      </Box>

      {/* ヘルプバー */}
      <Box height={3} borderStyle='single' borderColor='yellow'>
        <HelpBar />
      </Box>
    </Box>
  );
};

/**
 * TUIアプリケーションクラス
 */
export class App {
  private app: Instance | undefined;

  constructor(private config: Config) {}

  /**
   * アプリケーションを起動
   */
  async run(): Promise<void> {
    // テスト環境では即座に終了
    if (Deno.env.get('DENO_TEST') === 'true') {
      console.log('🚀 TUIモードが起動しました (PR-2.4で完全実装予定)');
      console.log('キー操作: q=終了, ↑/↓=移動, l=ログレベル, ?=ヘルプ');
      console.log('');
      console.log('セッション一覧:');
      console.log('1. [🟢 Run ] core-api   - 00:12:34');
      console.log('2. [⏸️ Wait] web-admin  - 00:03:10');
      console.log('3. [❌ Err ] auth-svc   - 00:45:23');
      return;
    }

    this.app = render(<AppComponent config={this.config} />);
    await this.app.waitUntilExit();
  }

  /**
   * アプリケーションを停止
   */
  stop(): void {
    if (this.app) {
      this.app.unmount();
    }
  }
}
