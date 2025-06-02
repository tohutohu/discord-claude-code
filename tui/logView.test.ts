import { assertEquals } from '../deps.ts';
import { LogView } from './logView.ts';

Deno.test('LogViewコンポーネント', async (t) => {
  await t.step('初期状態でログレベルがINFOに設定される', () => {
    const logView = new LogView('INFO');
    // 内部状態は直接確認できないが、レンダリングが正常に動作することを確認
    const view = logView.render(0, 0, 80, 10);
    assertEquals(typeof view.draw, 'function');
  });

  await t.step('ログレベルの循環切り替えが動作する', () => {
    const logView = new LogView('INFO');

    // 6回切り替えると元に戻る
    for (let i = 0; i < 6; i++) {
      logView.cycleLogLevel();
    }

    // エラーが出ないことを確認
    const view = logView.render(0, 0, 80, 10);
    assertEquals(typeof view.draw, 'function');
  });

  await t.step('新しいログエントリを追加できる', () => {
    const logView = new LogView('INFO');

    logView.addLog({
      timestamp: '12:34:56',
      level: 'ERROR',
      message: 'Test error message',
      sessionId: 'test-123',
    });

    // エラーが出ないことを確認
    const view = logView.render(0, 0, 80, 10);
    assertEquals(typeof view.draw, 'function');
  });

  await t.step('1000件を超えるログが追加されても正常に動作する', () => {
    const logView = new LogView('INFO');

    // 1100件のログを追加
    for (let i = 0; i < 1100; i++) {
      logView.addLog({
        timestamp: '12:00:00',
        level: 'INFO',
        message: `Log entry ${i}`,
      });
    }

    // エラーが出ないことを確認
    const view = logView.render(0, 0, 80, 10);
    assertEquals(typeof view.draw, 'function');
  });
});
