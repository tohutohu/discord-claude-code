import { assertEquals, assertExists } from "std/assert/mod.ts";
import { PatManager } from "./pat-manager.ts";
import type { RepositoryPatInfo } from "../workspace.ts";

Deno.test("PatManager - PATの保存と読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "test-org/test-repo",
      token: "ghp_test123456789",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: "Test PAT for development",
    };

    await manager.saveRepositoryPat(patInfo);

    const loaded = await manager.loadRepositoryPat(patInfo.repositoryFullName);
    assertExists(loaded);
    assertEquals(loaded.repositoryFullName, patInfo.repositoryFullName);
    assertEquals(loaded.token, patInfo.token);
    assertEquals(loaded.description, patInfo.description);
    // updatedAtは更新されているはず
    assertEquals(loaded.updatedAt >= patInfo.updatedAt, true);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - 存在しないPATの読み込み", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const result = await manager.loadRepositoryPat("non-existent/repo");
    assertEquals(result, null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - PATの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "test-org/delete-repo",
      token: "ghp_deletetest",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await manager.saveRepositoryPat(patInfo);

    // 削除前の確認
    let loaded = await manager.loadRepositoryPat(patInfo.repositoryFullName);
    assertExists(loaded);

    // 削除
    await manager.deleteRepositoryPat(patInfo.repositoryFullName);

    // 削除後の確認
    loaded = await manager.loadRepositoryPat(patInfo.repositoryFullName);
    assertEquals(loaded, null);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - 存在しないPATの削除", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    // 存在しないPATを削除してもエラーにならない
    await manager.deleteRepositoryPat("non-existent/repo");
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - すべてのPATの一覧取得", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const patInfos: RepositoryPatInfo[] = [
      {
        repositoryFullName: "org-a/repo-1",
        token: "ghp_aaa",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        repositoryFullName: "org-b/repo-2",
        token: "ghp_bbb",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        repositoryFullName: "org-a/repo-3",
        token: "ghp_ccc",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const info of patInfos) {
      await manager.saveRepositoryPat(info);
    }

    const all = await manager.listRepositoryPats();
    assertEquals(all.length, 3);
    // アルファベット順
    assertEquals(all[0].repositoryFullName, "org-a/repo-1");
    assertEquals(all[1].repositoryFullName, "org-a/repo-3");
    assertEquals(all[2].repositoryFullName, "org-b/repo-2");
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - ディレクトリが存在しない場合の listRepositoryPats", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    // initializeを呼ばずに listRepositoryPats を呼ぶ

    const all = await manager.listRepositoryPats();
    assertEquals(all, []);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - スラッシュを含むリポジトリ名の処理", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "org/sub-org/repo",
      token: "ghp_slashtest",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await manager.saveRepositoryPat(patInfo);

    const loaded = await manager.loadRepositoryPat(patInfo.repositoryFullName);
    assertExists(loaded);
    assertEquals(loaded.repositoryFullName, patInfo.repositoryFullName);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - 説明の更新", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    const patInfo: RepositoryPatInfo = {
      repositoryFullName: "test-org/test-repo",
      token: "ghp_test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: "Original description",
    };

    await manager.saveRepositoryPat(patInfo);

    const newDescription = "Updated description";
    await manager.updatePatDescription(
      patInfo.repositoryFullName,
      newDescription,
    );

    const loaded = await manager.loadRepositoryPat(patInfo.repositoryFullName);
    assertExists(loaded);
    assertEquals(loaded.description, newDescription);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - PAT有効期限チェック", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    // 10日前に作成されたPAT
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldPatInfo: RepositoryPatInfo = {
      repositoryFullName: "test-org/old-repo",
      token: "ghp_old",
      createdAt: oldDate.toISOString(),
      updatedAt: oldDate.toISOString(),
    };

    // 今日作成されたPAT
    const newPatInfo: RepositoryPatInfo = {
      repositoryFullName: "test-org/new-repo",
      token: "ghp_new",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await manager.saveRepositoryPat(oldPatInfo);
    await manager.saveRepositoryPat(newPatInfo);

    // 7日で期限切れとする
    const isOldExpired = await manager.isPatExpired(
      oldPatInfo.repositoryFullName,
      7,
    );
    const isNewExpired = await manager.isPatExpired(
      newPatInfo.repositoryFullName,
      7,
    );

    assertEquals(isOldExpired, true);
    assertEquals(isNewExpired, false);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});

Deno.test("PatManager - 期限切れPATのクリーンアップ", async () => {
  const testBaseDir = await Deno.makeTempDir();
  try {
    const manager = new PatManager(testBaseDir);
    await manager.initialize();

    // 古いPAT（10日前）
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldPat: RepositoryPatInfo = {
      repositoryFullName: "test-org/old-repo",
      token: "ghp_old",
      createdAt: oldDate.toISOString(),
      updatedAt: oldDate.toISOString(),
    };

    // 新しいPAT（3日前）
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const recentPat: RepositoryPatInfo = {
      repositoryFullName: "test-org/recent-repo",
      token: "ghp_recent",
      createdAt: recentDate.toISOString(),
      updatedAt: recentDate.toISOString(),
    };

    await manager.saveRepositoryPat(oldPat);
    await manager.saveRepositoryPat(recentPat);

    // 7日で期限切れとしてクリーンアップ
    const deleted = await manager.cleanupExpiredPats(7);

    assertEquals(deleted.length, 1);
    assertEquals(deleted[0], oldPat.repositoryFullName);

    // 残っているPATを確認
    const remaining = await manager.listRepositoryPats();
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0].repositoryFullName, recentPat.repositoryFullName);
  } finally {
    await Deno.remove(testBaseDir, { recursive: true });
  }
});
