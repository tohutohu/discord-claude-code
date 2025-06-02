/**
 * ヘルスチェックと運用監視
 * @cli 運用監視機能の実装
 */

import { logger } from './logger.ts';
import { Config } from './types/config.ts';
import { MonitoringSystem } from './monitoring.ts';
import { SessionManager } from './sessionManager.ts';
import { ParallelController } from './parallelController.ts';

/** ヘルス状態 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/** ヘルスチェック結果 */
export interface HealthCheckResult {
  /** 全体のステータス */
  status: HealthStatus;
  /** チェック実行時刻 */
  timestamp: Date;
  /** 各コンポーネントの詳細 */
  components: Record<string, ComponentHealth>;
  /** システム情報 */
  system: SystemInfo;
  /** 応答時間（ミリ秒） */
  responseTime: number;
}

/** コンポーネントヘルス */
export interface ComponentHealth {
  /** ステータス */
  status: HealthStatus;
  /** メッセージ */
  message: string;
  /** 詳細情報 */
  details?: Record<string, unknown>;
  /** レスポンス時間（ミリ秒） */
  responseTime: number;
}

/** システム情報 */
export interface SystemInfo {
  /** アップタイム（秒） */
  uptime: number;
  /** メモリ使用量（MB） */
  memoryUsage: number;
  /** CPU使用率（%） */
  cpuUsage: number;
  /** バージョン */
  version: string;
  /** 環境 */
  environment: string;
  /** プロセスID */
  processId: number;
}

/** グレースフルシャットダウンハンドラー */
export type ShutdownHandler = () => Promise<void>;

/**
 * ヘルスチェック監視システム
 */
export class HealthMonitor {
  private config: Config;
  private sessionManager?: SessionManager;
  private parallelController?: ParallelController;
  private monitoring?: MonitoringSystem;
  private server?: Deno.HttpServer;
  private startTime = Date.now();
  private shutdownHandlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  constructor(config: Config) {
    this.config = config;
    this.setupSignalHandlers();
  }

  /**
   * コンポーネントを登録
   */
  registerComponents(
    sessionManager: SessionManager,
    parallelController: ParallelController,
    monitoring: MonitoringSystem,
  ): void {
    this.sessionManager = sessionManager;
    this.parallelController = parallelController;
    this.monitoring = monitoring;
  }

  /**
   * ヘルスチェックサーバーを開始
   * @param port ポート番号
   */
  startHealthServer(port = 3000): Promise<void> {
    const handler = (request: Request): Response => {
      const url = new URL(request.url);

      switch (url.pathname) {
        case '/health':
          return this.handleHealthCheck();
        case '/health/liveness':
          return this.handleLivenessCheck();
        case '/health/readiness':
          return this.handleReadinessCheck();
        case '/metrics':
          return this.handleMetrics();
        case '/info':
          return this.handleInfo();
        default:
          return new Response('Not Found', { status: 404 });
      }
    };

    this.server = Deno.serve({ port }, handler);
    logger.info(`ヘルスチェックサーバーを開始: http://localhost:${port}`, { port });
  }

  /**
   * ヘルスチェックサーバーを停止
   */
  async stopHealthServer(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      logger.info('ヘルスチェックサーバーを停止しました');
    }
  }

  /**
   * シャットダウンハンドラーを追加
   */
  addShutdownHandler(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * グレースフルシャットダウンを実行
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('グレースフルシャットダウンを開始...');

    try {
      // タイムアウト付きでシャットダウンハンドラーを実行
      const shutdownPromises = this.shutdownHandlers.map((handler) =>
        Promise.race([
          handler(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), 30000)
          ),
        ])
      );

      await Promise.allSettled(shutdownPromises);

      // ヘルスチェックサーバーを停止
      await this.stopHealthServer();

      logger.info('グレースフルシャットダウン完了');
    } catch (error) {
      logger.error('シャットダウンエラー', { error });
    }

    Deno.exit(0);
  }

  /**
   * 完全なヘルスチェック
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    const components: Record<string, ComponentHealth> = {};

    // セッション管理のヘルスチェック
    if (this.sessionManager) {
      components.sessionManager = await this.checkSessionManager();
    }

    // 並列制御のヘルスチェック
    if (this.parallelController) {
      components.parallelController = await this.checkParallelController();
    }

    // 監視システムのヘルスチェック
    if (this.monitoring) {
      components.monitoring = await this.checkMonitoring();
    }

    // データベース接続のヘルスチェック
    components.database = await this.checkDatabase();

    // ディスク容量のヘルスチェック
    components.diskSpace = await this.checkDiskSpace();

    // 全体のステータスを判定
    const overallStatus = this.determineOverallStatus(components);

    const responseTime = performance.now() - startTime;

    return {
      status: overallStatus,
      timestamp: new Date(),
      components,
      system: await this.getSystemInfo(),
      responseTime,
    };
  }

  /**
   * セッション管理のヘルスチェック
   */
  private async checkSessionManager(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      if (!this.sessionManager) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Session manager not initialized',
          responseTime: performance.now() - startTime,
        };
      }

      // セッション統計を取得
      const stats = await this.sessionManager.getStats();
      const activeCount = stats.byState.RUNNING + stats.byState.WAITING + stats.byState.READY;

      const status = activeCount > 100 ? HealthStatus.DEGRADED : HealthStatus.HEALTHY;

      return {
        status,
        message: `${activeCount} active sessions`,
        details: {
          totalSessions: stats.total,
          activeSessions: activeCount,
          errorRate: stats.errorRate,
        },
        responseTime: performance.now() - startTime,
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Session manager error: ${error.message}`,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * 並列制御のヘルスチェック
   */
  private checkParallelController(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      if (!this.parallelController) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Parallel controller not initialized',
          responseTime: performance.now() - startTime,
        };
      }

      const stats = this.parallelController.getQueueStats();
      const utilizationRate = stats.running / stats.maxSessions;

      let status = HealthStatus.HEALTHY;
      if (utilizationRate > 0.9) {
        status = HealthStatus.DEGRADED;
      }
      if (stats.waiting > 50) {
        status = HealthStatus.DEGRADED;
      }

      return {
        status,
        message: `${stats.running}/${stats.maxSessions} running, ${stats.waiting} waiting`,
        details: {
          running: stats.running,
          waiting: stats.waiting,
          maxSessions: stats.maxSessions,
          utilizationRate: utilizationRate * 100,
        },
        responseTime: performance.now() - startTime,
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Parallel controller error: ${error.message}`,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * 監視システムのヘルスチェック
   */
  private async checkMonitoring(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      if (!this.monitoring) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Monitoring system not initialized',
          responseTime: performance.now() - startTime,
        };
      }

      // システムリソースを取得
      const resources = await this.monitoring.getSystemResources();

      let status = HealthStatus.HEALTHY;
      if (resources.cpuUsage > 80 || resources.memoryUsage / resources.memoryTotal > 0.9) {
        status = HealthStatus.DEGRADED;
      }
      if (resources.cpuUsage > 95 || resources.memoryUsage / resources.memoryTotal > 0.95) {
        status = HealthStatus.UNHEALTHY;
      }

      return {
        status,
        message: `CPU: ${resources.cpuUsage.toFixed(1)}%, Memory: ${
          (resources.memoryUsage / resources.memoryTotal * 100).toFixed(1)
        }%`,
        details: {
          cpuUsage: resources.cpuUsage,
          memoryUsage: resources.memoryUsage,
          memoryTotal: resources.memoryTotal,
          diskUsage: resources.diskUsage,
          loadAverage: resources.loadAverage,
        },
        responseTime: performance.now() - startTime,
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Monitoring system error: ${error.message}`,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * データベース接続のヘルスチェック
   */
  private async checkDatabase(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      // 簡易的なデータベースチェック（設定ファイルの読み込み）
      const configPath = '~/.claude-bot/claude-bot.yaml';
      await Deno.stat(configPath.replace('~', Deno.env.get('HOME') || '~'));

      return {
        status: HealthStatus.HEALTHY,
        message: 'Configuration accessible',
        responseTime: performance.now() - startTime,
      };
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: `Configuration access issue: ${error.message}`,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * ディスク容量のヘルスチェック
   */
  private async checkDiskSpace(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      // df コマンドでディスク容量を確認
      const cmd = new Deno.Command('df', {
        args: ['-h', '/'],
        stdout: 'piped',
        stderr: 'piped',
      });

      const result = await cmd.output();

      if (result.code === 0) {
        const output = new TextDecoder().decode(result.stdout);
        const lines = output.split('\n');
        const dataLine = lines[1];
        const parts = dataLine.trim().split(/\s+/);
        const usagePercent = parseInt(parts[4].replace('%', ''));

        let status = HealthStatus.HEALTHY;
        if (usagePercent > 80) status = HealthStatus.DEGRADED;
        if (usagePercent > 95) status = HealthStatus.UNHEALTHY;

        return {
          status,
          message: `Disk usage: ${usagePercent}%`,
          details: {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usagePercent,
          },
          responseTime: performance.now() - startTime,
        };
      } else {
        throw new Error('Failed to check disk space');
      }
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: `Disk check failed: ${error.message}`,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * システム情報を取得
   */
  private getSystemInfo(): Promise<SystemInfo> {
    const uptime = (Date.now() - this.startTime) / 1000;

    // メモリ使用量を取得
    let memoryUsage = 0;
    try {
      memoryUsage = (Deno as { memoryUsage?: () => { rss?: number } }).memoryUsage?.()?.rss || 0;
    } catch {
      // フォールバック
    }

    return {
      uptime,
      memoryUsage: memoryUsage / 1024 / 1024, // MB
      cpuUsage: 0, // 簡易実装では0
      version: '1.0.0', // package.json から取得すべき
      environment: Deno.env.get('NODE_ENV') || 'production',
      processId: Deno.pid,
    };
  }

  /**
   * 全体のヘルス状態を判定
   */
  private determineOverallStatus(components: Record<string, ComponentHealth>): HealthStatus {
    const statuses = Object.values(components).map((c) => c.status);

    if (statuses.includes(HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }
    if (statuses.includes(HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }
    return HealthStatus.HEALTHY;
  }

  /**
   * ヘルスチェックエンドポイント
   */
  private handleHealthCheck(): Response {
    return this.asyncToResponse(async () => {
      const result = await this.performHealthCheck();
      const status = result.status === HealthStatus.HEALTHY
        ? 200
        : result.status === HealthStatus.DEGRADED
        ? 200
        : 503;

      return new Response(JSON.stringify(result, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  /**
   * Livenessチェックエンドポイント
   */
  private handleLivenessCheck(): Response {
    return new Response(
      JSON.stringify({
        status: 'alive',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  /**
   * Readinessチェックエンドポイント
   */
  private handleReadinessCheck(): Response {
    const ready = !this.isShuttingDown &&
      this.sessionManager !== undefined &&
      this.parallelController !== undefined;

    return new Response(
      JSON.stringify({
        status: ready ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
      }),
      {
        status: ready ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  /**
   * メトリクスエンドポイント
   */
  private handleMetrics(): Response {
    return this.asyncToResponse(() => {
      if (!this.monitoring) {
        return new Response('Monitoring not available', { status: 503 });
      }

      const metrics = this.monitoring.exportPrometheusMetrics();
      return new Response(metrics, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
  }

  /**
   * 情報エンドポイント
   */
  private handleInfo(): Response {
    return this.asyncToResponse(() => {
      const info = {
        version: '1.0.0',
        buildTime: '2025-06-02T10:00:00Z',
        gitCommit: 'abc123def',
        environment: Deno.env.get('NODE_ENV') || 'production',
        uptime: (Date.now() - this.startTime) / 1000,
        processId: Deno.pid,
      };

      return new Response(JSON.stringify(info, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  /**
   * 非同期関数をResponseに変換するヘルパー
   */
  private asyncToResponse(fn: () => Promise<Response>): Response {
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const response = await fn();
            const reader = response.body?.getReader();
            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * シグナルハンドラーを設定
   */
  private setupSignalHandlers(): void {
    const signals: Deno.Signal[] = ['SIGTERM', 'SIGINT'];

    for (const signal of signals) {
      Deno.addSignalListener(signal, () => {
        logger.info(`${signal} シグナルを受信、グレースフルシャットダウンを開始`);
        this.shutdown();
      });
    }
  }
}

// CLI として直接実行された場合
if (import.meta.main) {
  const healthMonitor = new HealthMonitor({} as Config);
  await healthMonitor.startHealthServer(3000);

  console.log('ヘルスチェックサーバーが起動しました');
  console.log('http://localhost:3000/health - フルヘルスチェック');
  console.log('http://localhost:3000/health/liveness - Liveness probe');
  console.log('http://localhost:3000/health/readiness - Readiness probe');
  console.log('http://localhost:3000/metrics - Prometheus メトリクス');
  console.log('http://localhost:3000/info - システム情報');
}
