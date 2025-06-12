import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { prepareFallbackDevcontainer } from "./devcontainer.ts";

Deno.test("fallback devcontainer機能", async (t) => {
  await t.step("fallback devcontainerをコピーできる", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      // fallback devcontainerをコピー
      const result = await prepareFallbackDevcontainer(tempDir);

      // 成功を確認
      assertEquals(result.isOk(), true);

      // .devcontainerディレクトリが作成されたことを確認
      const devcontainerPath = join(tempDir, ".devcontainer");
      const stat = await Deno.stat(devcontainerPath);
      assertEquals(stat.isDirectory, true);

      // devcontainer.jsonがコピーされたことを確認
      const devcontainerJsonPath = join(devcontainerPath, "devcontainer.json");
      const jsonStat = await Deno.stat(devcontainerJsonPath);
      assertEquals(jsonStat.isFile, true);

      // devcontainer.jsonの内容を確認
      const content = await Deno.readTextFile(devcontainerJsonPath);
      const config = JSON.parse(content);
      assertExists(config.name);
      assertExists(config.image);
      assertExists(config.features);

      // Claude Code featureが含まれていることを確認
      const hasClaudeFeature = Object.keys(config.features).some(
        (key) => key.includes("anthropics/devcontainer-features"),
      );
      assertEquals(hasClaudeFeature, true);
    } finally {
      // クリーンアップ
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step(
    ".devcontainerディレクトリが既に存在する場合はエラー",
    async () => {
      const tempDir = await Deno.makeTempDir();

      try {
        // .devcontainerディレクトリを先に作成
        const devcontainerPath = join(tempDir, ".devcontainer");
        await Deno.mkdir(devcontainerPath);

        // fallback devcontainerをコピー（失敗するはず）
        const result = await prepareFallbackDevcontainer(tempDir);

        // エラーを確認
        assertEquals(result.isErr(), true);
        if (result.isErr()) {
          assertEquals(result.error.type, "FILE_READ_ERROR");
          if (result.error.type === "FILE_READ_ERROR") {
            assertEquals(
              result.error.error,
              ".devcontainerディレクトリが既に存在します",
            );
          }
        }
      } finally {
        // クリーンアップ
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  );

  await t.step("fallback_devcontainerディレクトリの存在を確認", async () => {
    // fallback_devcontainerディレクトリが存在することを確認
    const currentDir = new URL(".", import.meta.url).pathname;
    const fallbackDir = join(currentDir, "..", "fallback_devcontainer");
    const fallbackDevcontainerDir = join(fallbackDir, ".devcontainer");

    const stat = await Deno.stat(fallbackDevcontainerDir);
    assertEquals(stat.isDirectory, true);

    // devcontainer.jsonが存在することを確認
    const devcontainerJsonPath = join(
      fallbackDevcontainerDir,
      "devcontainer.json",
    );
    const jsonStat = await Deno.stat(devcontainerJsonPath);
    assertEquals(jsonStat.isFile, true);
  });
});
