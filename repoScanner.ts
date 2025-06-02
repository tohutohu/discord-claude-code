/**
 * リポジトリ検出とクローン管理
 */

import { assert, assertEquals, async as denoAsync, fs, path } from './deps.ts';
import { logger } from './logger.ts';
import { Config } from './types/config.ts';

/** リポジトリメタデータ */
export interface RepoMeta {
  /** リポジトリ名（ディレクトリ名） */
  name: string;
  /** 絶対パス */
  path: string;
  /** リモートURL */
  url?: string;
  /** 現在のブランチ */
  branch?: string;
  /** 最終更新日時 */
  lastModified?: Date;
}

/** Git コマンド実行オプション */
interface GitCommandOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * rootDir以下のリポジトリを検出する
 * @param rootDir ルートディレクトリ
 * @param maxDepth 最大探索深度（デフォルト: 2）
 * @returns リポジトリメタデータの配列
 */
export async function scanRepos(
  rootDir: string,
  maxDepth = 2,
): Promise<RepoMeta[]> {
  const repos: RepoMeta[] = [];
  const expandedRootDir = expandPath(rootDir);

  // ルートディレクトリが存在しない場合は空配列を返す
  if (!await fs.exists(expandedRootDir)) {
    logger.warn(`リポジトリルートディレクトリが存在しません: ${expandedRootDir}`);
    return repos;
  }

  // 並列スキャンのためのタスクを収集
  const scanTasks: Promise<RepoMeta | null>[] = [];

  // ディレクトリを再帰的に探索
  async function scanDirectory(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isDirectory) continue;

        const fullPath = path.join(dir, entry.name);

        // .gitignore されたディレクトリをスキップ
        if (shouldIgnoreDirectory(entry.name)) {
          logger.trace(`スキップ: ${fullPath}`);
          continue;
        }

        // .git ディレクトリが存在するかチェック
        const gitPath = path.join(fullPath, '.git');
        if (await fs.exists(gitPath)) {
          // リポジトリとして検出
          scanTasks.push(validateRepository(fullPath, entry.name));
        } else if (depth < maxDepth) {
          // さらに深く探索
          await scanDirectory(fullPath, depth + 1);
        }
      }
    } catch (error) {
      logger.warn(`ディレクトリスキャンエラー: ${dir}`, { error: error.message });
    }
  }

  // スキャン開始
  const startTime = performance.now();
  await scanDirectory(expandedRootDir, 0);

  // 並列でリポジトリ情報を取得
  const results = await Promise.allSettled(scanTasks);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      repos.push(result.value);
    }
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  logger.info(`リポジトリスキャン完了: ${repos.length}個のリポジトリを検出 (${duration}秒)`);

  // 名前でソート
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * リポジトリを検証してメタデータを取得する
 * @param repoPath リポジトリパス
 * @param name リポジトリ名
 * @returns リポジトリメタデータまたはnull
 */
async function validateRepository(
  repoPath: string,
  name: string,
): Promise<RepoMeta | null> {
  try {
    // git rev-parse で正当性を確認
    const isValid = await executeGitCommand(
      ['rev-parse', '--show-toplevel'],
      { cwd: repoPath },
    );

    if (!isValid.success) {
      logger.warn(`無効なGitリポジトリ: ${repoPath}`);
      return null;
    }

    // リポジトリ情報を取得
    const [urlResult, branchResult] = await Promise.all([
      executeGitCommand(['remote', 'get-url', 'origin'], { cwd: repoPath }),
      executeGitCommand(['symbolic-ref', '--short', 'HEAD'], { cwd: repoPath }),
    ]);

    // 最終更新日時を取得
    const stat = await Deno.stat(repoPath);

    return {
      name,
      path: repoPath,
      url: urlResult.success ? urlResult.output.trim() : undefined,
      branch: branchResult.success ? branchResult.output.trim() : undefined,
      lastModified: stat.mtime ?? undefined,
    };
  } catch (error) {
    logger.warn(`リポジトリ検証エラー: ${repoPath}`, { error: error.message });
    return null;
  }
}

/**
 * リポジトリを確保する（存在しない場合はクローン）
 * @param config 設定
 * @param name リポジトリ名
 * @param url リポジトリURL（オプション）
 * @param options クローンオプション
 * @returns リポジトリパス
 */
export async function ensureRepo(
  config: Config,
  name: string,
  url?: string,
  options?: {
    branch?: string;
    shallow?: boolean;
    onProgress?: (message: string) => void;
  },
): Promise<string> {
  const rootDir = expandPath(config.rootDir);

  // 既存のリポジトリを検索
  const repos = await scanRepos(rootDir);
  const existing = repos.find((r) => r.name === name);

  if (existing) {
    logger.info(`既存のリポジトリを使用: ${name}`);

    // 最新化
    await fetchLatest(existing.path);

    return existing.path;
  }

  // URLを決定
  let cloneUrl = url;

  if (!cloneUrl && config.repositories?.[name]) {
    cloneUrl = config.repositories[name];
    logger.info(`設定ファイルからURLを取得: ${name} -> ${cloneUrl}`);
  }

  if (!cloneUrl) {
    throw new Error(`リポジトリ ${name} のURLが指定されていません`);
  }

  // クローン先のパスを決定
  const targetPath = path.join(rootDir, name);

  // ディレクトリが既に存在する場合はエラー
  if (await fs.exists(targetPath)) {
    throw new Error(`ディレクトリが既に存在します: ${targetPath}`);
  }

  // クローン実行
  logger.info(`リポジトリをクローン: ${name} from ${cloneUrl}`);

  const cloneArgs = ['clone'];

  // 浅いクローンオプション
  if (options?.shallow) {
    cloneArgs.push('--depth', '1');
  }

  // ブランチ指定
  if (options?.branch) {
    cloneArgs.push('--branch', options.branch);
  }

  // プログレス表示
  if (options?.onProgress) {
    cloneArgs.push('--progress');
  }

  cloneArgs.push(cloneUrl, targetPath);

  const result = await executeGitCommand(cloneArgs, {
    timeout: 300000, // 5分
  });

  if (!result.success) {
    throw new Error(`クローンに失敗しました: ${result.error}`);
  }

  logger.info(`クローン完了: ${name}`);
  options?.onProgress?.('クローンが完了しました');

  return targetPath;
}

/**
 * リポジトリを最新化する
 * @param repoPath リポジトリパス
 */
async function fetchLatest(repoPath: string): Promise<void> {
  logger.debug(`リポジトリを最新化: ${repoPath}`);

  const result = await executeGitCommand(['fetch', '--all'], {
    cwd: repoPath,
    timeout: 60000, // 1分
  });

  if (!result.success) {
    logger.warn(`fetch失敗: ${repoPath}`, { error: result.error });
  }
}

/**
 * Gitコマンドを実行する
 * @param args コマンド引数
 * @param options 実行オプション
 * @returns 実行結果
 */
async function executeGitCommand(
  args: string[],
  options: GitCommandOptions = {},
): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  try {
    const command = new Deno.Command('git', {
      args,
      cwd: options.cwd,
      stdout: 'piped',
      stderr: 'piped',
    });

    const process = command.spawn();

    // タイムアウト設定
    const timeout = options.timeout || 30000; // デフォルト30秒
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
    if (error instanceof denoAsync.DeadlineError) {
      return {
        success: false,
        output: '',
        error: 'コマンドがタイムアウトしました',
      };
    }

    return {
      success: false,
      output: '',
      error: error.message,
    };
  }
}

/**
 * 無視すべきディレクトリかチェックする
 * @param name ディレクトリ名
 * @returns 無視すべき場合true
 */
function shouldIgnoreDirectory(name: string): boolean {
  const ignorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    'tmp',
    'temp',
    '.cache',
    '.vscode',
    '.idea',
  ];

  return ignorePatterns.includes(name) || name.startsWith('.');
}

/**
 * パスを展開する（~をホームディレクトリに置換）
 * @param inputPath 入力パス
 * @returns 展開されたパス
 */
function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '~';
    return path.join(home, inputPath.slice(1));
  }
  return path.resolve(inputPath);
}

/**
 * SSH/HTTPS URLを自動判定する
 * @param url Git URL
 * @returns URLタイプ
 */
export function detectUrlType(url: string): 'ssh' | 'https' | 'unknown' {
  if (url.startsWith('git@') || url.includes(':') && !url.startsWith('http')) {
    return 'ssh';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'https';
  }
  return 'unknown';
}

// テストコード
Deno.test('リポジトリスキャンのパフォーマンス', async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // テスト用のリポジトリ構造を作成
    for (let i = 0; i < 10; i++) {
      const repoPath = path.join(tempDir, `repo-${i}`);
      await fs.ensureDir(path.join(repoPath, '.git'));
    }

    // スキャン実行
    const startTime = performance.now();
    const repos = await scanRepos(tempDir);
    const duration = performance.now() - startTime;

    assertEquals(repos.length, 10);
    assert(duration < 5000, `スキャンが遅すぎます: ${duration}ms`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('URL タイプの検出', () => {
  assertEquals(detectUrlType('git@github.com:user/repo.git'), 'ssh');
  assertEquals(detectUrlType('https://github.com/user/repo.git'), 'https');
  assertEquals(detectUrlType('http://github.com/user/repo.git'), 'https');
  assertEquals(detectUrlType('user@host:repo.git'), 'ssh');
  assertEquals(detectUrlType('file:///path/to/repo'), 'unknown');
});
