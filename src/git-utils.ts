import { join } from "std/path/mod.ts";
import { WorkspaceManager } from "./workspace.ts";
import { GIT } from "./constants.ts";
import { err, ok, Result } from "neverthrow";

// エラー型定義
export type GitUtilsError =
  | { type: "INVALID_REPOSITORY_NAME"; message: string }
  | { type: "REPOSITORY_NOT_FOUND"; path: string }
  | { type: "CLONE_FAILED"; error: string }
  | { type: "UPDATE_FAILED"; error: string }
  | { type: "WORKTREE_CREATE_FAILED"; error: string }
  | { type: "COMMAND_EXECUTION_FAILED"; command: string; error: string }
  | { type: "PERMISSION_ERROR"; path: string; error: string }
  | { type: "GH_CLI_ERROR"; command: string; error: string };

export interface GitRepository {
  org: string;
  repo: string;
  fullName: string;
  localPath: string;
}

export function parseRepository(
  repoSpec: string,
): Result<GitRepository, GitUtilsError> {
  const match = repoSpec.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) {
    return err({
      type: "INVALID_REPOSITORY_NAME",
      message: "リポジトリ名は <org>/<repo> 形式で指定してください",
    });
  }

  const [, org, repo] = match;
  return ok({
    org,
    repo,
    fullName: `${org}/${repo}`,
    localPath: join(org, repo),
  });
}

export async function ensureRepository(
  repository: GitRepository,
  workspaceManager: WorkspaceManager,
): Promise<
  Result<
    { path: string; wasUpdated: boolean; metadata?: RepoMetadata },
    GitUtilsError
  >
> {
  const fullPath = workspaceManager.getRepositoryPath(
    repository.org,
    repository.repo,
  );

  try {
    // ディレクトリが存在するかチェック
    const stat = await Deno.stat(fullPath);
    if (stat.isDirectory) {
      // 既存リポジトリを最新に更新
      const updateResult = await updateRepositoryWithGh(
        fullPath,
        GIT.DEFAULT_BRANCH,
      );
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
      return ok({ path: fullPath, wasUpdated: true });
    }
  } catch (_error) {
    // ディレクトリが存在しない場合は新規clone
  }

  // 親ディレクトリを作成
  try {
    await Deno.mkdir(
      join(workspaceManager.getRepositoriesDir(), repository.org),
      { recursive: true },
    );
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "PERMISSION_ERROR",
        path: join(workspaceManager.getRepositoriesDir(), repository.org),
        error: error.message,
      });
    }
    return err({
      type: "PERMISSION_ERROR",
      path: join(workspaceManager.getRepositoriesDir(), repository.org),
      error: "Unknown error",
    });
  }

  // ghコマンドでリポジトリをclone
  const cloneResult = await cloneRepository(repository.fullName, fullPath);
  if (cloneResult.isErr()) {
    return err(cloneResult.error);
  }

  return ok({ path: fullPath, wasUpdated: false });
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

/**
 * ghコマンドを使用してリポジトリをクローンする
 */
async function cloneRepository(
  fullName: string,
  fullPath: string,
): Promise<Result<void, GitUtilsError>> {
  const cloneProcess = new Deno.Command("gh", {
    args: ["repo", "clone", fullName, fullPath],
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const cloneResult = await cloneProcess.output();
    if (!cloneResult.success) {
      const error = new TextDecoder().decode(cloneResult.stderr);
      return err({
        type: "GH_CLI_ERROR",
        command: "gh repo clone",
        error: `リポジトリのcloneに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "gh repo clone",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "gh repo clone",
      error: "Unknown error",
    });
  }
}

async function updateRepositoryWithGh(
  repoPath: string,
  defaultBranch: string,
): Promise<Result<void, GitUtilsError>> {
  // リモートリポジトリから最新情報を取得
  const fetchProcess = new Deno.Command("git", {
    args: ["fetch", "origin"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const fetchResult = await fetchProcess.output();
    if (!fetchResult.success) {
      const error = new TextDecoder().decode(fetchResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git fetch",
        error: `git fetchに失敗しました: ${error}`,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git fetch",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git fetch",
      error: "Unknown error",
    });
  }

  // 現在のブランチがデフォルトブランチでない場合は切り替え
  const currentBranchResult = await getCurrentBranch(repoPath);
  if (currentBranchResult.isErr()) {
    return err(currentBranchResult.error);
  }
  const currentBranch = currentBranchResult.value;
  if (currentBranch !== defaultBranch) {
    // デフォルトブランチに切り替え
    const checkoutProcess = new Deno.Command("git", {
      args: ["checkout", defaultBranch],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    try {
      const checkoutResult = await checkoutProcess.output();
      if (!checkoutResult.success) {
        const error = new TextDecoder().decode(checkoutResult.stderr);
        return err({
          type: "COMMAND_EXECUTION_FAILED",
          command: "git checkout",
          error: `git checkoutに失敗しました: ${error}`,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        return err({
          type: "COMMAND_EXECUTION_FAILED",
          command: "git checkout",
          error: error.message,
        });
      }
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git checkout",
        error: "Unknown error",
      });
    }
  }

  // デフォルトブランチを最新にリセット
  const resetProcess = new Deno.Command("git", {
    args: ["reset", "--hard", `origin/${defaultBranch}`],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const resetResult = await resetProcess.output();
    if (!resetResult.success) {
      const error = new TextDecoder().decode(resetResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git reset",
        error: `git resetに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git reset",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git reset",
      error: "Unknown error",
    });
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

/**
 * ブランチ名を生成する
 */
function generateBranchName(workerName: string): string {
  const timestamp = Date.now();
  return `worker-${workerName}-${timestamp}`;
}

/**
 * rsyncでリポジトリをコピーする
 */
async function copyRepository(
  repositoryPath: string,
  worktreePath: string,
): Promise<Result<void, GitUtilsError>> {
  try {
    await Deno.mkdir(worktreePath, { recursive: true });
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "PERMISSION_ERROR",
        path: worktreePath,
        error: error.message,
      });
    }
    return err({
      type: "PERMISSION_ERROR",
      path: worktreePath,
      error: "Unknown error",
    });
  }

  const copyProcess = new Deno.Command("rsync", {
    args: ["-a", `${repositoryPath}/`, `${worktreePath}/`],
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const copyResult = await copyProcess.output();
    if (!copyResult.success) {
      const error = new TextDecoder().decode(copyResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "rsync",
        error: `リポジトリのコピーに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "rsync",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "rsync",
      error: "Unknown error",
    });
  }
}

/**
 * .gitディレクトリの存在を確認する
 */
async function checkGitDirectory(worktreePath: string): Promise<boolean> {
  try {
    await Deno.stat(`${worktreePath}/.git`);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return false;
    }
    throw e;
  }
}

/**
 * 新しいブランチを作成する
 */
async function createNewBranch(
  worktreePath: string,
  branchName: string,
): Promise<Result<void, GitUtilsError>> {
  const checkoutProcess = new Deno.Command("git", {
    args: ["checkout", "-b", branchName],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const checkoutResult = await checkoutProcess.output();
    if (!checkoutResult.success) {
      const error = new TextDecoder().decode(checkoutResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git checkout -b",
        error: `ブランチの作成に失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git checkout -b",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git checkout -b",
      error: "Unknown error",
    });
  }
}

/**
 * 新規リポジトリとして初期化する
 */
async function initializeNewRepository(
  worktreePath: string,
): Promise<Result<void, GitUtilsError>> {
  const initProcess = new Deno.Command("git", {
    args: ["init"],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const initResult = await initProcess.output();
    if (!initResult.success) {
      const error = new TextDecoder().decode(initResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git init",
        error: `git initに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git init",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git init",
      error: "Unknown error",
    });
  }
}

/**
 * Gitユーザー設定を行う
 */
async function configureGitUser(
  worktreePath: string,
): Promise<Result<void, GitUtilsError>> {
  const configNameProcess = new Deno.Command("git", {
    args: ["config", "user.name", GIT.BOT_USER_NAME],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const nameResult = await configNameProcess.output();
    if (!nameResult.success) {
      const error = new TextDecoder().decode(nameResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git config user.name",
        error: `git config user.nameに失敗しました: ${error}`,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git config user.name",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git config user.name",
      error: "Unknown error",
    });
  }

  const configEmailProcess = new Deno.Command("git", {
    args: ["config", "user.email", GIT.BOT_USER_EMAIL],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const emailResult = await configEmailProcess.output();
    if (!emailResult.success) {
      const error = new TextDecoder().decode(emailResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git config user.email",
        error: `git config user.emailに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git config user.email",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git config user.email",
      error: "Unknown error",
    });
  }
}

/**
 * ファイルのステージングとコミットを行う
 */
async function stageAndCommitFiles(
  worktreePath: string,
  workerName: string,
): Promise<Result<void, GitUtilsError>> {
  // 全てのファイルをステージング
  const addProcess = new Deno.Command("git", {
    args: ["add", "."],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const addResult = await addProcess.output();
    if (!addResult.success) {
      const error = new TextDecoder().decode(addResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git add",
        error: `git addに失敗しました: ${error}`,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git add",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git add",
      error: "Unknown error",
    });
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

  try {
    const commitResult = await commitProcess.output();
    if (!commitResult.success) {
      const error = new TextDecoder().decode(commitResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git commit",
        error: `git commitに失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git commit",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git commit",
      error: "Unknown error",
    });
  }
}

/**
 * ブランチ名を設定する
 */
async function renameBranch(
  worktreePath: string,
  branchName: string,
): Promise<Result<void, GitUtilsError>> {
  const branchProcess = new Deno.Command("git", {
    args: ["branch", "-m", branchName],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const branchResult = await branchProcess.output();
    if (!branchResult.success) {
      const error = new TextDecoder().decode(branchResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git branch -m",
        error: `ブランチ名の設定に失敗しました: ${error}`,
      });
    }
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git branch -m",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git branch -m",
      error: "Unknown error",
    });
  }
}

export async function createWorktreeCopy(
  repositoryPath: string,
  workerName: string,
  worktreePath: string,
): Promise<Result<void, GitUtilsError>> {
  // リポジトリをコピー
  const copyResult = await copyRepository(repositoryPath, worktreePath);
  if (copyResult.isErr()) {
    return err({
      type: "WORKTREE_CREATE_FAILED",
      error: `worktreeコピーの作成に失敗しました: ${
        copyResult.error.type === "COMMAND_EXECUTION_FAILED"
          ? copyResult.error.error
          : "Unknown error"
      }`,
    });
  }

  // .gitディレクトリの存在を確認
  const hasGitDirectory = await checkGitDirectory(worktreePath);

  if (hasGitDirectory) {
    // 既存のGitリポジトリの場合は新しいブランチを作成
    const branchName = generateBranchName(workerName);
    const branchResult = await createNewBranch(worktreePath, branchName);
    if (branchResult.isErr()) {
      return err({
        type: "WORKTREE_CREATE_FAILED",
        error: `worktreeコピーの作成に失敗しました: ${
          branchResult.error.type === "COMMAND_EXECUTION_FAILED"
            ? branchResult.error.error
            : "Unknown error"
        }`,
      });
    }
  } else {
    // .gitディレクトリが存在しない場合（テスト環境など）
    // 新規リポジトリとして初期化
    const initResult = await initializeNewRepository(worktreePath);
    if (initResult.isErr()) {
      return err({
        type: "WORKTREE_CREATE_FAILED",
        error: `worktreeコピーの作成に失敗しました: ${
          initResult.error.type === "COMMAND_EXECUTION_FAILED"
            ? initResult.error.error
            : "Unknown error"
        }`,
      });
    }

    // Gitユーザー設定
    const configResult = await configureGitUser(worktreePath);
    if (configResult.isErr()) {
      return err({
        type: "WORKTREE_CREATE_FAILED",
        error: `worktreeコピーの作成に失敗しました: ${
          configResult.error.type === "COMMAND_EXECUTION_FAILED"
            ? configResult.error.error
            : "Unknown error"
        }`,
      });
    }

    // ファイルをステージングしてコミット
    const commitResult = await stageAndCommitFiles(worktreePath, workerName);
    if (commitResult.isErr()) {
      return err({
        type: "WORKTREE_CREATE_FAILED",
        error: `worktreeコピーの作成に失敗しました: ${
          commitResult.error.type === "COMMAND_EXECUTION_FAILED"
            ? commitResult.error.error
            : "Unknown error"
        }`,
      });
    }

    // ブランチ名を設定
    const branchName = generateBranchName(workerName);
    const renameResult = await renameBranch(worktreePath, branchName);
    if (renameResult.isErr()) {
      return err({
        type: "WORKTREE_CREATE_FAILED",
        error: `worktreeコピーの作成に失敗しました: ${
          renameResult.error.type === "COMMAND_EXECUTION_FAILED"
            ? renameResult.error.error
            : "Unknown error"
        }`,
      });
    }
  }

  return ok(undefined);
}

async function getCurrentBranch(
  repoPath: string,
): Promise<Result<string, GitUtilsError>> {
  const branchProcess = new Deno.Command("git", {
    args: ["branch", "--show-current"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const branchResult = await branchProcess.output();
    if (!branchResult.success) {
      const error = new TextDecoder().decode(branchResult.stderr);
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git branch --show-current",
        error: `現在のブランチの取得に失敗しました: ${error}`,
      });
    }
    return ok(new TextDecoder().decode(branchResult.stdout).trim());
  } catch (error) {
    if (error instanceof Error) {
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "git branch --show-current",
        error: error.message,
      });
    }
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "git branch --show-current",
      error: "Unknown error",
    });
  }
}
