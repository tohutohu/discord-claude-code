import { assertEquals } from "std/assert/mod.ts";
import { parseRepository } from "../src/git-utils.ts";

Deno.test("parseRepository関数のテスト", async (t) => {
  await t.step("正常なリポジトリ名をパースできる", () => {
    const result = parseRepository("owner/repo");
    assertEquals(result.isOk(), true);
    if (result.isOk()) {
      assertEquals(result.value.org, "owner");
      assertEquals(result.value.repo, "repo");
      assertEquals(result.value.fullName, "owner/repo");
      assertEquals(result.value.localPath, "owner/repo");
    }
  });

  await t.step(
    "ハイフンとアンダースコアを含むリポジトリ名をパースできる",
    () => {
      const result = parseRepository("my-org_123/my-repo.test");
      assertEquals(result.isOk(), true);
      if (result.isOk()) {
        assertEquals(result.value.org, "my-org_123");
        assertEquals(result.value.repo, "my-repo.test");
        assertEquals(result.value.fullName, "my-org_123/my-repo.test");
        assertEquals(result.value.localPath, "my-org_123/my-repo.test");
      }
    },
  );

  await t.step("不正なフォーマットでエラーが発生する", () => {
    const result = parseRepository("invalid");
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
  });

  await t.step("スラッシュが複数ある場合エラーが発生する", () => {
    const result = parseRepository("org/repo/invalid");
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
  });

  await t.step("空文字列でエラーが発生する", () => {
    const result = parseRepository("");
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
  });
});
