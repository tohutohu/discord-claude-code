/**
 * 統合テストとE2Eテストシナリオ
 * @cli 統合テストの実装
 */

import { assertEquals, assertExists, assertThrows } from './deps.ts';
import { SessionManager } from './sessionManager.ts';
import { ParallelController } from './parallelController.ts';
import { DevContainerManager } from './devcontainer.ts';
import { ClaudeMode, ClaudeRunner } from './claudeRunner.ts';
import { MonitoringSystem } from './monitoring.ts';
import { SecurityManager } from './security.ts';
import { Logger } from './logger.ts';
import { RepoScanner } from './repoScanner.ts';
import { WorktreeManager } from './worktree.ts';
import {
  createMockSession,
  MockCommandExecutor,
  MockFileSystem,
  MockHttpClient,
  MockTimeController,
  PerformanceTestHelper,
  TEST_CONFIG,
  TestReporter,
} from './test-utils.ts';
import { SessionState } from './types/session.ts';

/** 統合テスト環境 */
export class IntegrationTestEnvironment {
  public sessionManager: SessionManager;
  public parallelController: ParallelController;
  public devContainer: DevContainerManager;
  public claudeRunner: ClaudeRunner;
  public monitoring: MonitoringSystem;
  public security: SecurityManager;
  public logger: Logger;
  public repoScanner: RepoScanner;
  public worktree: WorktreeManager;

  // モック
  public mockFs: MockFileSystem;
  public mockCommands: MockCommandExecutor;
  public mockHttp: MockHttpClient;
  public mockTime: MockTimeController;

  constructor() {
    // モックを初期化
    this.mockFs = new MockFileSystem();
    this.mockCommands = new MockCommandExecutor();
    this.mockHttp = new MockHttpClient();
    this.mockTime = new MockTimeController();

    // コンポーネントを初期化
    this.logger = new Logger('DEBUG', '/tmp/test-logs');
    this.sessionManager = new SessionManager(TEST_CONFIG);
    this.parallelController = new ParallelController(TEST_CONFIG);
    this.devContainer = new DevContainerManager(TEST_CONFIG);
    this.claudeRunner = new ClaudeRunner(TEST_CONFIG, this.devContainer);
    this.monitoring = new MonitoringSystem(TEST_CONFIG);
    this.security = new SecurityManager(TEST_CONFIG);
    this.repoScanner = new RepoScanner(TEST_CONFIG);
    this.worktree = new WorktreeManager();

    this.setupMockResponses();
  }

  /**
   * テスト環境を初期化
   */
  async init(): Promise<void> {
    await this.logger.init();
    await this.sessionManager.init();
    await this.security.init();
    this.logger.info('統合テスト環境を初期化しました');
  }

  /**
   * テスト環境をクリーンアップ
   */
  cleanup(): void {
    this.monitoring.stop();
    this.parallelController.dispose();
    this.security.dispose();
    this.sessionManager.dispose();
    this.logger.cleanup();

    this.mockFs.clear();
    this.mockCommands.clearHistory();
    this.mockHttp.clearLog();
    this.mockTime.clearAllTimers();
  }

  /**
   * モックレスポンスを設定
   */
  private setupMockResponses(): void {
    // Git コマンドのモック
    this.mockCommands.setResponse('git rev-parse --show-toplevel', {
      stdout: '/tmp/test-repo',
      stderr: '',
      exitCode: 0,
    });

    this.mockCommands.setResponse('git remote get-url origin', {
      stdout: 'https://github.com/test/test-repo.git',
      stderr: '',
      exitCode: 0,
    });

    this.mockCommands.setResponse('git symbolic-ref --short HEAD', {
      stdout: 'main',
      stderr: '',
      exitCode: 0,
    });

    // devcontainer コマンドのモック
    this.mockCommands.setResponse('devcontainer up', {
      stdout: 'Container started successfully',
      stderr: '',
      exitCode: 0,
    });

    // Claude コマンドのモック
    this.mockCommands.setResponse('claude -p', {
      stdout: 'Created: src/new-file.ts\nModified: src/existing-file.ts',
      stderr: '',
      exitCode: 0,
    });

    // Docker コマンドのモック
    this.mockCommands.setResponse('docker ps', {
      stdout: 'CONTAINER ID\tNAMES\ntest123\ttest-container',
      stderr: '',
      exitCode: 0,
    });

    // ファイルシステムのモック
    this.mockFs.writeFile('/tmp/test-repo/.git/config', '[core]\n\trepositoryformatversion = 0');
    this.mockFs.writeFile(
      '/tmp/test-repo/.devcontainer/devcontainer.json',
      JSON.stringify({
        image: 'mcr.microsoft.com/devcontainers/typescript-node:latest',
        name: 'test-container',
      }),
    );
  }
}

/** E2Eテストシナリオクラス */
export class E2ETestScenarios {
  private env: IntegrationTestEnvironment;
  private reporter: TestReporter;

  constructor() {
    this.env = new IntegrationTestEnvironment();
    this.reporter = new TestReporter();
  }

  /**
   * 全E2Eテストを実行
   */
  async runAllTests(): Promise<void> {
    await this.env.init();

    try {
      await this.testHappyPath();
      await this.testErrorHandling();
      await this.testConcurrency();
      await this.testSecurityFeatures();
      await this.testPerformance();
    } finally {
      await this.env.cleanup();
      this.reporter.printReport();
    }
  }

  /**
   * ハッピーパステスト
   */
  async testHappyPath(): Promise<void> {
    const startTime = performance.now();

    try {
      // 1. セッション作成
      const session = await this.env.sessionManager.createSession({
        threadId: 'test-thread-1',
        repository: 'test-repo',
        userId: 'test-user',
        guildId: 'test-guild',
        channelId: 'test-channel',
      });

      assertExists(session.id);
      assertEquals(session.state, SessionState.INITIALIZING);

      // 2. 並列実行要求
      const executionPromise = this.env.parallelController.requestExecution(session.id);
      assertEquals(await executionPromise, undefined); // 成功

      // 3. セッション状態更新
      await this.env.sessionManager.updateSession(session.id, {
        state: SessionState.RUNNING,
      });

      const updatedSession = await this.env.sessionManager.getSession(session.id);
      assertEquals(updatedSession?.state, SessionState.RUNNING);

      // 4. Claude実行
      const claudeResult = await this.env.claudeRunner.run({
        mode: ClaudeMode.PROMPT,
        prompt: 'Create a simple TypeScript function',
        workspaceFolder: '/tmp/test-workspace',
      });

      assertEquals(claudeResult.success, true);
      assertEquals(claudeResult.changes.length > 0, true);

      // 5. セッション完了
      await this.env.sessionManager.updateSession(session.id, {
        state: SessionState.COMPLETED,
      });

      await this.env.parallelController.completeExecution(session.id);

      this.reporter.recordTest('Happy Path', 'passed', performance.now() - startTime);
    } catch (error) {
      this.reporter.recordTest('Happy Path', 'failed', performance.now() - startTime, error);
      throw error;
    }
  }

  /**
   * エラーハンドリングテスト
   */
  async testErrorHandling(): Promise<void> {
    const startTime = performance.now();

    try {
      // 存在しないセッションの取得
      const nonExistentSession = await this.env.sessionManager.getSession('non-existent');
      assertEquals(nonExistentSession, null);

      // 不正な状態遷移
      const session = await this.env.sessionManager.createSession({
        threadId: 'test-thread-error',
        repository: 'test-repo',
        userId: 'test-user',
        guildId: 'test-guild',
        channelId: 'test-channel',
      });

      // INITIALIZING から COMPLETED への直接遷移は無効
      await assertThrows(
        async () => {
          await this.env.sessionManager.updateSession(session.id, {
            state: SessionState.COMPLETED,
          });
        },
        Error,
        '無効な状態遷移',
      );

      // Claude実行エラー
      this.env.mockCommands.setResponse('claude -p', {
        stdout: '',
        stderr: 'Error: Invalid prompt',
        exitCode: 1,
      });

      const claudeResult = await this.env.claudeRunner.run({
        mode: ClaudeMode.PROMPT,
        prompt: 'Invalid prompt',
        workspaceFolder: '/tmp/test-workspace',
      });

      assertEquals(claudeResult.success, false);
      assertEquals(claudeResult.exitCode, 1);

      this.reporter.recordTest('Error Handling', 'passed', performance.now() - startTime);
    } catch (error) {
      this.reporter.recordTest('Error Handling', 'failed', performance.now() - startTime, error);
      throw error;
    }
  }

  /**
   * 並行処理テスト
   */
  async testConcurrency(): Promise<void> {
    const startTime = performance.now();

    try {
      // 複数セッションを並行作成
      const sessionPromises = Array.from(
        { length: 5 },
        (_, i) =>
          this.env.sessionManager.createSession({
            threadId: `test-thread-${i}`,
            repository: 'test-repo',
            userId: 'test-user',
            guildId: 'test-guild',
            channelId: 'test-channel',
          }),
      );

      const sessions = await Promise.all(sessionPromises);
      assertEquals(sessions.length, 5);

      // 並列実行制御をテスト
      const maxSessions = TEST_CONFIG.parallel.maxSessions; // 2
      const executionPromises = sessions.map((session) =>
        this.env.parallelController.requestExecution(session.id)
      );

      // 最初の2つは即座に実行開始、残りはキュー待ち
      await Promise.all(executionPromises.slice(0, maxSessions));

      const stats = this.env.parallelController.getQueueStats();
      assertEquals(stats.running, maxSessions);
      assertEquals(stats.waiting, sessions.length - maxSessions);

      // セッション完了
      for (let i = 0; i < maxSessions; i++) {
        await this.env.parallelController.completeExecution(sessions[i].id);
      }

      // 残りのセッションが実行開始されることを確認
      await Promise.all(executionPromises.slice(maxSessions));

      this.reporter.recordTest('Concurrency', 'passed', performance.now() - startTime);
    } catch (error) {
      this.reporter.recordTest('Concurrency', 'failed', performance.now() - startTime, error);
      throw error;
    }
  }

  /**
   * セキュリティ機能テスト
   */
  async testSecurityFeatures(): Promise<void> {
    const startTime = performance.now();

    try {
      // APIキー暗号化・復号化
      const apiKey = 'sk-1234567890abcdef1234567890abcdef';
      const encrypted = await this.env.security.encryptApiKey(apiKey);
      const decrypted = await this.env.security.decryptApiKey(encrypted);
      assertEquals(decrypted, apiKey);

      // Rate Limiting
      const userId = 'test-user';
      for (let i = 0; i < 10; i++) {
        this.env.security.checkRateLimit(userId, 'claude_execution');
      }

      // 制限を超えた場合は拒否される
      const rejected = this.env.security.checkRateLimit(userId, 'claude_execution');
      assertEquals(rejected, false);

      // 入力サニタイゼーション
      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = this.env.security.sanitizeInput(maliciousInput);
      assertEquals(sanitized.threats.includes('Script injection'), true);
      assertEquals(sanitized.value.includes('<script>'), false);

      this.reporter.recordTest('Security Features', 'passed', performance.now() - startTime);
    } catch (error) {
      this.reporter.recordTest('Security Features', 'failed', performance.now() - startTime, error);
      throw error;
    }
  }

  /**
   * パフォーマンステスト
   */
  async testPerformance(): Promise<void> {
    const startTime = performance.now();

    try {
      const perfHelper = new PerformanceTestHelper();

      // セッション作成のベンチマーク
      const sessionBenchmark = await perfHelper.benchmark(
        'session-creation',
        () =>
          this.env.sessionManager.createSession({
            threadId: `perf-thread-${Date.now()}`,
            repository: 'test-repo',
            userId: 'test-user',
            guildId: 'test-guild',
            channelId: 'test-channel',
          }),
        10,
      );

      // 1セッションあたり50ms以下であることを確認
      assertEquals(sessionBenchmark.avgDuration < 50, true);

      // ログクエリのベンチマーク
      const logBenchmark = await perfHelper.benchmark(
        'log-query',
        () => this.env.logger.query({ limit: 100 }),
        10,
      );

      // ログクエリは100ms以下であることを確認
      assertEquals(logBenchmark.avgDuration < 100, true);

      // メモリ使用量チェック（大まかな確認）
      const memoryBefore = this.getMemoryUsage();

      // 大量のセッションを作成
      const sessions = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          this.env.sessionManager.createSession({
            threadId: `memory-test-${i}`,
            repository: 'test-repo',
            userId: 'test-user',
            guildId: 'test-guild',
            channelId: 'test-channel',
          })),
      );

      const memoryAfter = this.getMemoryUsage();
      const memoryIncrease = memoryAfter - memoryBefore;

      // メモリ増加が過度でないことを確認（100MB以下）
      assertEquals(memoryIncrease < 100 * 1024 * 1024, true);

      this.reporter.recordTest('Performance', 'passed', performance.now() - startTime);
    } catch (error) {
      this.reporter.recordTest('Performance', 'failed', performance.now() - startTime, error);
      throw error;
    }
  }

  /**
   * メモリ使用量を取得（概算）
   * @returns メモリ使用量（バイト）
   */
  private getMemoryUsage(): number {
    try {
      // Private Deno API access
      return (Deno as unknown as { memoryUsage?: () => { rss: number } }).memoryUsage?.()?.rss || 0;
    } catch {
      return 0;
    }
  }
}

/** 負荷テスト */
export class LoadTest {
  private env: IntegrationTestEnvironment;
  private perfHelper: PerformanceTestHelper;

  constructor() {
    this.env = new IntegrationTestEnvironment();
    this.perfHelper = new PerformanceTestHelper();
  }

  /**
   * 100セッション同時実行負荷テスト
   */
  async runConcurrentSessionsTest(): Promise<void> {
    console.log('負荷テスト開始: 100セッション同時実行');

    await this.env.init();

    try {
      const sessionCount = 100;
      const startTime = performance.now();

      // セッションを並行作成
      const createPromises = Array.from(
        { length: sessionCount },
        (_, i) =>
          this.env.sessionManager.createSession({
            threadId: `load-test-${i}`,
            repository: 'test-repo',
            userId: `user-${i % 10}`, // 10ユーザーで分散
            guildId: 'test-guild',
            channelId: 'test-channel',
          }),
      );

      const sessions = await Promise.all(createPromises);
      const creationTime = performance.now() - startTime;

      console.log(`セッション作成完了: ${sessionCount}個 in ${creationTime.toFixed(2)}ms`);

      // 並列実行要求
      const executionStart = performance.now();
      const executionPromises = sessions.map((session) =>
        this.env.parallelController.requestExecution(session.id, Math.floor(Math.random() * 20) + 1)
      );

      await Promise.all(executionPromises);
      const executionTime = performance.now() - executionStart;

      console.log(`並列実行完了: ${executionTime.toFixed(2)}ms`);

      // 統計確認
      const stats = this.env.parallelController.getQueueStats();
      console.log('Queue Stats:', stats);

      // セッション完了処理
      const completionStart = performance.now();
      for (const session of sessions) {
        await this.env.parallelController.completeExecution(session.id);
      }
      const completionTime = performance.now() - completionStart;

      console.log(`完了処理: ${completionTime.toFixed(2)}ms`);

      // 結果レポート
      console.log('\n=== 負荷テスト結果 ===');
      console.log(`セッション数: ${sessionCount}`);
      console.log(`総実行時間: ${(performance.now() - startTime).toFixed(2)}ms`);
      console.log(`セッション作成: ${(creationTime / sessionCount).toFixed(2)}ms/session`);
      console.log(`実行開始処理: ${(executionTime / sessionCount).toFixed(2)}ms/session`);
      console.log(`完了処理: ${(completionTime / sessionCount).toFixed(2)}ms/session`);
    } finally {
      await this.env.cleanup();
    }
  }

  /**
   * メモリリークテスト
   */
  async runMemoryLeakTest(): Promise<void> {
    console.log('メモリリークテスト開始');

    await this.env.init();

    try {
      const iterations = 10;
      const sessionsPerIteration = 50;
      const memoryMeasurements: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const iterationStart = this.getMemoryUsage();

        // セッション作成・実行・削除サイクル
        const sessions = await Promise.all(
          Array.from(
            { length: sessionsPerIteration },
            (_, j) =>
              this.env.sessionManager.createSession({
                threadId: `leak-test-${i}-${j}`,
                repository: 'test-repo',
                userId: 'test-user',
                guildId: 'test-guild',
                channelId: 'test-channel',
              }),
          ),
        );

        // セッション削除
        for (const session of sessions) {
          await this.env.sessionManager.deleteSession(session.id);
        }

        // ガベージコレクション強制実行（可能であれば）
        if (typeof globalThis.gc === 'function') {
          globalThis.gc();
        }

        const iterationEnd = this.getMemoryUsage();
        const memoryIncrease = iterationEnd - iterationStart;
        memoryMeasurements.push(memoryIncrease);

        console.log(
          `Iteration ${i + 1}: Memory increase = ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`,
        );
      }

      // メモリリーク分析
      const avgIncrease = memoryMeasurements.reduce((a, b) => a + b, 0) / memoryMeasurements.length;
      const maxIncrease = Math.max(...memoryMeasurements);

      console.log('\n=== メモリリーク分析 ===');
      console.log(`平均メモリ増加: ${(avgIncrease / 1024 / 1024).toFixed(2)}MB/iteration`);
      console.log(`最大メモリ増加: ${(maxIncrease / 1024 / 1024).toFixed(2)}MB/iteration`);

      // 許容範囲チェック（1MB/iteration以下）
      const leakDetected = avgIncrease > 1024 * 1024;
      if (leakDetected) {
        console.warn('⚠️  メモリリークの可能性があります');
      } else {
        console.log('✅ メモリリークは検出されませんでした');
      }
    } finally {
      await this.env.cleanup();
    }
  }

  private getMemoryUsage(): number {
    try {
      // Private Deno API access
      return (Deno as unknown as { memoryUsage?: () => { rss: number } }).memoryUsage?.()?.rss || 0;
    } catch {
      return 0;
    }
  }
}

// 統合テスト実行
Deno.test('統合テスト - ハッピーパス', async () => {
  const scenarios = new E2ETestScenarios();
  await scenarios.testHappyPath();
});

Deno.test('統合テスト - エラーハンドリング', async () => {
  const scenarios = new E2ETestScenarios();
  await scenarios.testErrorHandling();
});

Deno.test('統合テスト - 並行処理', async () => {
  const scenarios = new E2ETestScenarios();
  await scenarios.testConcurrency();
});

Deno.test('統合テスト - セキュリティ', async () => {
  const scenarios = new E2ETestScenarios();
  await scenarios.testSecurityFeatures();
});

Deno.test('負荷テスト - 同時セッション', {
  ignore: Deno.env.get('RUN_LOAD_TESTS') !== 'true',
}, async () => {
  const loadTest = new LoadTest();
  await loadTest.runConcurrentSessionsTest();
});

Deno.test('メモリリークテスト', {
  ignore: Deno.env.get('RUN_MEMORY_TESTS') !== 'true',
}, async () => {
  const loadTest = new LoadTest();
  await loadTest.runMemoryLeakTest();
});
