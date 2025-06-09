import { join } from "std/path/mod.ts";
import { WorkspaceManager } from "./workspace.ts";

/**
 * Gitリポジトリの情報を表すインターフェース
 *
 * @property {string} org - リポジトリを所有する組織またはユーザー名
 * @property {string} repo - リポジトリ名
 * @property {string} fullName - 「org/repo」形式の完全なリポジトリ名
 * @property {string} localPath - ローカルファイルシステム上の相対パス（org/repo形式）
 */
export interface GitRepository {
  org: string;
  repo: string;
  fullName: string;
  localPath: string;
}

/**
 * リポジトリ指定文字列をパースしてGitRepositoryオブジェクトを生成する
 *
 * @param {string} repoSpec - 「<org>/<repo>」形式のリポジトリ指定文字列
 * @returns {GitRepository} パースされたリポジトリ情報
 * @throws {Error} リポジトリ名が正しい形式でない場合
 *
 * @example
 * const repo = parseRepository("octocat/Hello-World");
 * // { org: "octocat", repo: "Hello-World", fullName: "octocat/Hello-World", localPath: "octocat/Hello-World" }
 */
export function parseRepository(repoSpec: string): GitRepository {
  const match = repoSpec.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) {
    throw new Error("リポジトリ名は <org>/<repo> 形式で指定してください");
  }

  const [, org, repo] = match;
  return {
    org,
    repo,
    fullName: `${org}/${repo}`,
    localPath: join(org, repo),
  };
}

/**
 * 指定されたリポジトリがローカルに存在することを保証する
 *
 * リポジトリが既に存在する場合は最新の状態に更新し、
 * 存在しない場合はghコマンドを使用して新規にクローンする。
 *
 * @param {GitRepository} repository - 対象のリポジトリ情報
 * @param {WorkspaceManager} workspaceManager - 作業ディレクトリを管理するWorkspaceManagerインスタンス
 * @returns {Promise<{path: string; wasUpdated: boolean; metadata?: RepoMetadata}>}
 *          - path: リポジトリのフルパス
 *          - wasUpdated: 既存リポジトリを更新した場合はtrue、新規クローンの場合はfalse
 *          - metadata: リポジトリのメタデータ（未実装のため常にundefined）
 * @throws {Error} クローンまたは更新に失敗した場合
 *
 * @example
 * const result = await ensureRepository(
 *   { org: "octocat", repo: "Hello-World", fullName: "octocat/Hello-World", localPath: "octocat/Hello-World" },
 *   workspaceManager
 * );
 * // { path: "/work/repositories/octocat/Hello-World", wasUpdated: false }
 */
export async function ensureRepository(
  repository: GitRepository,
  workspaceManager: WorkspaceManager,
): Promise<{ path: string; wasUpdated: boolean; metadata?: RepoMetadata }> {
  const fullPath = workspaceManager.getRepositoryPath(
    repository.org,
    repository.repo,
  );

  try {
    // ディレクトリが存在するかチェック
    const stat = await Deno.stat(fullPath);
    if (stat.isDirectory) {
      // 既存リポジトリを最新に更新
      await updateRepositoryWithGh(fullPath, "main");
      return { path: fullPath, wasUpdated: true };
    }
  } catch (_error) {
    // ディレクトリが存在しない場合は新規clone
  }

  // 親ディレクトリを作成
  await Deno.mkdir(
    join(workspaceManager.getRepositoriesDir(), repository.org),
    { recursive: true },
  );

  // ghコマンドでリポジトリをclone
  const cloneProcess = new Deno.Command("gh", {
    args: ["repo", "clone", repository.fullName, fullPath],
    stdout: "piped",
    stderr: "piped",
  });

  const cloneResult = await cloneProcess.output();
  if (!cloneResult.success) {
    const error = new TextDecoder().decode(cloneResult.stderr);
    throw new Error(`リポジトリのcloneに失敗しました: ${error}`);
  }

  return { path: fullPath, wasUpdated: false };
}

/**
 * リポジトリのメタデータを表すインターフェース
 *
 * GitHubリポジトリの詳細情報を格納する。
 * 現在は未使用だが、将来的にghコマンドやGitHub APIから取得した
 * リポジトリ情報を格納するために使用される予定。
 *
 * @property {string} name - リポジトリ名
 * @property {string} fullName - 「org/repo」形式の完全なリポジトリ名
 * @property {string} description - リポジトリの説明
 * @property {string} defaultBranch - デフォルトブランチ名（通常は"main"または"master"）
 * @property {string} language - 主要なプログラミング言語
 * @property {string} updatedAt - 最終更新日時（ISO 8601形式）
 * @property {boolean} isPrivate - プライベートリポジトリかどうか
 */
export interface RepoMetadata {
  name: string;
  fullName: string;
  description: string;
  defaultBranch: string;
  language: string;
  updatedAt: string;
  isPrivate: boolean;
}

/**
 * 既存のリポジトリを最新の状態に更新する（内部関数）
 *
 * 以下の手順でリポジトリを更新する：
 * 1. git fetch originでリモートの最新情報を取得
 * 2. 現在のブランチがデフォルトブランチでない場合は切り替え
 * 3. git reset --hard origin/<defaultBranch>でローカルをリモートに合わせる
 *
 * @param {string} repoPath - リポジトリのローカルパス
 * @param {string} defaultBranch - デフォルトブランチ名（通常は"main"）
 * @returns {Promise<void>}
 * @throws {Error} git操作（fetch、checkout、reset）のいずれかが失敗した場合
 */
async function updateRepositoryWithGh(
  repoPath: string,
  defaultBranch: string,
): Promise<void> {
  // リモートリポジトリから最新情報を取得
  const fetchProcess = new Deno.Command("git", {
    args: ["fetch", "origin"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const fetchResult = await fetchProcess.output();
  if (!fetchResult.success) {
    const error = new TextDecoder().decode(fetchResult.stderr);
    throw new Error(`git fetchに失敗しました: ${error}`);
  }

  // 現在のブランチがデフォルトブランチでない場合は切り替え
  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch !== defaultBranch) {
    // デフォルトブランチに切り替え
    const checkoutProcess = new Deno.Command("git", {
      args: ["checkout", defaultBranch],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const checkoutResult = await checkoutProcess.output();
    if (!checkoutResult.success) {
      const error = new TextDecoder().decode(checkoutResult.stderr);
      throw new Error(`git checkoutに失敗しました: ${error}`);
    }
  }

  // デフォルトブランチを最新にリセット
  const resetProcess = new Deno.Command("git", {
    args: ["reset", "--hard", `origin/${defaultBranch}`],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const resetResult = await resetProcess.output();
  if (!resetResult.success) {
    const error = new TextDecoder().decode(resetResult.stderr);
    throw new Error(`git resetに失敗しました: ${error}`);
  }
}

/**
 * 指定されたパスにworktreeコピーが存在するかを確認する
 *
 * @param {string} worktreePath - 確認するworktreeディレクトリのパス
 * @returns {Promise<boolean>} ディレクトリが存在する場合はtrue、存在しない場合はfalse
 *
 * @example
 * const exists = await isWorktreeCopyExists("/work/repositories/octocat/Hello-World/worker-123");
 * // true または false
 */
export async function isWorktreeCopyExists(
  worktreePath: string,
): Promise<boolean> {
  try {
    // worktreeディレクトリが存在するかチェック
    const stat = await Deno.stat(worktreePath);
    return stat.isDirectory;
  } catch (_error) {
    // ディレクトリが存在しない場合
    return false;
  }
}

/**
 * リポジトリのworktreeコピーを作成する
 *
 * 指定されたリポジトリの完全なコピーを作成し、新しいブランチを作成する。
 * rsyncを使用してディレクトリ全体（.gitを含む）をコピーし、
 * 「worker-<workerName>-<timestamp>」形式の新しいブランチを作成する。
 *
 * .gitディレクトリが存在しない場合（テスト環境など）は、
 * 新規にgit initして初期化を行う。
 *
 * @param {string} repositoryPath - コピー元のリポジトリパス
 * @param {string} workerName - Workerの識別名（ブランチ名に使用）
 * @param {string} worktreePath - コピー先のディレクトリパス
 * @returns {Promise<void>}
 * @throws {Error} ディレクトリ作成、rsyncコピー、git操作のいずれかが失敗した場合
 *
 * @example
 * await createWorktreeCopy(
 *   "/work/repositories/octocat/Hello-World",
 *   "thread-123456",
 *   "/work/repositories/octocat/Hello-World/worker-thread-123456"
 * );
 * // 新しいブランチ "worker-thread-123456-1234567890000" が作成される
 */
export async function createWorktreeCopy(
  repositoryPath: string,
  workerName: string,
  worktreePath: string,
): Promise<void> {
  try {
    // worktreeディレクトリを作成
    await Deno.mkdir(worktreePath, { recursive: true });

    // リポジトリの内容をworktreeディレクトリにコピー（.gitも含む）
    const copyProcess = new Deno.Command("rsync", {
      args: ["-a", repositoryPath + "/", worktreePath + "/"],
      stdout: "piped",
      stderr: "piped",
    });

    const copyResult = await copyProcess.output();
    if (!copyResult.success) {
      const error = new TextDecoder().decode(copyResult.stderr);
      throw new Error(`リポジトリのコピーに失敗しました: ${error}`);
    }

    // .gitディレクトリが存在するか確認
    try {
      await Deno.stat(`${worktreePath}/.git`);

      // .gitが存在する場合は新しいブランチを作成
      const timestamp = Date.now();
      const branchName = `worker-${workerName}-${timestamp}`;

      const checkoutProcess = new Deno.Command("git", {
        args: ["checkout", "-b", branchName],
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });

      const checkoutResult = await checkoutProcess.output();
      if (!checkoutResult.success) {
        const error = new TextDecoder().decode(checkoutResult.stderr);
        throw new Error(`ブランチの作成に失敗しました: ${error}`);
      }
    } catch (e) {
      // .gitディレクトリが存在しない場合（テスト環境など）
      if (e instanceof Deno.errors.NotFound) {
        // git initして新規リポジトリとして初期化
        const initProcess = new Deno.Command("git", {
          args: ["init"],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });

        const initResult = await initProcess.output();
        if (!initResult.success) {
          const error = new TextDecoder().decode(initResult.stderr);
          throw new Error(`git initに失敗しました: ${error}`);
        }

        // gitユーザー設定（コミットに必要）
        const configNameProcess = new Deno.Command("git", {
          args: ["config", "user.name", "Discord Bot"],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });
        await configNameProcess.output();

        const configEmailProcess = new Deno.Command("git", {
          args: ["config", "user.email", "bot@example.com"],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });
        await configEmailProcess.output();

        // 全てのファイルをステージング
        const addProcess = new Deno.Command("git", {
          args: ["add", "."],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });

        const addResult = await addProcess.output();
        if (!addResult.success) {
          const error = new TextDecoder().decode(addResult.stderr);
          throw new Error(`git addに失敗しました: ${error}`);
        }

        // 初期コミット
        const timestamp = Date.now();
        const commitProcess = new Deno.Command("git", {
          args: [
            "commit",
            "-m",
            `Initial worktree copy for ${workerName} at ${timestamp}`,
          ],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });

        const commitResult = await commitProcess.output();
        if (!commitResult.success) {
          const error = new TextDecoder().decode(commitResult.stderr);
          throw new Error(`git commitに失敗しました: ${error}`);
        }

        // ブランチ名を設定
        const branchName = `worker-${workerName}-${timestamp}`;
        const branchProcess = new Deno.Command("git", {
          args: ["branch", "-m", branchName],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });

        const branchResult = await branchProcess.output();
        if (!branchResult.success) {
          const error = new TextDecoder().decode(branchResult.stderr);
          throw new Error(`ブランチ名の設定に失敗しました: ${error}`);
        }
      } else {
        throw e;
      }
    }

    return;
  } catch (error) {
    throw new Error(`worktreeコピーの作成に失敗しました: ${error}`);
  }
}

/**
 * 指定されたリポジトリの現在のブランチ名を取得する（内部関数）
 *
 * git branch --show-currentコマンドを使用して現在チェックアウトされている
 * ブランチ名を取得する。
 *
 * @param {string} repoPath - リポジトリのローカルパス
 * @returns {Promise<string>} 現在のブランチ名
 * @throws {Error} gitコマンドの実行に失敗した場合
 */
async function getCurrentBranch(repoPath: string): Promise<string> {
  const branchProcess = new Deno.Command("git", {
    args: ["branch", "--show-current"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const branchResult = await branchProcess.output();
  if (!branchResult.success) {
    throw new Error("現在のブランチの取得に失敗しました");
  }

  return new TextDecoder().decode(branchResult.stdout).trim();
}
