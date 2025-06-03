// DevContainer管理機能
// devcontainer CLI のラッパーとして、Health Check、リソース制限、
// ボリュームマウント最適化、エラー処理を行う

import { exists, join } from './deps.ts';

/**
 * DevContainer設定
 */
export interface DevContainerConfig {
  /** コンテナ名 */
  name?: string;
  /** イメージ名 */
  image?: string;
  /** ワークスペースフォルダ */
  workspaceFolder?: string;
  /** フォワードポート */
  forwardPorts?: number[];
  /** ポストCreateコマンド */
  postCreateCommand?: string | string[];
  /** 機能拡張 */
  features?: Record<string, unknown>;
  /** VS Code設定 */
  customizations?: {
    vscode?: {
      extensions?: string[];
      settings?: Record<string, unknown>;
    };
  };
  /** マウント設定 */
  mounts?: string[];
  /** 環境変数 */
  containerEnv?: Record<string, string>;
  /** リソース制限 */
  runArgs?: string[];
}

/**
 * DevContainer起動オプション
 */
export interface DevContainerStartOptions {
  /** ワークスペースフォルダ */
  workspaceFolder: string;
  /** タイムアウト（秒） */
  timeout?: number;
  /** ログレベル */
  logLevel?: 'silent' | 'info' | 'debug' | 'trace';
  /** リソース制限 */
  resourceLimits?: {
    /** CPU制限（例: "1.5"） */
    cpus?: string;
    /** メモリ制限（例: "2g"） */
    memory?: string;
  };
  /** 追加環境変数 */
  additionalEnv?: Record<string, string>;
  /** ポート競合時の自動調整 */
  autoResolvePortConflicts?: boolean;
}

/**
 * DevContainer実行結果
 */
export interface DevContainerResult {
  /** 成功フラグ */
  success: boolean;
  /** コンテナID */
  containerId?: string;
  /** 出力 */
  stdout?: string;
  /** エラー出力 */
  stderr?: string;
  /** 終了コード */
  exitCode?: number;
  /** 実行時間（ミリ秒） */
  duration?: number;
}

/**
 * DevContainer Health Check結果
 */
export interface DevContainerHealthStatus {
  /** 稼働中フラグ */
  running: boolean;
  /** コンテナID */
  containerId?: string;
  /** 状態 */
  status?: string;
  /** ヘルスチェック結果 */
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  /** 最終確認時刻 */
  lastChecked: Date;
}

/**
 * デフォルトのdevcontainer.json設定を生成
 */
export function createDefaultDevContainerConfig(): DevContainerConfig {
  return {
    name: 'Claude Development Environment',
    image: 'mcr.microsoft.com/vscode/devcontainers/typescript-node:20',
    workspaceFolder: '/workspace',
    features: {
      'ghcr.io/devcontainers/features/git:1': {},
      'ghcr.io/devcontainers/features/github-cli:1': {},
    },
    customizations: {
      vscode: {
        extensions: [
          'ms-vscode.vscode-typescript-next',
          'bradlc.vscode-tailwindcss',
          'esbenp.prettier-vscode',
        ],
        settings: {
          'typescript.preferences.noSemicolons': 'on',
          'typescript.preferences.quotestyle': 'single',
        },
      },
    },
    forwardPorts: [3000, 8000, 9000],
    postCreateCommand: 'npm install',
    containerEnv: {
      TZ: 'Asia/Tokyo',
    },
    mounts: [
      'source=${localWorkspaceFolder}/.devcontainer/.zsh_history,target=/root/.zsh_history,type=bind,consistency=cached',
      'source=${localWorkspaceFolder}/.devcontainer/.cache,target=/root/.cache,type=bind,consistency=cached',
    ],
    runArgs: [
      '--cpus=2',
      '--memory=4g',
      '--security-opt=seccomp=unconfined',
    ],
  };
}

/**
 * devcontainer.jsonファイルの存在確認
 */
export async function checkDevContainerConfig(workspaceFolder: string): Promise<boolean> {
  const devcontainerDir = join(workspaceFolder, '.devcontainer');
  const devcontainerFile = join(devcontainerDir, 'devcontainer.json');

  return await exists(devcontainerFile);
}

/**
 * devcontainer.jsonファイルを読み込み
 */
export async function readDevContainerConfig(workspaceFolder: string): Promise<DevContainerConfig> {
  const devcontainerFile = join(workspaceFolder, '.devcontainer', 'devcontainer.json');

  try {
    const content = await Deno.readTextFile(devcontainerFile);
    // JSONのコメントを削除（簡易的な処理）
    const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    return JSON.parse(cleanJson) as DevContainerConfig;
  } catch (error) {
    throw new Error(
      `devcontainer.jsonの読み込みに失敗: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * devcontainer.jsonファイルを作成
 */
export async function createDevContainerConfig(
  workspaceFolder: string,
  config?: Partial<DevContainerConfig>,
): Promise<void> {
  const devcontainerDir = join(workspaceFolder, '.devcontainer');
  const devcontainerFile = join(devcontainerDir, 'devcontainer.json');

  // .devcontainerディレクトリを作成
  await Deno.mkdir(devcontainerDir, { recursive: true });

  // デフォルト設定とマージ
  const finalConfig = {
    ...createDefaultDevContainerConfig(),
    ...config,
  };

  // devcontainer.jsonを作成
  const jsonContent = JSON.stringify(finalConfig, null, 2);
  await Deno.writeTextFile(devcontainerFile, jsonContent);
}

/**
 * 利用可能なポートを検索
 */
export function findAvailablePort(
  startPort: number,
  endPort: number = startPort + 100,
): number {
  for (let port = startPort; port <= endPort; port++) {
    try {
      const listener = Deno.listen({ port });
      listener.close();
      return port;
    } catch {
      // ポートが使用中の場合は次のポートを試す
      continue;
    }
  }
  throw new Error(`利用可能なポートが見つかりません (${startPort}-${endPort})`);
}

/**
 * ポート競合を解決してdevcontainer.jsonを更新
 */
export async function resolvePortConflicts(
  workspaceFolder: string,
  config: DevContainerConfig,
): Promise<DevContainerConfig> {
  if (!config.forwardPorts || config.forwardPorts.length === 0) {
    return config;
  }

  const resolvedPorts: number[] = [];

  for (const port of config.forwardPorts) {
    try {
      const availablePort = findAvailablePort(port);
      resolvedPorts.push(availablePort);

      if (availablePort !== port) {
        console.log(`ポート競合を解決: ${port} -> ${availablePort}`);
      }
    } catch (error) {
      console.warn(`ポート ${port} の解決に失敗:`, error);
      // 失敗した場合は元のポートを使用
      resolvedPorts.push(port);
    }
  }

  const updatedConfig = {
    ...config,
    forwardPorts: resolvedPorts,
  };

  // 更新されたdevcontainer.jsonを保存
  const devcontainerFile = join(workspaceFolder, '.devcontainer', 'devcontainer.json');
  await Deno.writeTextFile(devcontainerFile, JSON.stringify(updatedConfig, null, 2));

  return updatedConfig;
}

/**
 * DevContainerを起動
 */
export async function startDevContainer(
  options: DevContainerStartOptions,
): Promise<DevContainerResult> {
  const startTime = Date.now();
  const { workspaceFolder, timeout = 300, logLevel = 'info', resourceLimits, additionalEnv } =
    options;

  try {
    // devcontainer.jsonの存在確認
    const hasDevContainer = await checkDevContainerConfig(workspaceFolder);

    if (!hasDevContainer) {
      console.log('devcontainer.jsonが見つかりません。デフォルト設定で作成します。');
      await createDevContainerConfig(workspaceFolder);
    }

    // 設定読み込み
    let config = await readDevContainerConfig(workspaceFolder);

    // ポート競合の自動解決
    if (options.autoResolvePortConflicts) {
      config = await resolvePortConflicts(workspaceFolder, config);
    }

    // リソース制限の適用
    if (resourceLimits) {
      const runArgs = config.runArgs || [];

      if (resourceLimits.cpus) {
        // 既存のCPU制限を削除
        const filteredArgs = runArgs.filter((arg) => !arg.startsWith('--cpus'));
        filteredArgs.push(`--cpus=${resourceLimits.cpus}`);
        config.runArgs = filteredArgs;
      }

      if (resourceLimits.memory) {
        // 既存のメモリ制限を削除
        const filteredArgs = (config.runArgs || []).filter((arg) => !arg.startsWith('--memory'));
        filteredArgs.push(`--memory=${resourceLimits.memory}`);
        config.runArgs = filteredArgs;
      }
    }

    // 環境変数の追加
    if (additionalEnv) {
      config.containerEnv = {
        ...config.containerEnv,
        ...additionalEnv,
      };
    }

    // 設定を保存
    await createDevContainerConfig(workspaceFolder, config);

    // devcontainer upコマンドを実行
    const args = [
      'devcontainer',
      'up',
      '--workspace-folder',
      workspaceFolder,
      '--log-level',
      logLevel,
    ];

    console.log(`DevContainer起動中: ${workspaceFolder}`);

    const command = new Deno.Command('npx', {
      args,
      stdout: 'piped',
      stderr: 'piped',
      env: {
        ...Deno.env.toObject(),
        ...additionalEnv,
      },
    });

    // タイムアウト付きで実行
    const timeoutPromise = new Promise<DevContainerResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`DevContainer起動がタイムアウト (${timeout}秒)`));
      }, timeout * 1000);
    });

    const executePromise = (async (): Promise<DevContainerResult> => {
      const result = await command.output();
      const duration = Date.now() - startTime;

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);

      // コンテナIDを抽出
      const containerIdMatch = stdout.match(/Container ID: ([a-f0-9]{12})/);
      const containerId = containerIdMatch ? containerIdMatch[1] : undefined;

      return {
        success: result.success,
        ...(containerId && { containerId }),
        stdout,
        stderr,
        exitCode: result.code,
        duration,
      };
    })();

    return await Promise.race([executePromise, timeoutPromise]);
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      stderr: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

/**
 * DevContainerを停止
 */
export async function stopDevContainer(workspaceFolder: string): Promise<DevContainerResult> {
  const startTime = Date.now();

  try {
    const command = new Deno.Command('npx', {
      args: [
        'devcontainer',
        'stop',
        '--workspace-folder',
        workspaceFolder,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });

    const result = await command.output();
    const duration = Date.now() - startTime;

    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    return {
      success: result.success,
      stdout,
      stderr,
      exitCode: result.code,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      stderr: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

/**
 * DevContainer内でコマンドを実行
 */
export async function execInDevContainer(
  workspaceFolder: string,
  command: string,
  args: string[] = [],
  options: {
    timeout?: number;
    workingDir?: string;
    env?: Record<string, string>;
  } = {},
): Promise<DevContainerResult> {
  const startTime = Date.now();
  const { timeout = 120, workingDir = '/workspace', env } = options;

  try {
    const execArgs = [
      'devcontainer',
      'exec',
      '--workspace-folder',
      workspaceFolder,
    ];

    if (workingDir) {
      execArgs.push('--cwd', workingDir);
    }

    execArgs.push(command, ...args);

    const denoCommand = new Deno.Command('npx', {
      args: execArgs,
      stdout: 'piped',
      stderr: 'piped',
      env: {
        ...Deno.env.toObject(),
        ...env,
      },
    });

    // タイムアウト付きで実行
    const timeoutPromise = new Promise<DevContainerResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`コマンド実行がタイムアウト (${timeout}秒): ${command}`));
      }, timeout * 1000);
    });

    const executePromise = (async (): Promise<DevContainerResult> => {
      const result = await denoCommand.output();
      const duration = Date.now() - startTime;

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);

      return {
        success: result.success,
        stdout,
        stderr,
        exitCode: result.code,
        duration,
      };
    })();

    return await Promise.race([executePromise, timeoutPromise]);
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      stderr: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

/**
 * DevContainerのHealth Checkを実行
 */
export async function checkDevContainerHealth(
  workspaceFolder: string,
): Promise<DevContainerHealthStatus> {
  const lastChecked = new Date();

  try {
    // コンテナの状態を確認
    const result = await execInDevContainer(workspaceFolder, 'docker', [
      'ps',
      '--format',
      'table {{.ID}}\\t{{.Status}}',
    ], {
      timeout: 30,
    });

    if (!result.success || !result.stdout) {
      return {
        running: false,
        lastChecked,
      };
    }

    // コンテナIDと状態を解析
    const lines = result.stdout.split('\n').slice(1); // ヘッダーをスキップ
    const containerLine = lines.find((line) => line.includes('Up'));

    if (!containerLine) {
      return {
        running: false,
        status: 'stopped',
        lastChecked,
      };
    }

    const [containerId, status] = containerLine.split('\t');

    // ヘルスチェックコマンドを実行
    const healthResult = await execInDevContainer(workspaceFolder, 'echo', ['healthy'], {
      timeout: 10,
    });

    const health: DevContainerHealthStatus['health'] = healthResult.success
      ? 'healthy'
      : 'unhealthy';

    return {
      running: true,
      ...(containerId?.trim() && { containerId: containerId.trim() }),
      ...(status?.trim() && { status: status.trim() }),
      health,
      lastChecked,
    };
  } catch (error) {
    console.warn('Health check failed:', error);

    return {
      running: false,
      lastChecked,
    };
  }
}

/**
 * DevContainer管理クラス
 */
export class DevContainerManager {
  private workspaceFolder: string;
  private healthCheckInterval: number | undefined;
  private lastHealthStatus?: DevContainerHealthStatus;

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * DevContainerを起動
   */
  async start(
    options: Omit<DevContainerStartOptions, 'workspaceFolder'> = {},
  ): Promise<DevContainerResult> {
    return await startDevContainer({
      ...options,
      workspaceFolder: this.workspaceFolder,
    });
  }

  /**
   * DevContainerを停止
   */
  async stop(): Promise<DevContainerResult> {
    this.stopHealthCheck();
    return await stopDevContainer(this.workspaceFolder);
  }

  /**
   * コマンドを実行
   */
  async exec(
    command: string,
    args: string[] = [],
    options: {
      timeout?: number;
      workingDir?: string;
      env?: Record<string, string>;
    } = {},
  ): Promise<DevContainerResult> {
    return await execInDevContainer(this.workspaceFolder, command, args, options);
  }

  /**
   * ヘルスチェックを開始
   */
  startHealthCheck(intervalSeconds: number = 60): void {
    this.stopHealthCheck();

    this.healthCheckInterval = setInterval(async () => {
      try {
        this.lastHealthStatus = await checkDevContainerHealth(this.workspaceFolder);
      } catch (error) {
        console.error('Periodic health check failed:', error);
      }
    }, intervalSeconds * 1000);
  }

  /**
   * ヘルスチェックを停止
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * 現在のヘルス状態を取得
   */
  async getHealthStatus(): Promise<DevContainerHealthStatus> {
    if (!this.lastHealthStatus) {
      this.lastHealthStatus = await checkDevContainerHealth(this.workspaceFolder);
    }
    return this.lastHealthStatus;
  }

  /**
   * 設定ファイルの存在確認
   */
  async hasConfig(): Promise<boolean> {
    return await checkDevContainerConfig(this.workspaceFolder);
  }

  /**
   * 設定ファイルを作成
   */
  async createConfig(config?: Partial<DevContainerConfig>): Promise<void> {
    await createDevContainerConfig(this.workspaceFolder, config);
  }

  /**
   * リソースクリーンアップ
   */
  dispose(): void {
    this.stopHealthCheck();
  }
}

/**
 * DevContainerマネージャーのインスタンス管理
 */
const devcontainerManagers = new Map<string, DevContainerManager>();

/**
 * DevContainerマネージャーインスタンスを取得
 */
export function getDevContainerManager(workspaceFolder: string): DevContainerManager {
  const normalizedPath = workspaceFolder.replace(/\/$/, ''); // 末尾のスラッシュを削除

  if (!devcontainerManagers.has(normalizedPath)) {
    devcontainerManagers.set(normalizedPath, new DevContainerManager(normalizedPath));
  }

  return devcontainerManagers.get(normalizedPath)!;
}

/**
 * 全DevContainerマネージャーを破棄
 */
export function disposeAllDevContainerManagers(): void {
  for (const manager of devcontainerManagers.values()) {
    manager.dispose();
  }
  devcontainerManagers.clear();
}
