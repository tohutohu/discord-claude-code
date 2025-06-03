// Git Worktree 管理機能
// リポジトリの worktree 作成、管理、削除を行い、
// タイムスタンプベースの命名、定期的なprune、ディスク容量監視を実装

import { dirname, join, resolve } from './deps.ts';
import { format } from './deps.ts';

/**
 * ディスク使用量情報
 */
export interface DiskUsage {
  /** 使用量（バイト） */
  used: number;
  /** 利用可能量（バイト） */
  available: number;
  /** 総容量（バイト） */
  total: number;
  /** 使用率（0-1） */
  usageRatio: number;
}

/**
 * Worktree情報
 */
export interface WorktreeInfo {
  /** Worktreeパス */
  path: string;
  /** ブランチ名 */
  branch: string;
  /** 作成日時 */
  createdAt: Date;
  /** コミットハッシュ */
  commit: string;
  /** Worktree名 */
  name: string;
}

/**
 * Worktree作成オプション
 */
export interface CreateWorktreeOptions {
  /** リポジトリパス */
  repositoryPath: string;
  /** ブランチ名 */
  branch: string;
  /** ワークツリーの親ディレクトリ */
  workspaceDir?: string;
  /** カスタムWorktree名プレフィックス */
  namePrefix?: string;
  /** ディスク容量チェックをスキップ */
  skipDiskCheck?: boolean;
}

/**
 * Pruneオプション
 */
export interface PruneOptions {
  /** 削除対象の最大期間（ミリ秒）デフォルト: 7日間 */
  maxAge?: number;
  /** ドライラン（実際には削除しない） */
  dryRun?: boolean;
  /** 削除対象パターン */
  pattern?: string;
}

/**
 * タイムスタンプ付きWorktree名を生成
 */
export function generateWorktreeName(prefix: string = 'claude'): string {
  const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

/**
 * Worktreeを作成
 */
export async function createWorktree(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const {
    repositoryPath,
    branch,
    workspaceDir = '/tmp',
    namePrefix = 'claude',
    skipDiskCheck = false,
  } = options;

  // リポジトリの存在確認
  const gitDir = join(repositoryPath, '.git');
  const gitDirStat = await Deno.stat(gitDir).catch(() => null);
  if (!gitDirStat) {
    throw new Error(`リポジトリが見つかりません: ${repositoryPath}`);
  }

  // タイムスタンプ付きWorktree名を生成
  const worktreeName = generateWorktreeName(namePrefix);
  const worktreePath = resolve(join(workspaceDir, worktreeName));

  // ディスク容量チェック
  if (!skipDiskCheck) {
    try {
      const diskUsage = await getDiskUsage(workspaceDir);
      if (diskUsage.usageRatio > 0.9) {
        throw new Error(
          `ディスク容量不足: 使用率 ${(diskUsage.usageRatio * 100).toFixed(1)}%`,
        );
      }
    } catch (error) {
      // ディスク容量チェックに失敗した場合は警告のみ
      console.warn('ディスク容量チェックに失敗しました:', error);
    }
  }

  try {
    // ブランチの存在確認
    const branchCheckCommand = new Deno.Command('git', {
      args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      cwd: repositoryPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const branchExists = (await branchCheckCommand.output()).success;

    // git worktree add コマンドを実行
    const args = ['worktree', 'add'];
    if (!branchExists) {
      args.push('-b', branch);
    }
    args.push(worktreePath);
    if (branchExists) {
      args.push(branch);
    }

    const command = new Deno.Command('git', {
      args,
      cwd: repositoryPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const result = await command.output();

    if (!result.success) {
      const errorMessage = new TextDecoder().decode(result.stderr);
      throw new Error(`Worktree作成に失敗: ${errorMessage}`);
    }

    // 作成されたWorktreeの情報を取得
    const commitHash = await getWorktreeCommit(worktreePath);

    const worktreeInfo: WorktreeInfo = {
      path: worktreePath,
      branch,
      createdAt: new Date(),
      commit: commitHash,
      name: worktreeName,
    };

    return worktreeInfo;
  } catch (error) {
    // 失敗した場合はWorktreeディレクトリを削除
    try {
      await Deno.remove(worktreePath, { recursive: true });
    } catch {
      // 削除に失敗しても無視
    }
    throw error;
  }
}

/**
 * Worktreeのコミットハッシュを取得
 */
async function getWorktreeCommit(worktreePath: string): Promise<string> {
  const command = new Deno.Command('git', {
    args: ['rev-parse', 'HEAD'],
    cwd: worktreePath,
    stdout: 'piped',
    stderr: 'piped',
  });

  const result = await command.output();

  if (!result.success) {
    return 'unknown';
  }

  return new TextDecoder().decode(result.stdout).trim();
}

/**
 * 全Worktreeを取得
 */
export async function listWorktrees(repositoryPath: string): Promise<WorktreeInfo[]> {
  const command = new Deno.Command('git', {
    args: ['worktree', 'list', '--porcelain'],
    cwd: repositoryPath,
    stdout: 'piped',
    stderr: 'piped',
  });

  const result = await command.output();

  if (!result.success) {
    const errorMessage = new TextDecoder().decode(result.stderr);
    throw new Error(`Worktree一覧取得に失敗: ${errorMessage}`);
  }

  const output = new TextDecoder().decode(result.stdout);
  const worktrees: WorktreeInfo[] = [];

  const entries = output.split('\n\n').filter((entry) => entry.trim());

  for (const entry of entries) {
    const lines = entry.split('\n');
    let path = '';
    let branch = '';
    let commit = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.substring(9);
      } else if (line.startsWith('branch ')) {
        branch = line.substring(7);
      } else if (line.startsWith('HEAD ')) {
        commit = line.substring(5);
      }
    }

    if (path) {
      // 作成日時を取得（ディレクトリの作成時刻）
      const stat = await Deno.stat(path).catch(() => null);
      const createdAt = stat?.birthtime || stat?.mtime || new Date();

      worktrees.push({
        path,
        branch: branch || 'detached',
        createdAt,
        commit,
        name: path.split('/').pop() || 'unknown',
      });
    }
  }

  return worktrees;
}

/**
 * Worktreeを削除
 */
export async function removeWorktree(
  repositoryPath: string,
  worktreePath: string,
  force: boolean = false,
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(worktreePath);

  const command = new Deno.Command('git', {
    args,
    cwd: repositoryPath,
    stdout: 'piped',
    stderr: 'piped',
  });

  const result = await command.output();

  if (!result.success) {
    const errorMessage = new TextDecoder().decode(result.stderr);
    throw new Error(`Worktree削除に失敗: ${errorMessage}`);
  }
}

/**
 * 古いWorktreeをクリーンアップ
 */
export async function pruneWorktrees(
  repositoryPath: string,
  options: PruneOptions = {},
): Promise<string[]> {
  const { maxAge = 7 * 24 * 60 * 60 * 1000, dryRun = false, pattern } = options;

  const worktrees = await listWorktrees(repositoryPath);
  const now = new Date();
  const removedPaths: string[] = [];

  for (const worktree of worktrees) {
    // メインのworktreeはスキップ
    if (worktree.path === repositoryPath) {
      continue;
    }

    // パターンマッチング
    if (pattern && !worktree.name.includes(pattern)) {
      continue;
    }

    // 古いWorktreeかチェック
    const age = now.getTime() - worktree.createdAt.getTime();
    if (age > maxAge) {
      if (!dryRun) {
        try {
          await removeWorktree(repositoryPath, worktree.path, true);
        } catch (error) {
          console.warn(`Worktree削除に失敗: ${worktree.path}`, error);
          continue;
        }
      }
      removedPaths.push(worktree.path);
    }
  }

  return removedPaths;
}

/**
 * ディスク使用量を取得
 */
export async function getDiskUsage(path: string): Promise<DiskUsage> {
  try {
    // dfコマンドでディスク使用量を取得
    const command = new Deno.Command('df', {
      args: ['-k', path],
      stdout: 'piped',
      stderr: 'piped',
    });

    const result = await command.output();

    if (!result.success) {
      throw new Error('df コマンドの実行に失敗');
    }

    const output = new TextDecoder().decode(result.stdout);
    const lines = output.split('\n');

    // 2行目にディスク情報が含まれる
    if (lines.length < 2) {
      throw new Error('df コマンドの出力形式が不正');
    }

    const line = lines[1];
    if (!line) {
      throw new Error('df コマンドの出力形式が不正');
    }

    const fields = line.split(/\s+/);
    if (fields.length < 4) {
      throw new Error('df コマンドの出力形式が不正');
    }

    const totalField = fields[1];
    const usedField = fields[2];
    const availableField = fields[3];

    if (!totalField || !usedField || !availableField) {
      throw new Error('df コマンドの出力形式が不正');
    }

    const total = parseInt(totalField) * 1024; // KB to bytes
    const used = parseInt(usedField) * 1024; // KB to bytes
    const available = parseInt(availableField) * 1024; // KB to bytes

    return {
      used,
      available,
      total,
      usageRatio: used / total,
    };
  } catch (error) {
    // dfコマンドが使用できない場合のフォールバック
    console.warn('df コマンドが使用できません:', error);
    return {
      used: 0,
      available: Number.MAX_SAFE_INTEGER,
      total: Number.MAX_SAFE_INTEGER,
      usageRatio: 0,
    };
  }
}

/**
 * Worktree管理クラス
 * 定期的なprune実行とディスク容量監視を行う
 */
export class WorktreeManager {
  private repositoryPath: string;
  private pruneInterval: number | undefined;
  private diskCheckInterval: number | undefined;
  private diskThreshold: number;

  constructor(
    repositoryPath: string,
    options: {
      /** 自動prune間隔（ミリ秒）デフォルト: 24時間 */
      pruneInterval?: number;
      /** ディスクチェック間隔（ミリ秒）デフォルト: 1時間 */
      diskCheckInterval?: number;
      /** ディスク使用率閾値（0-1）デフォルト: 0.8 */
      diskThreshold?: number;
    } = {},
  ) {
    this.repositoryPath = repositoryPath;
    this.diskThreshold = options.diskThreshold || 0.8;

    // 自動prune開始
    if (options.pruneInterval !== 0) {
      this.startAutoPrune(options.pruneInterval || 24 * 60 * 60 * 1000);
    }

    // ディスク監視開始
    if (options.diskCheckInterval !== 0) {
      this.startDiskMonitoring(options.diskCheckInterval || 60 * 60 * 1000);
    }
  }

  /**
   * 自動prune開始
   */
  private startAutoPrune(interval: number): void {
    this.pruneInterval = setInterval(async () => {
      try {
        const removed = await pruneWorktrees(this.repositoryPath);
        if (removed.length > 0) {
          console.log(`自動prune実行: ${removed.length}個のWorktreeを削除`);
        }
      } catch (error) {
        console.error('自動prune実行中にエラーが発生:', error);
      }
    }, interval);
  }

  /**
   * ディスク監視開始
   */
  private startDiskMonitoring(interval: number): void {
    this.diskCheckInterval = setInterval(async () => {
      try {
        const workspaceDir = dirname(this.repositoryPath);
        const diskUsage = await getDiskUsage(workspaceDir);

        if (diskUsage.usageRatio > this.diskThreshold) {
          console.warn(
            `ディスク使用率が高くなっています: ${(diskUsage.usageRatio * 100).toFixed(1)}%`,
          );

          // 緊急prune実行
          const removed = await pruneWorktrees(this.repositoryPath, {
            maxAge: 24 * 60 * 60 * 1000, // 1日以上古いもの
          });

          if (removed.length > 0) {
            console.log(`緊急prune実行: ${removed.length}個のWorktreeを削除`);
          }
        }
      } catch (error) {
        console.error('ディスク監視中にエラーが発生:', error);
      }
    }, interval);
  }

  /**
   * Worktree作成
   */
  async createWorktree(
    options: Omit<CreateWorktreeOptions, 'repositoryPath'>,
  ): Promise<WorktreeInfo> {
    return await createWorktree({
      ...options,
      repositoryPath: this.repositoryPath,
    });
  }

  /**
   * Worktree一覧取得
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    return await listWorktrees(this.repositoryPath);
  }

  /**
   * Worktree削除
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    return await removeWorktree(this.repositoryPath, worktreePath, force);
  }

  /**
   * Worktreeをprune
   */
  async pruneWorktrees(options?: PruneOptions): Promise<string[]> {
    return await pruneWorktrees(this.repositoryPath, options);
  }

  /**
   * 手動prune実行
   */
  async manualPrune(): Promise<number> {
    const removed = await this.pruneWorktrees();
    console.log(`手動prune実行: ${removed.length}個のWorktreeを削除`);
    return removed.length;
  }

  /**
   * ディスク使用量取得
   */
  async getDiskUsage(): Promise<DiskUsage> {
    const workspaceDir = dirname(this.repositoryPath);
    return await getDiskUsage(workspaceDir);
  }

  /**
   * リソースクリーンアップ
   */
  dispose(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }

    if (this.diskCheckInterval) {
      clearInterval(this.diskCheckInterval);
      this.diskCheckInterval = undefined;
    }
  }
}

/**
 * Worktreeマネージャーのシングルトンインスタンス
 */
const worktreeManagers = new Map<string, WorktreeManager>();

/**
 * Worktreeマネージャーインスタンスを取得
 */
export function getWorktreeManager(repositoryPath: string): WorktreeManager {
  const resolvedPath = resolve(repositoryPath);

  if (!worktreeManagers.has(resolvedPath)) {
    worktreeManagers.set(resolvedPath, new WorktreeManager(resolvedPath));
  }

  return worktreeManagers.get(resolvedPath)!;
}

/**
 * 全Worktreeマネージャーを破棄
 */
export function disposeAllWorktreeManagers(): void {
  for (const manager of worktreeManagers.values()) {
    manager.dispose();
  }
  worktreeManagers.clear();
}
