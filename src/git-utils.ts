import { join } from "std/path/mod.ts";
import { WorkspaceManager } from "./workspace.ts";

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

export async function isWorktreeExists(
  repositoryPath: string,
  worktreePath: string,
): Promise<boolean> {
  try {
    // git worktree list コマンドでワークツリーの一覧を取得
    const worktreeProcess = new Deno.Command("git", {
      args: ["worktree", "list"],
      cwd: repositoryPath,
      stdout: "piped",
      stderr: "piped",
    });
    const worktreeResult = await worktreeProcess.output();
    if (!worktreeResult.success) {
      const error = new TextDecoder().decode(worktreeResult.stderr);
      throw new Error(`git worktree listに失敗しました: ${error}`);
    }
    const worktreeOutput = new TextDecoder().decode(worktreeResult.stdout);
    // ワークツリーのパスが存在するかチェック
    const worktreeLines = worktreeOutput.split("\n").map((line) => line.trim());
    return worktreeLines.some((line) => line.startsWith(worktreePath));
  } catch (error) {
    // .gitディレクトリが存在しない場合はエラーになるので、falseを返す
    return false;
  }
}

export async function createWorktree(
  repositoryPath: string,
  workerName: string,
  worktreePath: string,
): Promise<void> {
  // 現在の時刻を使ってユニークなブランチ名を生成
  const timestamp = Date.now();
  const branchName = `worker-${workerName}-${timestamp}`;

  try {
    // デフォルトブランチを取得
    const defaultBranch = await getDefaultBranch(repositoryPath);

    // worktreeを作成
    const worktreeProcess = new Deno.Command("git", {
      args: [
        "worktree",
        "add",
        "-b",
        branchName,
        worktreePath,
        defaultBranch,
      ],
      cwd: repositoryPath,
      stdout: "piped",
      stderr: "piped",
    });

    const worktreeResult = await worktreeProcess.output();
    if (!worktreeResult.success) {
      const error = new TextDecoder().decode(worktreeResult.stderr);
      throw new Error(`git worktreeの作成に失敗しました: ${error}`);
    }

    return;
  } catch (error) {
    throw new Error(`worktreeの作成に失敗しました: ${error}`);
  }
}

async function getDefaultBranch(repositoryPath: string): Promise<string> {
  // 現在のブランチを取得
  const currentBranchProcess = new Deno.Command("git", {
    args: ["branch", "--show-current"],
    cwd: repositoryPath,
    stdout: "piped",
    stderr: "piped",
  });

  const currentBranchResult = await currentBranchProcess.output();
  if (currentBranchResult.success) {
    const currentBranch = new TextDecoder().decode(currentBranchResult.stdout)
      .trim();
    if (currentBranch) {
      return currentBranch;
    }
  }

  // 現在のブランチが取得できない場合は、リモートのデフォルトブランチを取得
  const defaultBranchProcess = new Deno.Command("git", {
    args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
    cwd: repositoryPath,
    stdout: "piped",
    stderr: "piped",
  });

  const defaultBranchResult = await defaultBranchProcess.output();
  if (defaultBranchResult.success) {
    const output = new TextDecoder().decode(defaultBranchResult.stdout).trim();
    return output.replace("refs/remotes/origin/", "");
  }

  // それでもダメならHEADを使用
  return "HEAD";
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
