// リポジトリ検出・クローン機能
// rootDir 以下のリポジトリを並列スキャンし、git worktree 管理と連携

import { exists, join } from './deps.ts';

/**
 * リポジトリメタ情報
 */
export interface RepoMeta {
  /** リポジトリ名 */
  name: string;
  /** 絶対パス */
  path: string;
  /** リモートURL */
  url: string;
  /** 現在のブランチ */
  branch: string;
  /** 最終更新日時 */
  lastModified: Date;
  /** 最終コミットハッシュ */
  lastCommit?: string;
}

/**
 * スキャン設定
 */
export interface ScanOptions {
  /** 探索する最大深度（デフォルト: 2） */
  maxDepth?: number;
  /** 並列実行数（デフォルト: 10） */
  concurrency?: number;
  /** .gitignore されたディレクトリをスキップするか（デフォルト: true） */
  skipGitIgnored?: boolean;
  /** スキップするディレクトリ名のパターン */
  skipPatterns?: string[];
  /** タイムアウト（ミリ秒、デフォルト: 30000） */
  timeout?: number;
}

/**
 * クローン設定
 */
export interface CloneOptions {
  /** 浅いクローンを行うか（デフォルト: true） */
  shallow?: boolean;
  /** クローン深度（shallow=trueの場合） */
  depth?: number;
  /** ブランチ指定 */
  branch?: string;
  /** SSH/HTTPS自動判定（デフォルト: true） */
  autoDetectProtocol?: boolean;
  /** プログレス表示コールバック */
  onProgress?: (message: string) => void;
}

/**
 * スキャン結果
 */
export interface ScanResult {
  /** 検出されたリポジトリ一覧 */
  repositories: RepoMeta[];
  /** スキャンにかかった時間（ミリ秒） */
  scanTime: number;
  /** スキップされたディレクトリ数 */
  skippedDirs: number;
  /** エラーが発生したディレクトリ数 */
  errorDirs: number;
  /** エラー詳細 */
  errors: Array<{ path: string; error: string }>;
}

/**
 * リポジトリスキャナークラス
 */
export class RepoScanner {
  private defaultOptions: Required<ScanOptions> = {
    maxDepth: 2,
    concurrency: 10,
    skipGitIgnored: true,
    skipPatterns: ['node_modules', '.git', 'target', 'dist', 'build', '.next'],
    timeout: 30000,
  };

  /**
   * 指定ディレクトリ以下のリポジトリを並列スキャン
   * @param rootDir スキャン対象のルートディレクトリ
   * @param options スキャンオプション
   * @returns スキャン結果
   */
  async scanRepos(rootDir: string, options?: ScanOptions): Promise<ScanResult> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };

    // ルートディレクトリの存在確認
    if (!await exists(rootDir)) {
      throw new Error(`ルートディレクトリが存在しません: ${rootDir}`);
    }

    console.log(`リポジトリスキャンを開始: ${rootDir} (深度: ${opts.maxDepth})`);

    const repositories: RepoMeta[] = [];
    const errors: Array<{ path: string; error: string }> = [];
    let skippedDirs = 0;
    let errorDirs = 0;

    try {
      // 並列スキャンを実行
      const scanResults = await this.parallelScan(rootDir, opts);

      // 結果を集計
      for (const result of scanResults) {
        if (result.type === 'repository') {
          repositories.push(result.repo);
        } else if (result.type === 'error') {
          errors.push({ path: result.path, error: result.error });
          errorDirs++;
        } else if (result.type === 'skipped') {
          skippedDirs++;
        }
      }

      // リポジトリを最終更新日時でソート（新しい順）
      repositories.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      const scanTime = Date.now() - startTime;
      console.log(`スキャン完了: ${repositories.length}個のリポジトリを検出 (${scanTime}ms)`);

      return {
        repositories,
        scanTime,
        skippedDirs,
        errorDirs,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`スキャンエラー: ${errorMessage}`);
    }
  }

  /**
   * 並列スキャンを実行
   * @param rootDir ルートディレクトリ
   * @param options スキャンオプション
   * @returns スキャン結果の配列
   */
  private async parallelScan(
    rootDir: string,
    options: Required<ScanOptions>,
  ): Promise<ScanTaskResult[]> {
    const tasks = await this.collectScanTasks(rootDir, options);

    // セマフォを使用して並列実行数を制御
    const semaphore = new Semaphore(options.concurrency);
    const results: ScanTaskResult[] = [];

    // 全タスクを並列実行
    const promises = tasks.map((task) => {
      return semaphore.acquire(async () => {
        try {
          return await this.executeScanTask(task, options);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'error' as const,
            path: task.path,
            error: errorMessage,
          };
        }
      });
    });

    const taskResults = await Promise.all(promises);
    results.push(...taskResults);

    return results;
  }

  /**
   * スキャンタスクを収集
   * @param rootDir ルートディレクトリ
   * @param options スキャンオプション
   * @returns スキャンタスクの配列
   */
  private async collectScanTasks(
    rootDir: string,
    options: Required<ScanOptions>,
  ): Promise<ScanTask[]> {
    const tasks: ScanTask[] = [];

    await this.collectTasksRecursive(rootDir, 0, options, tasks);

    return tasks;
  }

  /**
   * 再帰的にスキャンタスクを収集
   * @param dir 現在のディレクトリ
   * @param depth 現在の深度
   * @param options スキャンオプション
   * @param tasks タスク配列（出力）
   */
  private async collectTasksRecursive(
    dir: string,
    depth: number,
    options: Required<ScanOptions>,
    tasks: ScanTask[],
  ): Promise<void> {
    if (depth > options.maxDepth) {
      return;
    }

    try {
      const entries = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) {
          entries.push(entry);
        }
      }

      for (const entry of entries) {
        const entryPath = join(dir, entry.name);

        // スキップパターンの確認
        if (this.shouldSkipDirectory(entry.name, options.skipPatterns)) {
          continue;
        }

        // .gitディレクトリが存在する場合はリポジトリとして扱う
        const gitDir = join(entryPath, '.git');
        if (await exists(gitDir)) {
          tasks.push({
            type: 'repository',
            path: entryPath,
            name: entry.name,
          });
        } else {
          // さらに深く探索
          await this.collectTasksRecursive(entryPath, depth + 1, options, tasks);
        }
      }
    } catch (error) {
      // ディレクトリ読み取りエラーは無視してログ出力
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`ディレクトリ読み取りエラー: ${dir} - ${errorMessage}`);
    }
  }

  /**
   * スキャンタスクを実行
   * @param task スキャンタスク
   * @param options スキャンオプション
   * @returns スキャン結果
   */
  private async executeScanTask(
    task: ScanTask,
    _options: Required<ScanOptions>,
  ): Promise<ScanTaskResult> {
    if (task.type === 'repository') {
      try {
        const repo = await this.analyzeRepository(task.path, task.name);
        return { type: 'repository', repo };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          type: 'error',
          path: task.path,
          error: `リポジトリ解析エラー: ${errorMessage}`,
        };
      }
    }

    return { type: 'skipped', path: task.path };
  }

  /**
   * リポジトリを解析してメタ情報を取得
   * @param repoPath リポジトリのパス
   * @param name リポジトリ名
   * @returns リポジトリメタ情報
   */
  private async analyzeRepository(repoPath: string, name: string): Promise<RepoMeta> {
    // git rev-parse --show-toplevel で正当性確認
    const topLevelCmd = new Deno.Command('git', {
      args: ['rev-parse', '--show-toplevel'],
      cwd: repoPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const topLevelResult = await topLevelCmd.output();
    if (!topLevelResult.success) {
      throw new Error('有効なGitリポジトリではありません');
    }

    // リモートURL取得
    const urlCmd = new Deno.Command('git', {
      args: ['remote', 'get-url', 'origin'],
      cwd: repoPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const urlResult = await urlCmd.output();
    const url = urlResult.success ? new TextDecoder().decode(urlResult.stdout).trim() : '';

    // 現在のブランチ取得
    const branchCmd = new Deno.Command('git', {
      args: ['symbolic-ref', '--short', 'HEAD'],
      cwd: repoPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const branchResult = await branchCmd.output();
    const branch = branchResult.success
      ? new TextDecoder().decode(branchResult.stdout).trim()
      : 'unknown';

    // 最終コミット情報取得
    const commitCmd = new Deno.Command('git', {
      args: ['log', '-1', '--format=%H|%at'],
      cwd: repoPath,
      stdout: 'piped',
      stderr: 'piped',
    });

    const commitResult = await commitCmd.output();
    let lastCommit = '';
    let lastModified = new Date();

    if (commitResult.success) {
      const output = new TextDecoder().decode(commitResult.stdout).trim();
      const [hash, timestamp] = output.split('|');
      if (hash) {
        lastCommit = hash;
      }
      if (timestamp) {
        lastModified = new Date(parseInt(timestamp) * 1000);
      }
    }

    return {
      name,
      path: repoPath,
      url,
      branch,
      lastModified,
      lastCommit,
    };
  }

  /**
   * ディレクトリをスキップすべきかどうかを判定
   * @param dirName ディレクトリ名
   * @param skipPatterns スキップパターン
   * @returns スキップすべき場合はtrue
   */
  private shouldSkipDirectory(dirName: string, skipPatterns: string[]): boolean {
    return skipPatterns.some((pattern) => {
      // 単純な文字列マッチングまたは正規表現マッチング
      if (pattern.includes('*') || pattern.includes('.')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(dirName);
      }
      return dirName === pattern;
    });
  }

  /**
   * リポジトリが存在しない場合にクローンを実行
   * @param name リポジトリ名
   * @param url リポジトリURL（オプション）
   * @param rootDir クローン先のルートディレクトリ
   * @param options クローンオプション
   * @returns クローンされたリポジトリのパス
   */
  async ensureRepo(
    name: string,
    url?: string,
    rootDir?: string,
    options?: CloneOptions,
  ): Promise<string> {
    const opts = {
      shallow: true,
      depth: 1,
      autoDetectProtocol: true,
      ...options,
    };

    // ルートディレクトリのデフォルト値
    const targetRootDir = rootDir || './repos';
    const repoPath = join(targetRootDir, name);

    // 既存リポジトリの確認
    if (await exists(repoPath)) {
      const gitDir = join(repoPath, '.git');
      if (await exists(gitDir)) {
        console.log(`リポジトリは既に存在します: ${repoPath}`);

        // 既存リポジトリの更新
        await this.updateRepository(repoPath, opts);
        return repoPath;
      }
    }

    // URLの決定
    let cloneUrl = url;
    if (!cloneUrl) {
      throw new Error(`リポジトリ ${name} のURLが指定されていません`);
    }

    // プロトコル自動判定
    if (opts.autoDetectProtocol) {
      cloneUrl = this.normalizeRepositoryUrl(cloneUrl);
    }

    // クローン実行
    await this.cloneRepository(cloneUrl, repoPath, opts);

    return repoPath;
  }

  /**
   * リポジトリをクローン
   * @param url リポジトリURL
   * @param targetPath クローン先パス
   * @param options クローンオプション
   */
  private async cloneRepository(
    url: string,
    targetPath: string,
    options: Partial<CloneOptions> & { shallow: boolean; depth: number },
  ): Promise<void> {
    const args = ['clone'];

    // 浅いクローンオプション
    if (options.shallow) {
      args.push('--depth', options.depth.toString());
    }

    // ブランチ指定
    if (options.branch) {
      args.push('--branch', options.branch);
    }

    args.push(url, targetPath);

    // プログレス表示
    if (options.onProgress) {
      options.onProgress(`リポジトリをクローン中: ${url}`);
    }

    console.log(`git clone を実行: ${args.join(' ')}`);

    const cloneCmd = new Deno.Command('git', {
      args,
      stdout: 'piped',
      stderr: 'piped',
    });

    const result = await cloneCmd.output();

    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`クローンに失敗しました: ${stderr}`);
    }

    const stdout = new TextDecoder().decode(result.stdout);
    if (options.onProgress && stdout) {
      options.onProgress(`クローン完了: ${targetPath}`);
    }

    console.log(`クローン成功: ${targetPath}`);
  }

  /**
   * 既存リポジトリを更新（fetch）
   * @param repoPath リポジトリパス
   * @param options クローンオプション
   */
  private async updateRepository(
    repoPath: string,
    options: Partial<CloneOptions>,
  ): Promise<void> {
    try {
      if (options.onProgress) {
        options.onProgress(`リポジトリを更新中: ${repoPath}`);
      }

      const fetchCmd = new Deno.Command('git', {
        args: ['fetch', '--prune'],
        cwd: repoPath,
        stdout: 'piped',
        stderr: 'piped',
      });

      const result = await fetchCmd.output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        console.warn(`fetch に失敗しました: ${stderr}`);
        return;
      }

      if (options.onProgress) {
        options.onProgress(`更新完了: ${repoPath}`);
      }

      console.log(`リポジトリ更新完了: ${repoPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`リポジトリ更新エラー: ${errorMessage}`);
    }
  }

  /**
   * リポジトリURLを正規化（SSH/HTTPS自動判定）
   * @param url 元のURL
   * @returns 正規化されたURL
   */
  private normalizeRepositoryUrl(url: string): string {
    // 既にHTTP(S)の場合はそのまま
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // SSH形式 (git@github.com:user/repo.git) をHTTPSに変換
    if (url.startsWith('git@')) {
      const sshPattern = /^git@([^:]+):(.+)$/;
      const match = url.match(sshPattern);
      if (match) {
        const [, host, path] = match;
        return `https://${host}/${path}`;
      }
    }

    // GitHub短縮形式 (user/repo) をHTTPSに変換
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url)) {
      return `https://github.com/${url}.git`;
    }

    // その他の場合はそのまま返す
    return url;
  }

  /**
   * プログレス表示付きの一括クローン
   * @param repositories クローン対象のリポジトリ一覧
   * @param rootDir クローン先ルートディレクトリ
   * @param options クローンオプション
   * @returns クローン結果
   */
  async bulkClone(
    repositories: Array<{ name: string; url: string }>,
    rootDir: string,
    options?: CloneOptions,
  ): Promise<BulkCloneResult> {
    const startTime = Date.now();
    const results: Array<{ name: string; path?: string; error?: string }> = [];

    const opts = {
      shallow: true,
      depth: 1,
      autoDetectProtocol: true,
      ...options,
    };

    console.log(`一括クローン開始: ${repositories.length}個のリポジトリ`);

    // セマフォで並列実行数を制御
    const semaphore = new Semaphore(5); // 最大5並列

    const promises = repositories.map((repo) => {
      return semaphore.acquire(async () => {
        try {
          const repoPath = await this.ensureRepo(repo.name, repo.url, rootDir, {
            ...opts,
            onProgress: (message) => {
              if (opts.onProgress) {
                opts.onProgress(`[${repo.name}] ${message}`);
              }
            },
          });

          return { name: repo.name, path: repoPath };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[${repo.name}] クローンエラー: ${errorMessage}`);
          return { name: repo.name, error: errorMessage };
        }
      });
    });

    const cloneResults = await Promise.all(promises);
    results.push(...cloneResults);

    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => r.path).length;
    const errorCount = results.filter((r) => r.error).length;

    console.log(`一括クローン完了: 成功 ${successCount}個, 失敗 ${errorCount}個 (${duration}ms)`);

    return {
      results,
      duration,
      successCount,
      errorCount,
    };
  }
}

/**
 * セマフォクラス（並列実行数制御）
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        if (this.permits > 0) {
          this.permits--;
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              this.permits++;
              if (this.waiting.length > 0) {
                const next = this.waiting.shift()!;
                next();
              }
            });
        } else {
          this.waiting.push(tryAcquire);
        }
      };

      tryAcquire();
    });
  }
}

/**
 * スキャンタスク
 */
interface ScanTask {
  type: 'repository';
  path: string;
  name: string;
}

/**
 * スキャンタスク結果
 */
type ScanTaskResult =
  | { type: 'repository'; repo: RepoMeta }
  | { type: 'error'; path: string; error: string }
  | { type: 'skipped'; path: string };

/**
 * 一括クローン結果
 */
export interface BulkCloneResult {
  /** クローン結果の詳細 */
  results: Array<{ name: string; path?: string; error?: string }>;
  /** 実行時間（ミリ秒） */
  duration: number;
  /** 成功数 */
  successCount: number;
  /** 失敗数 */
  errorCount: number;
}

/**
 * デフォルトのリポジトリスキャナーインスタンス
 */
export const defaultRepoScanner = new RepoScanner();
