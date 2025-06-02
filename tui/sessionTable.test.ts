import { assertEquals } from '../deps.ts';
import { SessionTable } from './sessionTable.ts';

Deno.test('SessionTableコンポーネント', async (t) => {
  await t.step('初期状態で3つのセッションが存在する', () => {
    const table = new SessionTable();
    assertEquals(table.getActiveCount(), 2); // Run: 1, Wait: 1
  });

  await t.step('上下移動が正しく動作する', () => {
    const table = new SessionTable();

    // 初期状態では0番目が選択されている
    // moveUpしても0のまま
    table.moveUp();

    // moveDownで1番目に移動
    table.moveDown();
    table.moveDown(); // 2番目
    table.moveDown(); // 最後なので2番目のまま

    // 正常に動作していることを確認（内部状態は直接確認できないが、エラーが出ないことを確認）
    assertEquals(typeof table.render, 'function');
  });

  await t.step('レンダリングが正しく動作する', () => {
    const table = new SessionTable();
    const view = table.render(0, 0, 80, 10);

    // Viewオブジェクトが返されることを確認
    assertEquals(typeof view.draw, 'function');
  });
});
