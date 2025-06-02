import { assertEquals } from '../deps.ts';
import { HelpBar } from './helpBar.ts';

Deno.test('HelpBarコンポーネント', async (t) => {
  await t.step('初期状態では折りたたまれている', () => {
    const helpBar = new HelpBar();
    assertEquals(helpBar.isExpanded, false);
  });

  await t.step('toggleExpandedで展開状態が切り替わる', () => {
    const helpBar = new HelpBar();

    helpBar.toggleExpanded();
    assertEquals(helpBar.isExpanded, true);

    helpBar.toggleExpanded();
    assertEquals(helpBar.isExpanded, false);
  });

  await t.step('折りたたみ状態でレンダリングできる', () => {
    const helpBar = new HelpBar();
    const view = helpBar.render(0, 0, 80, 3);
    assertEquals(typeof view.draw, 'function');
  });

  await t.step('展開状態でレンダリングできる', () => {
    const helpBar = new HelpBar();
    helpBar.toggleExpanded();
    const view = helpBar.render(0, 0, 80, 5);
    assertEquals(typeof view.draw, 'function');
  });
});
