import { join } from "std/path/mod.ts";

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
  baseDir: string,
): Promise<string> {
  const fullPath = join(baseDir, repository.localPath);
  const gitUrl = `https://github.com/${repository.fullName}.git`;

  try {
    // ディレクトリが存在するかチェック
    const stat = await Deno.stat(fullPath);
    if (stat.isDirectory) {
      // 既存リポジトリを最新に更新
      await updateRepository(fullPath);
      return fullPath;
    }
  } catch (_error) {
    // ディレクトリが存在しない場合は新規clone
  }

  // 親ディレクトリを作成
  await Deno.mkdir(join(baseDir, repository.org), { recursive: true });

  // リポジトリをclone
  const cloneProcess = new Deno.Command("git", {
    args: ["clone", gitUrl, fullPath],
    stdout: "piped",
    stderr: "piped",
  });

  const cloneResult = await cloneProcess.output();
  if (!cloneResult.success) {
    const error = new TextDecoder().decode(cloneResult.stderr);
    throw new Error(`リポジトリのcloneに失敗しました: ${error}`);
  }

  return fullPath;
}

async function updateRepository(repoPath: string): Promise<void> {
  // デフォルトブランチの最新を取得
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

  // デフォルトブランチを取得
  const defaultBranchProcess = new Deno.Command("git", {
    args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const defaultBranchResult = await defaultBranchProcess.output();
  let defaultBranch = "main";

  if (defaultBranchResult.success) {
    const output = new TextDecoder().decode(defaultBranchResult.stdout).trim();
    defaultBranch = output.replace("refs/remotes/origin/", "");
  }

  // デフォルトブランチにリセット
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
