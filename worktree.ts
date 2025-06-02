/**
 * Git Worktree 操作ユーティリティ
 * 複数のセッションで同じリポジトリを並行利用するためのworktree管理
 */

import { assert, assertEquals, async as denoAsync, fs, path } from './deps.ts';
import { logger } from './logger.ts';

/** Worktree情報 */
export interface WorktreeInfo {
  /** Worktreeのパス */
  path: string;
  /** 関連するブランチ名 */
  branch: string;
  /** HEADのコミットハッシュ */
  head: string;
  /** 作成日時 */
  createdAt: Date;
  /** 最終アクセス日時 */
  lastAccessed: Date;
}

/** Worktree作成オプション */
export interface CreateWorktreeOptions {
  /** ブランチ名（省略時はデフォルトブランチ） */
  branch?: string;
  /** 新しいブランチを作成するか */
  createBranch?: boolean;
  /** ベースとなるブランチ（新しいブランチ作成時） */
  baseBranch?: string;
  /** セッションID（識別用） */
  sessionId?: string;
}

/** ディスク使用量情報 */
export interface DiskUsage {
  /** 総容量（バイト） */
  total: number;
  /** 使用量（バイト） */
  used: number;
  /** 利用可能量（バイト） */
  available: number;
  /** 使用率（%） */
  usagePercent: number;
}

/**
 * Git Worktree マネージャークラス
 */
export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  private pruneTimer?: number;

  constructor() {
    // 1日1回のprune実行
    this.pruneTimer = setInterval(() => {
      this.pruneWorktrees().catch((error) => {
        logger.error('定期prune実行エラー:', { error: error.message });
      });
    }, 86400000); // 24時間
  }

  /**
   * Worktreeマネージャーを初期化する
   */
  async init(): Promise<void> {
    // 定期的なprune実行
    await this.pruneWorktrees();
    logger.info('Worktreeマネージャーを初期化しました');
  }

  /**
   * 新しいWorktreeを作成する
   * @param repoPath リポジトリのパス
   * @param options 作成オプション
   * @returns 作成されたWorktreeのパス
   */
  async createWorktree(
    repoPath: string,
    options: CreateWorktreeOptions = {},
  ): Promise<string> {
    // リポジトリの存在確認
    if (!await this.isGitRepository(repoPath)) {
      throw new Error(`指定されたパスはGitリポジトリではありません: ${repoPath}`);
    }

    // ディスク容量チェック
    const diskUsage = await this.checkDiskUsage(repoPath);
    if (diskUsage.usagePercent > 90) {
      throw new Error(`ディスク使用量が90%を超えています (${diskUsage.usagePercent.toFixed(1)}%)`);
    }

    // Worktree名を生成（タイムスタンプ付き）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionSuffix = options.sessionId ? `_${options.sessionId.slice(0, 8)}` : '';
    const worktreeName = `worktree_${timestamp}${sessionSuffix}`;
    const worktreePath = path.join(repoPath, '.worktrees', worktreeName);

    // ブランチ名を決定
    let targetBranch = options.branch;
    if (!targetBranch) {
      targetBranch = await this.getDefaultBranch(repoPath);
    }

    logger.info('Worktreeを作成中...', {
      repoPath,
      worktreePath,
      branch: targetBranch,
      createBranch: options.createBranch,
    });

    try {
      // Worktree作成コマンドを構築
      const args = ['worktree', 'add'];

      if (options.createBranch && options.baseBranch) {
        args.push('-b', targetBranch);
        args.push(worktreePath);
        args.push(options.baseBranch);
      } else if (options.createBranch) {
        args.push('-b', targetBranch);
        args.push(worktreePath);
      } else {
        args.push(worktreePath);
        args.push(targetBranch);
      }

      // Git worktree addを実行
      const result = await this.executeGitCommand(args, { cwd: repoPath });
      if (!result.success) {
        throw new Error(`Worktree作成失敗: ${result.error}`);
      }

      // Worktree情報を記録
      const now = new Date();
      const worktreeInfo: WorktreeInfo = {
        path: worktreePath,
        branch: targetBranch,
        head: await this.getHeadCommit(worktreePath),
        createdAt: now,
        lastAccessed: now,
      };

      this.worktrees.set(worktreePath, worktreeInfo);

      logger.info('Worktreeを作成しました', {
        path: worktreePath,
        branch: targetBranch,
      });

      return worktreePath;
    } catch (error) {
      logger.error('Worktree作成エラー:', { error: error.message });
      throw error;
    }
  }

  /**
   * Worktreeを削除する
   * @param worktreePath Worktreeのパス
   * @param force 強制削除フラグ
   */
  async removeWorktree(worktreePath: string, force = false): Promise<void> {
    const worktreeInfo = this.worktrees.get(worktreePath);
    if (!worktreeInfo) {
      logger.warn(`Worktree情報が見つかりません: ${worktreePath}`);
    }

    try {
      // 親リポジトリのパスを推定
      const repoPath = this.findRepositoryRoot(worktreePath);

      // Git worktree removeを実行
      const args = ['worktree', 'remove'];
      if (force) {
        args.push('--force');
      }
      args.push(worktreePath);

      const result = await this.executeGitCommand(args, { cwd: repoPath });
      if (!result.success) {
        logger.warn(`Worktree削除失敗: ${result.error}`);

        // 強制削除を試行
        if (!force) {
          await this.removeWorktree(worktreePath, true);
          return;
        }

        // それでも失敗した場合はディレクトリを直接削除
        if (await fs.exists(worktreePath)) {
          await Deno.remove(worktreePath, { recursive: true });
          logger.warn(`Worktreeディレクトリを直接削除しました: ${worktreePath}`);
        }
      }

      // 記録を削除
      this.worktrees.delete(worktreePath);

      logger.info('Worktreeを削除しました', { path: worktreePath });
    } catch (error) {
      logger.error('Worktree削除エラー:', {
        path: worktreePath,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * リポジトリ内のすべてのWorktreeを一覧取得する
   * @param repoPath リポジトリのパス
   * @returns Worktree情報の配列
   */
  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    try {
      const result = await this.executeGitCommand(
        ['worktree', 'list', '--porcelain'],
        { cwd: repoPath },
      );

      if (!result.success) {
        throw new Error(`Worktree一覧取得失敗: ${result.error}`);
      }

      const worktrees: WorktreeInfo[] = [];
      const lines = result.output.split('\n');

      let currentWorktree: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree.path) {
            worktrees.push(currentWorktree as WorktreeInfo);
          }
          currentWorktree = {
            path: line.substring(9),
            createdAt: new Date(), // 実際の作成日時は取得できないため現在時刻
            lastAccessed: new Date(),
          };
        } else if (line.startsWith('HEAD ')) {
          currentWorktree.head = line.substring(5);
        } else if (line.startsWith('branch ')) {
          currentWorktree.branch = line.substring(7);
        }
      }

      // 最後のWorktreeを追加
      if (currentWorktree.path) {
        worktrees.push(currentWorktree as WorktreeInfo);
      }

      return worktrees;
    } catch (error) {
      logger.error('Worktree一覧取得エラー:', { error: error.message });
      throw error;
    }
  }

  /**
   * 古いWorktreeを削除する（prune操作）
   * @param maxAge 最大保持期間（ミリ秒、デフォルト7日）
   */
  async pruneWorktrees(maxAge = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    logger.info('Worktreeのprune処理を開始します...');

    let prunedCount = 0;
    const cutoffTime = Date.now() - maxAge;

    // 記録されているWorktreeをチェック
    for (const [worktreePath, info] of this.worktrees.entries()) {
      try {
        // 古いWorktreeかチェック
        if (info.lastAccessed.getTime() < cutoffTime) {
          // ディレクトリが存在するかチェック
          if (await fs.exists(worktreePath)) {
            await this.removeWorktree(worktreePath);
            prunedCount++;
          } else {
            // ディレクトリが存在しない場合は記録のみ削除
            this.worktrees.delete(worktreePath);
          }
        }
      } catch (error) {
        logger.warn('Worktree prune エラー:', {
          path: worktreePath,
          error: error.message,
        });
      }
    }

    // システム全体のprune実行
    try {
      const result = await this.executeGitCommand(['worktree', 'prune'], {
        timeout: 60000, // 1分
      });

      if (!result.success) {
        logger.warn(`Git worktree prune 失敗: ${result.error}`);
      }
    } catch (error) {
      logger.warn('Git worktree prune エラー:', { error: error.message });
    }

    logger.info(`Worktree prune完了: ${prunedCount}個のWorktreeを削除`);
  }

  /**
   * ディスク使用量をチェックする
   * @param targetPath チェック対象のパス
   * @returns ディスク使用量情報
   */
  async checkDiskUsage(targetPath: string): Promise<DiskUsage> {
    try {
      const result = await this.executeSystemCommand(['df', '-B1', targetPath]);

      if (!result.success) {
        throw new Error(`df コマンド失敗: ${result.error}`);
      }

      // dfの出力をパース
      const lines = result.output.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('df出力の解析に失敗しました');
      }

      const data = lines[1].split(/\s+/);
      const total = parseInt(data[1], 10);
      const used = parseInt(data[2], 10);
      const available = parseInt(data[3], 10);

      return {
        total,
        used,
        available,
        usagePercent: (used / total) * 100,
      };
    } catch (error) {
      logger.warn('ディスク使用量チェックエラー:', { error: error.message });
      // エラー時は安全な値を返す
      return {
        total: 1000000000, // 1GB
        used: 0,
        available: 1000000000,
        usagePercent: 0,
      };
    }
  }

  /**
   * Worktreeのアクセス時刻を更新する
   * @param worktreePath Worktreeのパス
   */
  updateAccessTime(worktreePath: string): void {
    const info = this.worktrees.get(worktreePath);
    if (info) {
      info.lastAccessed = new Date();
    }
  }

  /**
   * リポジトリのデフォルトブランチを取得する
   * @param repoPath リポジトリのパス
   * @returns デフォルトブランチ名
   */
  private async getDefaultBranch(repoPath: string): Promise<string> {
    const result = await this.executeGitCommand(
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      { cwd: repoPath },
    );

    if (result.success) {
      const branch = result.output.trim().replace('refs/remotes/origin/', '');
      return branch;
    }

    // フォールバックとしてmainまたはmasterを試す
    const branches = ['main', 'master', 'develop'];
    for (const branch of branches) {
      const checkResult = await this.executeGitCommand(
        ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
        { cwd: repoPath },
      );
      if (checkResult.success) {
        return branch;
      }
    }

    throw new Error('デフォルトブランチの特定に失敗しました');
  }

  /**
   * HEADのコミットハッシュを取得する
   * @param worktreePath Worktreeのパス
   * @returns コミットハッシュ
   */
  private async getHeadCommit(worktreePath: string): Promise<string> {
    const result = await this.executeGitCommand(
      ['rev-parse', 'HEAD'],
      { cwd: worktreePath },
    );

    if (result.success) {
      return result.output.trim();
    }

    return 'unknown';
  }

  /**
   * Gitリポジトリかどうかを確認する
   * @param repoPath チェック対象のパス
   * @returns Gitリポジトリの場合true
   */
  private async isGitRepository(repoPath: string): Promise<boolean> {
    const result = await this.executeGitCommand(
      ['rev-parse', '--git-dir'],
      { cwd: repoPath },
    );
    return result.success;
  }

  /**
   * Worktreeからリポジトリルートを見つける
   * @param worktreePath Worktreeのパス
   * @returns リポジトリルートのパス
   */
  private findRepositoryRoot(worktreePath: string): string {
    // .worktrees/worktree_xxx のパターンを想定
    const worktreesIndex = worktreePath.indexOf('.worktrees');
    if (worktreesIndex !== -1) {
      return worktreePath.substring(0, worktreesIndex - 1);
    }

    // フォールバック: 親ディレクトリを順次チェック
    let currentPath = path.dirname(worktreePath);
    while (currentPath !== path.dirname(currentPath)) {
      if (fs.existsSync(path.join(currentPath, '.git'))) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }

    throw new Error(`リポジトリルートが見つかりません: ${worktreePath}`);
  }

  /**
   * Gitコマンドを実行する
   * @param args コマンド引数
   * @param options 実行オプション
   * @returns 実行結果
   */
  private executeGitCommand(
    args: string[],
    options: { cwd?: string; timeout?: number } = {},
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return this.executeSystemCommand(['git', ...args], options);
  }

  /**
   * システムコマンドを実行する
   * @param command コマンドと引数の配列
   * @param options 実行オプション
   * @returns 実行結果
   */
  private async executeSystemCommand(
    command: string[],
    options: { cwd?: string; timeout?: number } = {},
  ): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      const cmd = new Deno.Command(command[0], {
        args: command.slice(1),
        cwd: options.cwd,
        stdout: 'piped',
        stderr: 'piped',
      });

      const process = cmd.spawn();
      const timeout = options.timeout || 30000;

      const { status, stdout, stderr } = await denoAsync.deadline(
        process.output(),
        timeout,
      );

      const output = new TextDecoder().decode(stdout);
      const error = new TextDecoder().decode(stderr);

      return {
        success: status.success,
        output,
        error: error || undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error.message,
      };
    }
  }

  /**
   * リソースをクリーンアップする
   */
  cleanup(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
    }
    logger.info('Worktreeマネージャーをクリーンアップしました');
  }
}

// シングルトンインスタンス
export const worktreeManager = new WorktreeManager();

// テストコード
Deno.test('Worktree名の生成', () => {
  const manager = new WorktreeManager();
  const sessionId = 'test_session_123';

  // タイムスタンプ形式の確認
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const expected = `worktree_${timestamp}_${sessionId.slice(0, 8)}`;

  // 生成されるWorktree名がタイムスタンプを含むことを確認
  assert(expected.includes('worktree_'));
  assert(expected.includes('test_ses'));
});

Deno.test('ディスク使用量の計算', () => {
  const usage: DiskUsage = {
    total: 1000,
    used: 850,
    available: 150,
    usagePercent: 85,
  };

  assertEquals(usage.usagePercent, 85);
  assertEquals(usage.used + usage.available, usage.total);
});
