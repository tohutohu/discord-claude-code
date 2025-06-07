import { assertEquals, assertExists } from "std/assert/mod.ts";
import { afterEach, beforeEach, describe, it } from "std/testing/bdd.ts";
import { RepositoryPatInfo, WorkspaceManager } from "../src/workspace.ts";
import { join } from "std/path/mod.ts";

describe("WorkspaceManager PAT管理機能", () => {
  let workspaceManager: WorkspaceManager;
  let tempDir: string;

  beforeEach(async () => {
    // テスト用の一時ディレクトリを作成
    tempDir = await Deno.makeTempDir({ prefix: "workspace_pat_test_" });
    workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();
  });

  afterEach(async () => {
    // テスト用ディレクトリをクリーンアップ
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch (error) {
      console.error("テストディレクトリのクリーンアップに失敗:", error);
    }
  });

  it("PATを保存できる", async () => {
    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "owner/repo",
      token: "ghp_test1234567890abcdefghijklmnopqrstu",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: "テスト用PAT",
    };

    await workspaceManager.saveRepositoryPat(patInfo);

    // ファイルが作成されたことを確認
    const patFilePath = join(tempDir, "pats", "owner_repo.json");
    const fileInfo = await Deno.stat(patFilePath);
    assertExists(fileInfo);
  });

  it("保存したPATを読み込める", async () => {
    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "owner/repo",
      token: "ghp_test1234567890abcdefghijklmnopqrstu",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: "テスト用PAT",
    };

    await workspaceManager.saveRepositoryPat(patInfo);

    const loadedPat = await workspaceManager.loadRepositoryPat("owner/repo");
    assertExists(loadedPat);
    assertEquals(loadedPat.repositoryFullName, patInfo.repositoryFullName);
    assertEquals(loadedPat.token, patInfo.token);
    assertEquals(loadedPat.description, patInfo.description);
  });

  it("存在しないPATの読み込みはnullを返す", async () => {
    const loadedPat = await workspaceManager.loadRepositoryPat(
      "nonexistent/repo",
    );
    assertEquals(loadedPat, null);
  });

  it("PATを削除できる", async () => {
    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "owner/repo",
      token: "ghp_test1234567890abcdefghijklmnopqrstu",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await workspaceManager.saveRepositoryPat(patInfo);
    await workspaceManager.deleteRepositoryPat("owner/repo");

    const loadedPat = await workspaceManager.loadRepositoryPat("owner/repo");
    assertEquals(loadedPat, null);
  });

  it("存在しないPATの削除はエラーにならない", async () => {
    // エラーが発生しないことを確認
    await workspaceManager.deleteRepositoryPat("nonexistent/repo");
  });

  it("複数のPATを管理できる", async () => {
    const pats: RepositoryPatInfo[] = [
      {
        repositoryFullName: "owner1/repo1",
        token: "ghp_test1111111111111111111111111111111",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: "リポジトリ1用",
      },
      {
        repositoryFullName: "owner2/repo2",
        token: "ghp_test2222222222222222222222222222222",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: "リポジトリ2用",
      },
      {
        repositoryFullName: "owner3/repo3",
        token: "ghp_test3333333333333333333333333333333",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // すべて保存
    for (const pat of pats) {
      await workspaceManager.saveRepositoryPat(pat);
    }

    // 一覧を取得
    const patList = await workspaceManager.listRepositoryPats();
    assertEquals(patList.length, 3);

    // リポジトリ名でソートされていることを確認
    assertEquals(patList[0].repositoryFullName, "owner1/repo1");
    assertEquals(patList[1].repositoryFullName, "owner2/repo2");
    assertEquals(patList[2].repositoryFullName, "owner3/repo3");
  });

  it("PATの更新で updatedAt が変更される", async () => {
    const originalPat: RepositoryPatInfo = {
      repositoryFullName: "owner/repo",
      token: "ghp_original11111111111111111111111111",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      description: "元のPAT",
    };

    await workspaceManager.saveRepositoryPat(originalPat);

    // 少し待機
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 更新
    const updatedPat: RepositoryPatInfo = {
      ...originalPat,
      token: "ghp_updated222222222222222222222222222",
      description: "更新されたPAT",
    };

    await workspaceManager.saveRepositoryPat(updatedPat);

    const loadedPat = await workspaceManager.loadRepositoryPat("owner/repo");
    assertExists(loadedPat);
    assertEquals(loadedPat.token, updatedPat.token);
    assertEquals(loadedPat.description, updatedPat.description);
    assertEquals(loadedPat.createdAt, originalPat.createdAt);
    // updatedAtが更新されていることを確認
    assertExists(loadedPat.updatedAt);
    assertEquals(loadedPat.updatedAt > originalPat.updatedAt, true);
  });

  it("スラッシュを含むリポジトリ名を正しく処理できる", async () => {
    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "owner/sub-owner/repo-name",
      token: "ghp_test1234567890abcdefghijklmnopqrstu",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await workspaceManager.saveRepositoryPat(patInfo);

    // ファイル名にスラッシュが含まれないことを確認
    const patFilePath = join(tempDir, "pats", "owner_sub-owner_repo-name.json");
    const fileInfo = await Deno.stat(patFilePath);
    assertExists(fileInfo);

    // 正しく読み込めることを確認
    const loadedPat = await workspaceManager.loadRepositoryPat(
      "owner/sub-owner/repo-name",
    );
    assertExists(loadedPat);
    assertEquals(loadedPat.repositoryFullName, patInfo.repositoryFullName);
  });
});
