import { assertEquals, assertExists } from './deps.ts';

Deno.test('依存関係のインポートが正常に動作すること', () => {
  // テスト用に一部の依存関係が存在することを確認
  assertExists(assertEquals);
  assertEquals(typeof assertEquals, 'function');
});
