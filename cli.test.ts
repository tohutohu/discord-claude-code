/**
 * cli.tsのテストコード
 */

import { assert } from './deps.ts';

Deno.test('CLIコマンドの基本構造が正しいこと', async () => {
  const { createMainCommand } = await import('./cli.ts');
  const cli = createMainCommand();

  // コマンド名が正しく設定されているか確認
  assert(cli.getName() === 'discord-claude-code');
  
  // 基本的なプロパティが存在するか確認
  assert(cli);
});
