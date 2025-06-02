/**
 * logger.tsのテストコード
 */

import { assert, assertEquals, assertExists } from './deps.ts';
import { LogEntry, Logger } from './logger.ts';

Deno.test('ログレベルのフィルタリングが正しく動作すること', () => {
  const testLogger = new Logger('WARN');
  let outputCount = 0;

  // ハンドラを追加してログ出力をカウント
  testLogger.addHandler(() => outputCount++);

  // INFO以下は出力されない
  testLogger.info('This should not be logged');
  assertEquals(outputCount, 0);

  // WARN以上は出力される
  testLogger.warn('This should be logged');
  assertEquals(outputCount, 1);

  testLogger.error('This should also be logged');
  assertEquals(outputCount, 2);
});

Deno.test('ログエントリの形式が正しいこと', () => {
  const testLogger = new Logger('TRACE');
  let capturedEntry: LogEntry | null = null;

  testLogger.addHandler((entry) => {
    capturedEntry = entry;
  });

  const context = { userId: '123', sessionId: 'abc' };
  testLogger.info('Test message', context);

  assertExists(capturedEntry);
  assertEquals(capturedEntry.level, 'INFO');
  assertEquals(capturedEntry.message, 'Test message');
  assertEquals(capturedEntry.context, context);
  assert(capturedEntry.timestamp);
});
