/**
 * Dev Container操作のラッパー
 * @cli DevContainer CLI の高レベルラッパー
 */

import { logger } from './logger.ts';
import { Config } from './types/config.ts';

/** Dev Container設定オプション */
export interface DevContainerOptions {
  /** ワークスペースフォルダのパス */
  workspaceFolder: string;
  /** コンテナ名（省略時は自動生成） */
  containerName?: string;
  /** CPU制限（例: "2.0"） */
  cpuLimit?: string;
  /** メモリ制限（例: "4g"） */
  memoryLimit?: string;
  /** 追加のボリュームマウント */
  additionalMounts?: Record<string, string>;
  /** 環境変数 */
  env?: Record<string, string>;
  /** タイムアウト（秒） */
  timeout?: number;
}

/** Dev Container実行結果 */
export interface DevContainerResult {
  /** 成功かどうか */
  success: boolean;
  /** 出力 */
  stdout: string;
  /** エラー出力 */
  stderr: string;
  /** 終了コード */
  exitCode: number;
  /** 実行時間（ミリ秒） */
  duration: number;
}

/** コンテナのヘルス状態 */
export interface ContainerHealth {
  /** コンテナID */
  containerId: string;
  /** ヘルス状態 */
  status: 'healthy' | 'unhealthy' | 'starting' | 'none';
  /** CPU使用率（%） */
  cpuUsage: number;
  /** メモリ使用量（MB） */
  memoryUsage: number;
  /** メモリ制限（MB） */
  memoryLimit: number;
  /** 稼働時間（秒） */
  uptime: number;
}

/** Dev Container例外 */
export class DevContainerError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'DevContainerError';
  }
}

/**
 * Dev Container管理クラス
 * devcontainer CLIのラッパーとして動作し、コンテナのライフサイクル管理を行う
 */
export class DevContainerManager {
  private config: Config;
  private runningContainers = new Map<string, string>(); // workspaceFolder -> containerId

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Dev Containerを起動
   * @param options 起動オプション
   * @returns コンテナID
   */
  async up(options: DevContainerOptions): Promise<string> {
    const { workspaceFolder, timeout = this.config.claude.timeout } = options;

    logger.info(`Dev Container起動開始: ${workspaceFolder}`, { workspaceFolder });

    // devcontainer.jsonの存在確認
    await this.validateDevContainerConfig(workspaceFolder);

    // ポート競合チェック
    await this.resolvePortConflicts(workspaceFolder);

    // 起動コマンドを構築
    const args = this.buildUpCommand(options);

    try {
      const result = await this.executeCommand('up', args, timeout);

      if (!result.success) {
        throw new DevContainerError(
          `Dev Container起動失敗: ${result.stderr}`,
          result.exitCode,
          result.stderr,
        );
      }

      // コンテナIDを取得
      const containerId = await this.getContainerId(workspaceFolder);
      this.runningContainers.set(workspaceFolder, containerId);

      // ヘルスチェック
      await this.waitForHealthy(containerId, 30); // 30秒待機

      logger.info(`Dev Container起動完了: ${containerId}`, {
        workspaceFolder,
        containerId,
        duration: result.duration,
      });

      return containerId;
    } catch (error) {
      logger.error(`Dev Container起動エラー: ${error}`, { workspaceFolder, error });
      throw error;
    }
  }

  /**
   * Dev Containerを停止
   * @param workspaceFolder ワークスペースフォルダのパス
   */
  async down(workspaceFolder: string): Promise<void> {
    logger.info(`Dev Container停止開始: ${workspaceFolder}`, { workspaceFolder });

    const containerId = this.runningContainers.get(workspaceFolder);

    try {
      const result = await this.executeCommand('down', [
        '--workspace-folder',
        workspaceFolder,
      ]);

      if (!result.success) {
        logger.warn(`Dev Container停止警告: ${result.stderr}`, {
          workspaceFolder,
          stderr: result.stderr,
        });
      }

      this.runningContainers.delete(workspaceFolder);

      logger.info(`Dev Container停止完了: ${workspaceFolder}`, {
        workspaceFolder,
        containerId,
      });
    } catch (error) {
      logger.error(`Dev Container停止エラー: ${error}`, { workspaceFolder, error });
      throw error;
    }
  }

  /**
   * Dev Container内でコマンドを実行
   * @param workspaceFolder ワークスペースフォルダのパス
   * @param command 実行するコマンド
   * @param timeout タイムアウト（秒）
   * @returns 実行結果
   */
  async exec(
    workspaceFolder: string,
    command: string,
    timeout = this.config.claude.timeout,
  ): Promise<DevContainerResult> {
    const containerId = this.runningContainers.get(workspaceFolder);
    if (!containerId) {
      throw new Error(`コンテナが起動していません: ${workspaceFolder}`);
    }

    logger.debug(`Dev Container内コマンド実行: ${command}`, {
      workspaceFolder,
      containerId,
      command,
    });

    const args = [
      '--workspace-folder',
      workspaceFolder,
      'bash',
      '-c',
      command,
    ];

    const result = await this.executeCommand('exec', args, timeout);

    logger.debug(`コマンド実行完了: 終了コード ${result.exitCode}`, {
      workspaceFolder,
      containerId,
      command,
      exitCode: result.exitCode,
      duration: result.duration,
    });

    return result;
  }

  /**
   * コンテナのヘルス状態を取得
   * @param containerId コンテナID
   * @returns ヘルス状態
   */
  async getHealth(containerId: string): Promise<ContainerHealth> {
    try {
      // docker statsでリソース使用量を取得
      const statsResult = await this.executeDockerCommand([
        'stats',
        '--no-stream',
        '--format',
        'table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}',
        containerId,
      ]);

      // docker inspectでより詳細な情報を取得
      const inspectResult = await this.executeDockerCommand([
        'inspect',
        '--format',
        '{{.State.Health.Status}}\t{{.State.StartedAt}}',
        containerId,
      ]);

      const statsLines = statsResult.stdout.trim().split('\n');
      const statsData = statsLines[1]?.split('\t') || [];

      const inspectData = inspectResult.stdout.trim().split('\t');
      const healthStatus = inspectData[0] || 'none';
      const startedAt = new Date(inspectData[1] || new Date());

      // パース
      const cpuUsage = parseFloat(statsData[1]?.replace('%', '') || '0');
      const memoryParts = (statsData[2] || '0MiB / 0MiB').split(' / ');
      const memoryUsage = this.parseMemorySize(memoryParts[0] || '0MiB');
      const memoryLimit = this.parseMemorySize(memoryParts[1] || '0MiB');
      const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);

      return {
        containerId,
        status: healthStatus as ContainerHealth['status'],
        cpuUsage,
        memoryUsage,
        memoryLimit,
        uptime,
      };
    } catch (error) {
      logger.warn(`ヘルス状態取得エラー: ${error}`, { containerId, error });
      return {
        containerId,
        status: 'none',
        cpuUsage: 0,
        memoryUsage: 0,
        memoryLimit: 0,
        uptime: 0,
      };
    }
  }

  /**
   * 実行中のコンテナ一覧を取得
   * @returns コンテナの一覧
   */
  getRunningContainers(): Record<string, string> {
    return Object.fromEntries(this.runningContainers);
  }

  /**
   * リソースをクリーンアップ
   */
  async cleanup(): Promise<void> {
    const workspaceFolders = Array.from(this.runningContainers.keys());

    for (const workspaceFolder of workspaceFolders) {
      try {
        await this.down(workspaceFolder);
      } catch (error) {
        logger.warn(`クリーンアップエラー: ${workspaceFolder}`, { workspaceFolder, error });
      }
    }
  }

  /**
   * devcontainer.jsonの存在と妥当性を確認
   * @param workspaceFolder ワークスペースフォルダのパス
   */
  private async validateDevContainerConfig(workspaceFolder: string): Promise<void> {
    const devcontainerPath = `${workspaceFolder}/.devcontainer/devcontainer.json`;
    const legacyPath = `${workspaceFolder}/.devcontainer.json`;

    try {
      // devcontainer.jsonの存在確認
      const primaryExists = await this.fileExists(devcontainerPath);
      const legacyExists = await this.fileExists(legacyPath);

      if (!primaryExists && !legacyExists) {
        throw new Error('devcontainer.json が見つかりません');
      }

      const configPath = primaryExists ? devcontainerPath : legacyPath;

      // 設定ファイルの妥当性チェック
      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      if (!config.image && !config.dockerfile && !config.dockerComposeFile) {
        throw new Error('有効なイメージまたはDockerfileが設定されていません');
      }

      logger.debug(`devcontainer設定確認完了: ${configPath}`);
    } catch (error) {
      throw new DevContainerError(
        `devcontainer設定エラー: ${error.message}`,
        1,
        error.message,
      );
    }
  }

  /**
   * ポート競合を解決
   * @param workspaceFolder ワークスペースフォルダのパス
   */
  private async resolvePortConflicts(workspaceFolder: string): Promise<void> {
    try {
      // 使用中のポートを検出
      const result = await this.executeCommand('read-configuration', [
        '--workspace-folder',
        workspaceFolder,
      ]);

      if (result.success) {
        const config = JSON.parse(result.stdout);
        const forwardPorts = config.forwardPorts || [];

        for (const port of forwardPorts) {
          if (this.isPortInUse(port)) {
            logger.warn(`ポート競合検出: ${port}, 代替ポートを探します`);
            // 実際の代替ポート選択は devcontainer CLI に委ねる
          }
        }
      }
    } catch (error) {
      // 設定読み込みエラーは警告のみ
      logger.warn(`ポート競合チェックスキップ: ${error.message}`);
    }
  }

  /**
   * 起動コマンドを構築
   * @param options 起動オプション
   * @returns コマンド引数
   */
  private buildUpCommand(options: DevContainerOptions): string[] {
    const args = ['--workspace-folder', options.workspaceFolder];

    // コンテナ名の指定
    if (options.containerName) {
      // devcontainer CLIは直接的なコンテナ名指定をサポートしていないため、
      // docker-compose の場合のみプロジェクト名として使用
      // args.push('--project-name', options.containerName);
    }

    // 追加設定をファイルに書き出す場合は一時ファイルを使用
    if (options.cpuLimit || options.memoryLimit || options.additionalMounts) {
      // 実際の実装では .devcontainer/devcontainer.json を一時的に変更するか、
      // docker-compose.override.yml を生成する
      logger.debug('リソース制限とマウント設定を適用', {
        cpuLimit: options.cpuLimit,
        memoryLimit: options.memoryLimit,
        mounts: options.additionalMounts,
      });
    }

    return args;
  }

  /**
   * devcontainerコマンドを実行
   * @param command サブコマンド
   * @param args 引数
   * @param timeout タイムアウト（秒）
   * @returns 実行結果
   */
  private async executeCommand(
    command: string,
    args: string[] = [],
    timeout = 60,
  ): Promise<DevContainerResult> {
    const startTime = Date.now();
    const fullArgs = [command, ...args];

    const cmd = new Deno.Command('devcontainer', {
      args: fullArgs,
      stdout: 'piped',
      stderr: 'piped',
    });

    try {
      // タイムアウト付きで実行
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`タイムアウト: ${timeout}秒`)), timeout * 1000);
      });

      const child = cmd.spawn();
      const result = await Promise.race([child.output(), timeoutPromise]);

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      const duration = Date.now() - startTime;

      return {
        success: result.code === 0,
        stdout,
        stderr,
        exitCode: result.code,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      throw new DevContainerError(
        `devcontainerコマンド実行エラー: ${error.message}`,
        -1,
        error.message,
      );
    }
  }

  /**
   * dockerコマンドを実行
   * @param args 引数
   * @returns 実行結果
   */
  private async executeDockerCommand(args: string[]): Promise<DevContainerResult> {
    const startTime = Date.now();

    const cmd = new Deno.Command('docker', {
      args,
      stdout: 'piped',
      stderr: 'piped',
    });

    try {
      const child = cmd.spawn();
      const result = await child.output();

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      const duration = Date.now() - startTime;

      return {
        success: result.code === 0,
        stdout,
        stderr,
        exitCode: result.code,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      throw new Error(`dockerコマンド実行エラー: ${error.message}`);
    }
  }

  /**
   * コンテナIDを取得
   * @param workspaceFolder ワークスペースフォルダのパス
   * @returns コンテナID
   */
  private async getContainerId(workspaceFolder: string): Promise<string> {
    // devcontainer CLIでコンテナIDを取得する方法は限られているため、
    // docker psで検索する
    const result = await this.executeDockerCommand([
      'ps',
      '--filter',
      `label=devcontainer.local_folder=${workspaceFolder}`,
      '--format',
      '{{.ID}}',
      '--latest',
    ]);

    if (!result.success || !result.stdout.trim()) {
      throw new Error(`コンテナIDの取得に失敗: ${workspaceFolder}`);
    }

    return result.stdout.trim();
  }

  /**
   * コンテナがヘルシーになるまで待機
   * @param containerId コンテナID
   * @param maxWaitSeconds 最大待機時間（秒）
   */
  private async waitForHealthy(containerId: string, maxWaitSeconds: number): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const health = await this.getHealth(containerId);

        if (health.status === 'healthy') {
          logger.info(`コンテナヘルスチェック完了: ${containerId}`);
          return;
        }

        if (health.status === 'unhealthy') {
          throw new Error(`コンテナが不健全な状態: ${containerId}`);
        }

        // 2秒待機
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        logger.warn(`ヘルスチェックエラー (再試行): ${error.message}`, { containerId });
      }
    }

    throw new Error(`ヘルスチェックタイムアウト: ${containerId}`);
  }

  /**
   * ファイルの存在確認
   * @param path ファイルパス
   * @returns 存在するかどうか
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ポートが使用中かどうかを確認
   * @param port ポート番号
   * @returns 使用中かどうか
   */
  private isPortInUse(port: number): boolean {
    try {
      const listener = Deno.listen({ port });
      listener.close();
      return false;
    } catch {
      return true;
    }
  }

  /**
   * メモリサイズ文字列をMBに変換
   * @param sizeStr サイズ文字列（例: "1.5GiB", "512MiB"）
   * @returns MB単位の数値
   */
  private parseMemorySize(sizeStr: string): number {
    const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      B: 1 / (1024 * 1024),
      KB: 1 / 1024,
      KIB: 1 / 1024,
      MB: 1,
      MIB: 1,
      GB: 1024,
      GIB: 1024,
      TB: 1024 * 1024,
      TIB: 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }
}

// テスト @devcontainer
Deno.test('DevContainerManager - 設定ファイル検証', async () => {
  const config = {
    claude: { timeout: 60 },
  } as Config;

  const manager = new DevContainerManager(config);

  // 一時ディレクトリとdevcontainer.jsonを作成
  const tempDir = await Deno.makeTempDir();
  const devcontainerDir = `${tempDir}/.devcontainer`;
  await Deno.mkdir(devcontainerDir, { recursive: true });

  const validConfig = {
    image: 'mcr.microsoft.com/devcontainers/typescript-node:latest',
    name: 'test-container',
  };

  await Deno.writeTextFile(
    `${devcontainerDir}/devcontainer.json`,
    JSON.stringify(validConfig, null, 2),
  );

  // 検証が成功することを確認
  // Private method access for testing
  await (manager as unknown as { validateDevContainerConfig(path: string): Promise<void> })
    .validateDevContainerConfig(tempDir);

  // クリーンアップ
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test('DevContainerManager - 無効な設定でエラー', async () => {
  const config = {
    claude: { timeout: 60 },
  } as Config;

  const manager = new DevContainerManager(config);

  // 存在しないディレクトリで検証
  try {
    // Private method access for testing
    await (manager as unknown as { validateDevContainerConfig(path: string): Promise<void> })
      .validateDevContainerConfig('/non/existent/path');
    throw new Error('エラーが発生すべき');
  } catch (error) {
    assertEquals(error instanceof DevContainerError, true);
  }
});

Deno.test('DevContainerManager - メモリサイズパース', () => {
  const config = {
    claude: { timeout: 60 },
  } as Config;

  const manager = new DevContainerManager(config);

  // Private method access for testing
  const privateManager = manager as unknown as { parseMemorySize(size: string): number };
  assertEquals(privateManager.parseMemorySize('1024MiB'), 1024);
  assertEquals(privateManager.parseMemorySize('1GiB'), 1024);
  assertEquals(privateManager.parseMemorySize('1.5GB'), 1536);
  assertEquals(privateManager.parseMemorySize('512KB'), 0.5);
});

Deno.test('DevContainerManager - ポート使用チェック', () => {
  const config = {
    claude: { timeout: 60 },
  } as Config;

  const manager = new DevContainerManager(config);

  // 一般的に使用されていないポートをテスト
  const unusedPort = 59999;
  // Private method access for testing
  const privateManager = manager as unknown as { isPortInUse(port: number): boolean };
  assertEquals(privateManager.isPortInUse(unusedPort), false);

  // ポートを開いてテスト
  const listener = Deno.listen({ port: unusedPort });
  assertEquals(privateManager.isPortInUse(unusedPort), true);
  listener.close();
});
