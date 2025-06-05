import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { parseRepository } from "../src/git-utils.ts";

Deno.test("parseRepository関数のテスト", async (t) => {
  await t.step("正常なリポジトリ名をパースできる", () => {
    const result = parseRepository("owner/repo");
    assertEquals(result.org, "owner");
    assertEquals(result.repo, "repo");
    assertEquals(result.fullName, "owner/repo");
    assertEquals(result.localPath, "owner/repo");
  });

  await t.step(
    "ハイフンとアンダースコアを含むリポジトリ名をパースできる",
    () => {
      const result = parseRepository("my-org_123/my-repo.test");
      assertEquals(result.org, "my-org_123");
      assertEquals(result.repo, "my-repo.test");
      assertEquals(result.fullName, "my-org_123/my-repo.test");
      assertEquals(result.localPath, "my-org_123/my-repo.test");
    },
  );

  await t.step("不正なフォーマットでエラーが発生する", () => {
    assertThrows(
      () => parseRepository("invalid"),
      Error,
      "リポジトリ名は <org>/<repo> 形式で指定してください",
    );
  });

  await t.step("スラッシュが複数ある場合エラーが発生する", () => {
    assertThrows(
      () => parseRepository("org/repo/invalid"),
      Error,
      "リポジトリ名は <org>/<repo> 形式で指定してください",
    );
  });

  await t.step("空文字列でエラーが発生する", () => {
    assertThrows(
      () => parseRepository(""),
      Error,
      "リポジトリ名は <org>/<repo> 形式で指定してください",
    );
  });
});
