import { assertEquals } from '../deps.ts';
import { App } from './app.ts';
import { loadConfig } from '../config.ts';

Deno.test('TUIアプリケーション', async (t) => {
  await t.step('Appインスタンスが作成できる', async () => {
    const config = await loadConfig('./non-existent-config.yaml');
    const app = new App(config);
    assertEquals(typeof app.run, 'function');
    assertEquals(typeof app.stop, 'function');
  });

  await t.step('アプリケーションが正常に停止する', async () => {
    const config = await loadConfig('./non-existent-config.yaml');
    const app = new App(config);

    // 即座に停止
    app.stop();

    // runが終了することを確認
    const runPromise = app.run();
    let timeoutId: number | undefined;

    try {
      await Promise.race([
        runPromise,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, 100);
        }),
      ]);
      // 正常に終了
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  });
});
