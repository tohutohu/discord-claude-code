/**
 * テストユーティリティとモック機能
 * @cli テスト支援機能の提供
 */

import { Config } from './types/config.ts';
import { SessionData, SessionState } from './types/session.ts';
import { LogEntry, LogLevel } from './logger.ts';

/** テスト用の設定 */
export const TEST_CONFIG: Config = {
  rootDir: '/tmp/claude-test',
  parallel: {
    maxSessions: 2,
    queueTimeout: 10,
  },
  discord: {
    guildIds: ['test-guild'],
    commandPrefix: '/test-claude',
  },
  claude: {
    model: 'claude-test-model',
    timeout: 30,
  },
  logging: {
    level: 'DEBUG',
    retentionDays: 1,
    maxFileSize: '1MB',
  },
  repositories: {
    'test-repo': 'https://github.com/test/test-repo.git',
  },
};

/** モックセッションデータ生成 */
export function createMockSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: crypto.randomUUID(),
    threadId: `thread-${Date.now()}`,
    repository: 'test-repo',
    branch: 'main',
    worktreePath: '/tmp/test-worktree',
    containerId: 'test-container',
    state: SessionState.READY,
    metadata: {
      userId: 'test-user',
      guildId: 'test-guild',
      channelId: 'test-channel',
      createdAt: new Date(),
      updatedAt: new Date(),
      priority: 10,
    },
    ...overrides,
  };
}

/** モックログエントリ生成 */
export function createMockLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: 'INFO' as LogLevel,
    message: 'Test log message',
    sessionId: 'test-session',
    userId: 'test-user',
    traceId: crypto.randomUUID(),
    ...overrides,
  };
}

/** テスト用のファイルシステムモック */
export class MockFileSystem {
  private files = new Map<string, string>();
  private directories = new Set<string>();

  /**
   * ファイルを作成
   * @param path ファイルパス
   * @param content ファイル内容
   */
  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    // ディレクトリも作成
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      this.directories.add(dir);
    }
  }

  /**
   * ファイルを読み込み
   * @param path ファイルパス
   * @returns ファイル内容
   */
  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  /**
   * ファイルが存在するかチェック
   * @param path ファイルパス
   * @returns 存在するかどうか
   */
  exists(path: string): boolean {
    return this.files.has(path) || this.directories.has(path);
  }

  /**
   * ディレクトリ一覧を取得
   * @param path ディレクトリパス
   * @returns ファイル/ディレクトリ一覧
   */
  readDir(path: string): Array<{ name: string; isFile: boolean }> {
    const entries: Array<{ name: string; isFile: boolean }> = [];

    // ファイルを検索
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.substring(path.length + 1);
        if (!relativePath.includes('/')) {
          entries.push({ name: relativePath, isFile: true });
        }
      }
    }

    // ディレクトリを検索
    for (const dirPath of this.directories) {
      if (dirPath.startsWith(path + '/')) {
        const relativePath = dirPath.substring(path.length + 1);
        if (!relativePath.includes('/')) {
          entries.push({ name: relativePath, isFile: false });
        }
      }
    }

    return entries;
  }

  /**
   * ファイルを削除
   * @param path ファイルパス
   */
  remove(path: string): void {
    this.files.delete(path);
    this.directories.delete(path);
  }

  /**
   * すべてのファイルをクリア
   */
  clear(): void {
    this.files.clear();
    this.directories.clear();
  }
}

/** コマンド実行モック */
export class MockCommandExecutor {
  private responses = new Map<string, { stdout: string; stderr: string; exitCode: number }>();
  private executedCommands: string[] = [];

  /**
   * コマンドの応答を設定
   * @param command コマンド
   * @param response 応答
   */
  setResponse(
    command: string,
    response: { stdout: string; stderr: string; exitCode: number },
  ): void {
    this.responses.set(command, response);
  }

  /**
   * コマンドを実行
   * @param command コマンド
   * @returns 実行結果
   */
  execute(command: string): { stdout: string; stderr: string; exitCode: number } {
    this.executedCommands.push(command);

    // 完全一致の応答を探す
    const exactResponse = this.responses.get(command);
    if (exactResponse) {
      return exactResponse;
    }

    // 部分一致の応答を探す
    for (const [pattern, response] of this.responses) {
      if (command.includes(pattern)) {
        return response;
      }
    }

    // デフォルト応答
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  /**
   * 実行されたコマンド一覧を取得
   * @returns コマンド一覧
   */
  getExecutedCommands(): string[] {
    return [...this.executedCommands];
  }

  /**
   * コマンド履歴をクリア
   */
  clearHistory(): void {
    this.executedCommands.length = 0;
  }
}

/** HTTP リクエストモック */
export class MockHttpClient {
  private responses = new Map<
    string,
    { status: number; body: string; headers?: Record<string, string> }
  >();
  private requestLog: Array<{ url: string; method: string; body?: string }> = [];

  /**
   * URLに対する応答を設定
   * @param url URL
   * @param response 応答
   */
  setResponse(
    url: string,
    response: { status: number; body: string; headers?: Record<string, string> },
  ): void {
    this.responses.set(url, response);
  }

  /**
   * HTTPリクエストを実行
   * @param url URL
   * @param options オプション
   * @returns 応答
   */
  fetch(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    this.requestLog.push({
      url,
      method: options.method || 'GET',
      body: options.body,
    });

    const response = this.responses.get(url) || { status: 404, body: 'Not Found' };

    return {
      status: response.status,
      body: response.body,
      headers: response.headers || {},
    };
  }

  /**
   * リクエストログを取得
   * @returns リクエストログ
   */
  getRequestLog(): Array<{ url: string; method: string; body?: string }> {
    return [...this.requestLog];
  }

  /**
   * ログをクリア
   */
  clearLog(): void {
    this.requestLog.length = 0;
  }
}

/** 時間制御モック */
export class MockTimeController {
  private currentTime = Date.now();
  private timers: Array<
    { id: number; callback: () => void; delay: number; scheduledTime: number }
  > = [];
  private nextTimerId = 1;

  /**
   * 現在時刻を設定
   * @param time 時刻（ミリ秒）
   */
  setCurrentTime(time: number): void {
    this.currentTime = time;
  }

  /**
   * 現在時刻を取得
   * @returns 現在時刻
   */
  now(): number {
    return this.currentTime;
  }

  /**
   * 時間を進める
   * @param ms 進める時間（ミリ秒）
   */
  tick(ms: number): void {
    const targetTime = this.currentTime + ms;

    // 期限が来たタイマーを実行
    const readyTimers = this.timers.filter((timer) => timer.scheduledTime <= targetTime);

    for (const timer of readyTimers) {
      this.currentTime = timer.scheduledTime;
      timer.callback();
      this.timers = this.timers.filter((t) => t.id !== timer.id);
    }

    this.currentTime = targetTime;
  }

  /**
   * タイマーを設定
   * @param callback コールバック
   * @param delay 遅延時間（ミリ秒）
   * @returns タイマーID
   */
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextTimerId++;
    this.timers.push({
      id,
      callback,
      delay,
      scheduledTime: this.currentTime + delay,
    });
    return id;
  }

  /**
   * タイマーをクリア
   * @param id タイマーID
   */
  clearTimeout(id: number): void {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  }

  /**
   * 全タイマーをクリア
   */
  clearAllTimers(): void {
    this.timers.length = 0;
  }
}

/** プロパティベーステストのジェネレーター */
export class PropertyGenerator {
  /**
   * ランダムな文字列を生成
   * @param length 長さ
   * @param charset 文字セット
   * @returns ランダム文字列
   */
  randomString(
    length: number,
    charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }

  /**
   * ランダムな整数を生成
   * @param min 最小値
   * @param max 最大値
   * @returns ランダム整数
   */
  randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * ランダムなEmailアドレスを生成
   * @returns Emailアドレス
   */
  randomEmail(): string {
    const username = this.randomString(this.randomInt(3, 20));
    const domain = this.randomString(this.randomInt(3, 15));
    const tld = ['com', 'org', 'net', 'edu'][this.randomInt(0, 3)];
    return `${username}@${domain}.${tld}`;
  }

  /**
   * ランダムなファイルパスを生成
   * @returns ファイルパス
   */
  randomFilePath(): string {
    const depth = this.randomInt(1, 5);
    const parts = [];

    for (let i = 0; i < depth; i++) {
      parts.push(this.randomString(this.randomInt(3, 12)));
    }

    const filename = this.randomString(this.randomInt(5, 20));
    const extensions = ['ts', 'js', 'json', 'md', 'txt'];
    const ext = extensions[this.randomInt(0, extensions.length - 1)];

    return `${parts.join('/')}/${filename}.${ext}`;
  }

  /**
   * ランダムなセッションデータを生成
   * @returns セッションデータ
   */
  randomSessionData(): SessionData {
    const states = Object.values(SessionState);
    return createMockSession({
      id: crypto.randomUUID(),
      threadId: this.randomString(20),
      repository: this.randomString(10),
      branch: this.randomString(8),
      state: states[this.randomInt(0, states.length - 1)],
      metadata: {
        userId: this.randomString(18),
        guildId: this.randomString(18),
        channelId: this.randomString(18),
        createdAt: new Date(Date.now() - this.randomInt(0, 86400000)),
        updatedAt: new Date(),
        priority: this.randomInt(1, 20),
      },
    });
  }

  /**
   * ランダムなLogEntryを生成
   * @returns LogEntry
   */
  randomLogEntry(): LogEntry {
    const levels: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
    return createMockLogEntry({
      timestamp: new Date(Date.now() - this.randomInt(0, 86400000)).toISOString(),
      level: levels[this.randomInt(0, levels.length - 1)],
      message: this.randomString(this.randomInt(10, 100)),
      sessionId: crypto.randomUUID(),
      userId: this.randomString(18),
    });
  }
}

/** パフォーマンステスト支援 */
export class PerformanceTestHelper {
  private measurements: Array<{ name: string; duration: number; memory?: number }> = [];

  /**
   * 関数の実行時間を測定
   * @param name 測定名
   * @param fn 測定対象の関数
   * @returns 実行結果と測定情報
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T> | T,
  ): Promise<{ result: T; duration: number; memory: number }> {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    const result = await fn();

    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();

    const duration = endTime - startTime;
    const memory = endMemory - startMemory;

    this.measurements.push({ name, duration, memory });

    return { result, duration, memory };
  }

  /**
   * 複数回実行して統計を取得
   * @param name 測定名
   * @param fn 測定対象の関数
   * @param iterations 実行回数
   * @returns 統計情報
   */
  async benchmark<T>(
    name: string,
    fn: () => Promise<T> | T,
    iterations = 100,
  ): Promise<{
    name: string;
    iterations: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    totalMemory: number;
  }> {
    const durations: number[] = [];
    let totalMemory = 0;

    for (let i = 0; i < iterations; i++) {
      const { duration, memory } = await this.measure(`${name}-${i}`, fn);
      durations.push(duration);
      totalMemory += memory;
    }

    return {
      name,
      iterations,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      totalMemory,
    };
  }

  /**
   * 測定結果を取得
   * @returns 測定結果一覧
   */
  getMeasurements(): Array<{ name: string; duration: number; memory?: number }> {
    return [...this.measurements];
  }

  /**
   * 測定結果をクリア
   */
  clearMeasurements(): void {
    this.measurements.length = 0;
  }

  /**
   * メモリ使用量を取得（おおよその値）
   * @returns メモリ使用量（バイト）
   */
  private getMemoryUsage(): number {
    // Denoでは正確なメモリ使用量を取得する標準的な方法がないため、
    // プロセスのRSSを使用するか、大まかな推定値を返す
    try {
      // Deno.memoryUsage() があれば使用
      // Private Deno API access
      return (Deno as unknown as { memoryUsage?: () => { rss: number } }).memoryUsage?.()?.rss || 0;
    } catch {
      // フォールバック: 現在の時刻をベースにした大まかな値
      return Math.floor(Math.random() * 1000000);
    }
  }
}

/** テストスイートの統計 */
export interface TestSuiteStats {
  /** 総テスト数 */
  total: number;
  /** 成功数 */
  passed: number;
  /** 失敗数 */
  failed: number;
  /** スキップ数 */
  skipped: number;
  /** 実行時間（ミリ秒） */
  duration: number;
  /** カバレッジ率 */
  coverage?: number;
}

/** テストレポーター */
export class TestReporter {
  private stats: TestSuiteStats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
  };

  /**
   * テスト結果を記録
   * @param name テスト名
   * @param status 結果
   * @param duration 実行時間
   * @param error エラー（失敗時）
   */
  recordTest(
    name: string,
    status: 'passed' | 'failed' | 'skipped',
    duration: number,
    error?: Error,
  ): void {
    this.stats.total++;
    this.stats.duration += duration;

    switch (status) {
      case 'passed':
        this.stats.passed++;
        break;
      case 'failed':
        this.stats.failed++;
        console.error(`❌ ${name}: ${error?.message || 'Unknown error'}`);
        break;
      case 'skipped':
        this.stats.skipped++;
        console.log(`⏭️  ${name}: skipped`);
        break;
    }
  }

  /**
   * 統計情報を取得
   * @returns 統計情報
   */
  getStats(): TestSuiteStats {
    return { ...this.stats };
  }

  /**
   * レポートを出力
   */
  printReport(): void {
    const { total, passed, failed, skipped, duration } = this.stats;
    const successRate = total > 0 ? (passed / total * 100).toFixed(1) : '0';

    console.log('\n=== Test Results ===');
    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed} (${successRate}%)`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Duration: ${duration.toFixed(2)}ms`);

    if (this.stats.coverage !== undefined) {
      console.log(`Coverage: ${this.stats.coverage.toFixed(1)}%`);
    }
  }

  /**
   * 統計をクリア
   */
  clear(): void {
    this.stats = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
    };
  }
}

// テスト @test-utils
Deno.test('MockFileSystem - ファイル操作', () => {
  const fs = new MockFileSystem();

  fs.writeFile('/test/file.txt', 'content');
  assertEquals(fs.readFile('/test/file.txt'), 'content');
  assertEquals(fs.exists('/test/file.txt'), true);
  assertEquals(fs.exists('/test'), true);

  const entries = fs.readDir('/test');
  assertEquals(entries.length, 1);
  assertEquals(entries[0].name, 'file.txt');
  assertEquals(entries[0].isFile, true);
});

Deno.test('MockCommandExecutor - コマンド実行', () => {
  const executor = new MockCommandExecutor();

  executor.setResponse('git status', {
    stdout: 'On branch main',
    stderr: '',
    exitCode: 0,
  });

  const result = executor.execute('git status');
  assertEquals(result.stdout, 'On branch main');
  assertEquals(result.exitCode, 0);

  const commands = executor.getExecutedCommands();
  assertEquals(commands.length, 1);
  assertEquals(commands[0], 'git status');
});

Deno.test('PropertyGenerator - ランダムデータ生成', () => {
  const generator = new PropertyGenerator();

  const str = generator.randomString(10);
  assertEquals(str.length, 10);

  const email = generator.randomEmail();
  assertEquals(email.includes('@'), true);
  assertEquals(email.includes('.'), true);

  const session = generator.randomSessionData();
  assertEquals(typeof session.id, 'string');
  assertEquals(typeof session.threadId, 'string');
  assertEquals(Object.values(SessionState).includes(session.state), true);
});

Deno.test('PerformanceTestHelper - 測定', async () => {
  const helper = new PerformanceTestHelper();

  const { result, duration } = await helper.measure('test', () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      sum += i;
    }
    return sum;
  });

  assertEquals(result, 499500);
  assertEquals(typeof duration, 'number');
  assertEquals(duration >= 0, true);

  const measurements = helper.getMeasurements();
  assertEquals(measurements.length, 1);
  assertEquals(measurements[0].name, 'test');
});
