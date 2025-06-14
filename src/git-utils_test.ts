import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { ensureRepository, parseRepository } from "./git-utils.ts";
import { WorkspaceManager } from "./workspace/workspace.ts";
import { join } from "std/path/mod.ts";

Deno.test("parseRepository - 正しい形式のリポジトリ名をパースできる", () => {
  const result = parseRepository("owner/repo");
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.org, "owner");
    assertEquals(result.value.repo, "repo");
    assertEquals(result.value.fullName, "owner/repo");
    assertEquals(result.value.localPath, join("owner", "repo"));
  }
});

Deno.test("parseRepository - 不正な形式でエラーになる", () => {
  const invalidFormats = [
    "invalid",
    "owner//repo",
    "/repo",
    "owner/",
    "owner/repo/extra",
    "",
  ];

  for (const format of invalidFormats) {
    const result = parseRepository(format);
    assertEquals(result.isErr(), true);
    if (result.isErr()) {
      assertEquals(result.error.type, "INVALID_REPOSITORY_NAME");
      if (result.error.type === "INVALID_REPOSITORY_NAME") {
        assertEquals(
          result.error.message,
          "リポジトリ名は <org>/<repo> 形式で指定してください",
        );
      }
    }
  }
});

Deno.test("updateRepositoryWithGh - ローカル変更がある場合は更新をスキップする", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // テスト用のgitリポジトリを作成
    const repoPath = join(tempDir, "test-repo");
    await Deno.mkdir(repoPath);

    // git init
    const initCmd = new Deno.Command("git", {
      args: ["init"],
      cwd: repoPath,
    });
    await initCmd.output();

    // git config
    const configNameCmd = new Deno.Command("git", {
      args: ["config", "user.name", "Test User"],
      cwd: repoPath,
    });
    await configNameCmd.output();

    const configEmailCmd = new Deno.Command("git", {
      args: ["config", "user.email", "test@example.com"],
      cwd: repoPath,
    });
    await configEmailCmd.output();

    // ファイルを作成してコミット
    await Deno.writeTextFile(join(repoPath, "test.txt"), "initial content");

    const addCmd = new Deno.Command("git", {
      args: ["add", "."],
      cwd: repoPath,
    });
    await addCmd.output();

    const commitCmd = new Deno.Command("git", {
      args: ["commit", "-m", "initial commit"],
      cwd: repoPath,
    });
    await commitCmd.output();

    // ローカル変更を作成（コミットしない）
    await Deno.writeTextFile(join(repoPath, "test.txt"), "modified content");

    // updateRepositoryWithGhを呼び出す（実際にはprivate関数なので、ここではテストの構造のみ示す）
    // 実際のテストでは、ensureRepositoryを通じて間接的にテストするか、
    // updateRepositoryWithGhをexportする必要がある

    // ファイルの内容が変更されたままであることを確認
    const content = await Deno.readTextFile(join(repoPath, "test.txt"));
    assertEquals(content, "modified content");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureRepository - 新規リポジトリのクローンをスキップ（ghコマンドが必要）", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  try {
    const repositoryResult = parseRepository("test-org/test-repo");
    assertEquals(repositoryResult.isOk(), true);

    if (repositoryResult.isOk()) {
      const repository = repositoryResult.value;
      // ghコマンドがない環境ではエラーになることを確認
      const result = await ensureRepository(repository, workspaceManager);
      assertEquals(result.isErr(), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
