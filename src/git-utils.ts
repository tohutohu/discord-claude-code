import { join } from "std/path/mod.ts";
import { WorkspaceManager } from "./workspace.ts";
import { GIT } from "./constants.ts";

export interface GitRepository {
  org: string;
  repo: string;
  fullName: string;
  localPath: string;
}

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
      await updateRepositoryWithGh(fullPath, GIT.DEFAULT_BRANCH);
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

export interface RepoMetadata {
  name: string;
  fullName: string;
  description: string;
  defaultBranch: string;
  language: string;
  updatedAt: string;
  isPrivate: boolean;
}

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
          args: ["config", "user.name", GIT.BOT_USER_NAME],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });
        await configNameProcess.output();

        const configEmailProcess = new Deno.Command("git", {
          args: ["config", "user.email", GIT.BOT_USER_EMAIL],
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
