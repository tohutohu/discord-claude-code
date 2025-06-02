/**
 * 監視・メトリクス収集システム
 * @cli システム監視とメトリクス管理
 */

import { logger } from './logger.ts';
import { Config } from './types/config.ts';
import { SessionData, SessionState } from './types/session.ts';

/** メトリクス種別 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

/** メトリクス定義 */
export interface MetricDefinition {
  /** メトリクス名 */
  name: string;
  /** 種別 */
  type: MetricType;
  /** 説明 */
  description: string;
  /** ラベル名のリスト */
  labelNames: string[];
  /** 単位 */
  unit?: string;
}

/** メトリクス値 */
export interface MetricValue {
  /** メトリクス名 */
  name: string;
  /** 値 */
  value: number;
  /** ラベル */
  labels: Record<string, string>;
  /** タイムスタンプ */
  timestamp: Date;
}

/** システムリソース使用量 */
export interface SystemResources {
  /** CPU使用率（%） */
  cpuUsage: number;
  /** メモリ使用量（MB） */
  memoryUsage: number;
  /** メモリ総量（MB） */
  memoryTotal: number;
  /** ディスク使用量（MB） */
  diskUsage: number;
  /** ディスク総量（MB） */
  diskTotal: number;
  /** ロードアベレージ */
  loadAverage: number[];
}

/** アラート設定 */
export interface AlertRule {
  /** アラート名 */
  name: string;
  /** メトリクス名 */
  metric: string;
  /** 閾値 */
  threshold: number;
  /** 比較演算子 */
  operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
  /** 継続時間（秒） */
  duration: number;
  /** 重要度 */
  severity: 'critical' | 'warning' | 'info';
  /** 通知先 */
  destinations: AlertDestination[];
  /** 説明 */
  description?: string;
}

/** アラート通知先 */
export interface AlertDestination {
  /** 種別 */
  type: 'discord' | 'webhook' | 'email';
  /** 設定 */
  config: Record<string, string>;
}

/** アラート履歴 */
export interface AlertHistory {
  /** アラートID */
  id: string;
  /** ルール名 */
  ruleName: string;
  /** 発生時刻 */
  triggeredAt: Date;
  /** 解決時刻（未解決の場合はnull） */
  resolvedAt?: Date;
  /** メトリクス値 */
  value: number;
  /** 重要度 */
  severity: AlertRule['severity'];
  /** 通知済みかどうか */
  notified: boolean;
}

/** 実行統計 */
export interface ExecutionStats {
  /** 総実行回数 */
  totalExecutions: number;
  /** 成功回数 */
  successfulExecutions: number;
  /** 失敗回数 */
  failedExecutions: number;
  /** 成功率（%） */
  successRate: number;
  /** 平均実行時間（秒） */
  avgExecutionTime: number;
  /** 最大実行時間（秒） */
  maxExecutionTime: number;
  /** 最小実行時間（秒） */
  minExecutionTime: number;
  /** 時間別統計 */
  hourlyStats: HourlyStats[];
}

/** 時間別統計 */
export interface HourlyStats {
  /** 時刻（YYYY-MM-DD HH:00:00） */
  hour: string;
  /** 実行回数 */
  executions: number;
  /** 成功回数 */
  successes: number;
  /** 平均実行時間 */
  avgTime: number;
}

/**
 * 監視・メトリクス管理クラス
 * システムリソース監視、実行統計、アラート管理を行う
 */
export class MonitoringSystem {
  private config: Config;
  private metrics = new Map<string, MetricValue[]>();
  private metricDefinitions = new Map<string, MetricDefinition>();
  private alertRules = new Map<string, AlertRule>();
  private alertHistory: AlertHistory[] = [];
  private executionHistory: Array<{
    timestamp: Date;
    duration: number;
    success: boolean;
    sessionId: string;
  }> = [];

  private monitoringInterval?: number;
  private alertCheckInterval?: number;
  private maxHistorySize = 10000;

  constructor(config: Config) {
    this.config = config;
    this.setupDefaultMetrics();
    this.setupDefaultAlerts();
    this.startMonitoring();
  }

  /**
   * メトリクスを記録
   * @param name メトリクス名
   * @param value 値
   * @param labels ラベル
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric: MetricValue = {
      name,
      value,
      labels,
      timestamp: new Date(),
    };

    const history = this.metrics.get(name) || [];
    history.push(metric);

    // 履歴サイズ制限
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }

    this.metrics.set(name, history);

    logger.debug(`メトリクス記録: ${name} = ${value}`, { name, value, labels });
  }

  /**
   * セッション実行を記録
   * @param sessionData セッションデータ
   * @param duration 実行時間（秒）
   */
  recordExecution(sessionData: SessionData, duration: number): void {
    const success = sessionData.state === SessionState.COMPLETED;

    this.executionHistory.push({
      timestamp: new Date(),
      duration,
      success,
      sessionId: sessionData.id,
    });

    // 履歴サイズ制限
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.splice(0, this.executionHistory.length - this.maxHistorySize);
    }

    // メトリクス記録
    this.recordMetric('claude_executions_total', 1, {
      status: success ? 'success' : 'failure',
      repository: sessionData.repository,
    });

    this.recordMetric('claude_execution_duration_seconds', duration, {
      repository: sessionData.repository,
    });

    logger.info(`実行統計記録: ${sessionData.id}`, {
      sessionId: sessionData.id,
      duration,
      success,
      repository: sessionData.repository,
    });
  }

  /**
   * システムリソースを取得
   * @returns システムリソース情報
   */
  async getSystemResources(): Promise<SystemResources> {
    try {
      // CPU使用率を取得（top コマンド使用）
      const cpuResult = await this.executeCommand(
        `top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//'`,
      );
      const cpuUsage = parseFloat(cpuResult.stdout.trim()) || 0;

      // メモリ情報を取得（vm_stat 使用）
      const memResult = await this.executeCommand('vm_stat');
      const memoryInfo = this.parseMemoryInfo(memResult.stdout);

      // ディスク使用量を取得（df 使用）
      const diskResult = await this.executeCommand('df -h /');
      const diskInfo = this.parseDiskInfo(diskResult.stdout);

      // ロードアベレージを取得
      const loadResult = await this.executeCommand('uptime');
      const loadAverage = this.parseLoadAverage(loadResult.stdout);

      return {
        cpuUsage,
        memoryUsage: memoryInfo.used,
        memoryTotal: memoryInfo.total,
        diskUsage: diskInfo.used,
        diskTotal: diskInfo.total,
        loadAverage,
      };
    } catch (error) {
      logger.warn(`システムリソース取得エラー: ${error}`, { error });
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        memoryTotal: 0,
        diskUsage: 0,
        diskTotal: 0,
        loadAverage: [0, 0, 0],
      };
    }
  }

  /**
   * 実行統計を取得
   * @param hours 過去何時間分か（デフォルト24時間）
   * @returns 実行統計
   */
  getExecutionStats(hours = 24): ExecutionStats {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentExecutions = this.executionHistory.filter(
      (exec) => exec.timestamp >= cutoff,
    );

    const totalExecutions = recentExecutions.length;
    const successfulExecutions = recentExecutions.filter((exec) => exec.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    const durations = recentExecutions.map((exec) => exec.duration);
    const avgExecutionTime = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const maxExecutionTime = durations.length > 0 ? Math.max(...durations) : 0;
    const minExecutionTime = durations.length > 0 ? Math.min(...durations) : 0;

    // 時間別統計を生成
    const hourlyStats = this.generateHourlyStats(recentExecutions, hours);

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate,
      avgExecutionTime,
      maxExecutionTime,
      minExecutionTime,
      hourlyStats,
    };
  }

  /**
   * Prometheus形式でメトリクスをエクスポート
   * @returns Prometheus形式の文字列
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];

    for (const [name, definition] of this.metricDefinitions) {
      // メトリクス定義を追加
      lines.push(`# HELP ${name} ${definition.description}`);
      lines.push(`# TYPE ${name} ${definition.type}`);

      // メトリクス値を追加
      const values = this.metrics.get(name) || [];
      const latestValues = new Map<string, MetricValue>();

      // 最新の値のみを取得（同じラベルの場合）
      for (const value of values) {
        const labelKey = this.serializeLabels(value.labels);
        latestValues.set(labelKey, value);
      }

      for (const value of latestValues.values()) {
        const labelsStr = this.formatPrometheusLabels(value.labels);
        lines.push(`${name}${labelsStr} ${value.value} ${value.timestamp.getTime()}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * アラートルールを追加
   * @param rule アラートルール
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.name, rule);
    logger.info(`アラートルール追加: ${rule.name}`, { rule });
  }

  /**
   * アラート履歴を取得
   * @param limit 取得件数（デフォルト50）
   * @returns アラート履歴
   */
  getAlertHistory(limit = 50): AlertHistory[] {
    return this.alertHistory
      .slice(-limit)
      .reverse(); // 新しい順
  }

  /**
   * 監視を停止
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
    }
    logger.info('監視システムを停止しました');
  }

  /**
   * デフォルトメトリクスを設定
   */
  private setupDefaultMetrics(): void {
    const metrics: MetricDefinition[] = [
      {
        name: 'claude_executions_total',
        type: MetricType.COUNTER,
        description: 'Total number of Claude executions',
        labelNames: ['status', 'repository'],
      },
      {
        name: 'claude_execution_duration_seconds',
        type: MetricType.HISTOGRAM,
        description: 'Duration of Claude executions in seconds',
        labelNames: ['repository'],
        unit: 'seconds',
      },
      {
        name: 'claude_active_sessions',
        type: MetricType.GAUGE,
        description: 'Number of active Claude sessions',
        labelNames: ['state'],
      },
      {
        name: 'system_cpu_usage_percent',
        type: MetricType.GAUGE,
        description: 'System CPU usage percentage',
        labelNames: [],
        unit: 'percent',
      },
      {
        name: 'system_memory_usage_bytes',
        type: MetricType.GAUGE,
        description: 'System memory usage in bytes',
        labelNames: ['type'],
        unit: 'bytes',
      },
      {
        name: 'system_disk_usage_bytes',
        type: MetricType.GAUGE,
        description: 'System disk usage in bytes',
        labelNames: ['type'],
        unit: 'bytes',
      },
    ];

    for (const metric of metrics) {
      this.metricDefinitions.set(metric.name, metric);
    }

    logger.info(`デフォルトメトリクス設定完了: ${metrics.length}件`);
  }

  /**
   * デフォルトアラートを設定
   */
  private setupDefaultAlerts(): void {
    const rules: AlertRule[] = [
      {
        name: 'high_error_rate',
        metric: 'claude_executions_total',
        threshold: 50, // 50%以上のエラー率
        operator: '>',
        duration: 300, // 5分間継続
        severity: 'critical',
        destinations: [{ type: 'discord', config: {} }],
        description: 'Claude実行エラー率が高い',
      },
      {
        name: 'high_cpu_usage',
        metric: 'system_cpu_usage_percent',
        threshold: 80, // 80%以上のCPU使用率
        operator: '>',
        duration: 300, // 5分間継続
        severity: 'warning',
        destinations: [{ type: 'discord', config: {} }],
        description: 'システムCPU使用率が高い',
      },
      {
        name: 'high_memory_usage',
        metric: 'system_memory_usage_bytes',
        threshold: 90, // 90%以上のメモリ使用率
        operator: '>',
        duration: 300, // 5分間継続
        severity: 'warning',
        destinations: [{ type: 'discord', config: {} }],
        description: 'システムメモリ使用率が高い',
      },
    ];

    for (const rule of rules) {
      this.alertRules.set(rule.name, rule);
    }

    logger.info(`デフォルトアラート設定完了: ${rules.length}件`);
  }

  /**
   * 監視を開始
   */
  private startMonitoring(): void {
    // システムリソース監視（30秒間隔）
    this.monitoringInterval = setInterval(async () => {
      try {
        const resources = await this.getSystemResources();

        this.recordMetric('system_cpu_usage_percent', resources.cpuUsage);
        this.recordMetric('system_memory_usage_bytes', resources.memoryUsage * 1024 * 1024, {
          type: 'used',
        });
        this.recordMetric('system_memory_usage_bytes', resources.memoryTotal * 1024 * 1024, {
          type: 'total',
        });
        this.recordMetric('system_disk_usage_bytes', resources.diskUsage * 1024 * 1024, {
          type: 'used',
        });
        this.recordMetric('system_disk_usage_bytes', resources.diskTotal * 1024 * 1024, {
          type: 'total',
        });
      } catch (error) {
        logger.warn(`監視エラー: ${error}`, { error });
      }
    }, 30000);

    // アラートチェック（60秒間隔）
    this.alertCheckInterval = setInterval(() => {
      this.checkAlerts();
    }, 60000);

    logger.info('監視システムを開始しました');
  }

  /**
   * アラートをチェック
   */
  private checkAlerts(): void {
    for (const [name, rule] of this.alertRules) {
      try {
        const isTriggered = this.evaluateAlertRule(rule);

        if (isTriggered) {
          this.triggerAlert(rule);
        }
      } catch (error) {
        logger.error(`アラート評価エラー: ${name}`, { rule: name, error });
      }
    }
  }

  /**
   * アラートルールを評価
   * @param rule アラートルール
   * @returns アラートが発火するかどうか
   */
  private evaluateAlertRule(rule: AlertRule): boolean {
    const values = this.metrics.get(rule.metric) || [];
    const cutoff = new Date(Date.now() - rule.duration * 1000);

    // 継続時間内の値を取得
    const recentValues = values.filter((v) => v.timestamp >= cutoff);

    if (recentValues.length === 0) return false;

    // 最新の値で判定
    const latestValue = recentValues[recentValues.length - 1];

    switch (rule.operator) {
      case '>':
        return latestValue.value > rule.threshold;
      case '<':
        return latestValue.value < rule.threshold;
      case '>=':
        return latestValue.value >= rule.threshold;
      case '<=':
        return latestValue.value <= rule.threshold;
      case '=':
        return latestValue.value === rule.threshold;
      case '!=':
        return latestValue.value !== rule.threshold;
      default:
        return false;
    }
  }

  /**
   * アラートを発火
   * @param rule アラートルール
   */
  private triggerAlert(rule: AlertRule): void {
    const alertId = crypto.randomUUID();
    const values = this.metrics.get(rule.metric) || [];
    const latestValue = values[values.length - 1];

    const alert: AlertHistory = {
      id: alertId,
      ruleName: rule.name,
      triggeredAt: new Date(),
      value: latestValue?.value || 0,
      severity: rule.severity,
      notified: false,
    };

    this.alertHistory.push(alert);

    // 通知を送信
    this.sendAlertNotifications(rule, alert);

    logger.warn(`アラート発火: ${rule.name}`, { rule, alert });
  }

  /**
   * アラート通知を送信
   * @param rule アラートルール
   * @param alert アラート履歴
   */
  private async sendAlertNotifications(rule: AlertRule, alert: AlertHistory): Promise<void> {
    for (const destination of rule.destinations) {
      try {
        await this.sendNotification(destination, rule, alert);
        alert.notified = true;
      } catch (error) {
        logger.error(`アラート通知エラー: ${destination.type}`, { rule, alert, error });
      }
    }
  }

  /**
   * 通知を送信
   * @param destination 通知先
   * @param rule アラートルール
   * @param alert アラート履歴
   */
  private sendNotification(
    destination: AlertDestination,
    rule: AlertRule,
    alert: AlertHistory,
  ): Promise<void> {
    switch (destination.type) {
      case 'discord':
        // Discord通知の実装（実際のDiscordクライアントとの連携が必要）
        logger.info(`Discord通知: ${rule.name} - ${rule.description}`, { rule, alert });
        break;
      case 'webhook':
        // Webhook通知の実装
        logger.info(`Webhook通知: ${rule.name}`, { rule, alert });
        break;
      default:
        logger.warn(`未対応の通知先: ${destination.type}`);
    }
  }

  /**
   * 時間別統計を生成
   * @param executions 実行履歴
   * @param hours 時間数
   * @returns 時間別統計
   */
  private generateHourlyStats(
    executions: Array<{ timestamp: Date; duration: number; success: boolean }>,
    hours: number,
  ): HourlyStats[] {
    const stats: HourlyStats[] = [];
    const now = new Date();

    for (let i = hours - 1; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
      hour.setMinutes(0, 0, 0);

      const nextHour = new Date(hour.getTime() + 60 * 60 * 1000);

      const hourExecutions = executions.filter(
        (exec) => exec.timestamp >= hour && exec.timestamp < nextHour,
      );

      const successes = hourExecutions.filter((exec) => exec.success).length;
      const durations = hourExecutions.map((exec) => exec.duration);
      const avgTime = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      stats.push({
        hour: hour.toISOString().slice(0, 13) + ':00:00',
        executions: hourExecutions.length,
        successes,
        avgTime,
      });
    }

    return stats;
  }

  /**
   * コマンドを実行
   * @param command コマンド
   * @returns 実行結果
   */
  private async executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    const cmd = new Deno.Command('bash', {
      args: ['-c', command],
      stdout: 'piped',
      stderr: 'piped',
    });

    const child = cmd.spawn();
    const result = await child.output();

    return {
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  }

  /**
   * メモリ情報をパース
   * @param vmstatOutput vm_stat の出力
   * @returns メモリ情報（MB）
   */
  private parseMemoryInfo(vmstatOutput: string): { used: number; total: number } {
    try {
      const lines = vmstatOutput.split('\n');
      const pageSize = 4096; // 4KB

      let freePages = 0;
      let inactivePages = 0;

      for (const line of lines) {
        if (line.includes('Pages free:')) {
          freePages = parseInt(line.split(':')[1].trim().replace('.', ''));
        } else if (line.includes('Pages inactive:')) {
          inactivePages = parseInt(line.split(':')[1].trim().replace('.', ''));
        }
      }

      // 簡易計算（実際はより複雑）
      const totalMemory = 8 * 1024; // 8GB想定
      const freeMemory = (freePages + inactivePages) * pageSize / (1024 * 1024);

      return {
        used: totalMemory - freeMemory,
        total: totalMemory,
      };
    } catch {
      return { used: 0, total: 0 };
    }
  }

  /**
   * ディスク情報をパース
   * @param dfOutput df の出力
   * @returns ディスク情報（MB）
   */
  private parseDiskInfo(dfOutput: string): { used: number; total: number } {
    try {
      const lines = dfOutput.split('\n');
      const dataLine = lines[1]; // ヘッダーの次の行
      const parts = dataLine.trim().split(/\s+/);

      const total = parseInt(parts[1]) / 1024; // KB to MB
      const used = parseInt(parts[2]) / 1024; // KB to MB

      return { used, total };
    } catch {
      return { used: 0, total: 0 };
    }
  }

  /**
   * ロードアベレージをパース
   * @param uptimeOutput uptime の出力
   * @returns ロードアベレージ
   */
  private parseLoadAverage(uptimeOutput: string): number[] {
    try {
      const match = uptimeOutput.match(/load averages?:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (match) {
        return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
      }
    } catch {
      // パースエラー
    }
    return [0, 0, 0];
  }

  /**
   * ラベルを文字列にシリアライズ
   * @param labels ラベル
   * @returns シリアライズされた文字列
   */
  private serializeLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
  }

  /**
   * Prometheus形式のラベルをフォーマット
   * @param labels ラベル
   * @returns フォーマットされたラベル文字列
   */
  private formatPrometheusLabels(labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) return '';

    const labelPairs = Object.entries(labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');

    return `{${labelPairs}}`;
  }
}

// テスト @monitoring
Deno.test('MonitoringSystem - メトリクス記録', () => {
  const config = {} as Config;
  const monitoring = new MonitoringSystem(config);

  monitoring.recordMetric('test_metric', 42, { label: 'value' });

  // Private property access for testing
  const metrics = (monitoring as unknown as { metrics: Map<string, MetricValue[]> }).metrics.get(
    'test_metric',
  );
  assertEquals(metrics.length, 1);
  assertEquals(metrics[0].value, 42);
  assertEquals(metrics[0].labels.label, 'value');

  monitoring.stop();
});

Deno.test('MonitoringSystem - Prometheusエクスポート', () => {
  const config = {} as Config;
  const monitoring = new MonitoringSystem(config);

  monitoring.recordMetric('claude_executions_total', 5, { status: 'success' });

  const prometheus = monitoring.exportPrometheusMetrics();
  assertEquals(prometheus.includes('claude_executions_total'), true);
  assertEquals(prometheus.includes('status="success"'), true);

  monitoring.stop();
});

Deno.test('MonitoringSystem - アラート評価', () => {
  const config = {} as Config;
  const monitoring = new MonitoringSystem(config);

  const rule: AlertRule = {
    name: 'test_alert',
    metric: 'test_metric',
    threshold: 50,
    operator: '>',
    duration: 60,
    severity: 'warning',
    destinations: [],
  };

  monitoring.recordMetric('test_metric', 60);

  // Private method access for testing
  const isTriggered = (monitoring as unknown as { evaluateAlertRule(rule: AlertRule): boolean })
    .evaluateAlertRule(rule);
  assertEquals(isTriggered, true);

  monitoring.stop();
});
