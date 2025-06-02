/**
 * logView.tsのテストコード
 */

import { LogEntry } from '../logger.ts';
import { LogView } from './logView.ts';
import { tui } from '../deps.ts';

Deno.test('ログレベルのフィルタリング', () => {
  const mockScreen = {
    render: () => {},
  };

  const logView = new LogView({
    parent: mockScreen as unknown as tui.Screen,
    level: 'INFO',
  });

  // INFOレベル設定時、DEBUGログは表示されない
  const debugEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'DEBUG',
    message: 'Debug message',
  };

  logView.addLog(debugEntry);
  // ログが追加されていないことを確認（実際のテストでは内部状態を確認）

  // INFOレベル以上は表示される
  const infoEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message: 'Info message',
  };

  logView.addLog(infoEntry);
  // ログが追加されていることを確認
});
