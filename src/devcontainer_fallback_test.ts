import { assertEquals } from "std/assert/mod.ts";
import { basename, dirname, fromFileUrl, join } from "std/path/mod.ts";
import { getDevcontainerConfigPath } from "./devcontainer.ts";

Deno.test("devcontainer設定パス決定機能", async (t) => {
  await t.step(
    "リポジトリにdevcontainer.jsonがない場合はfallbackを返す",
    async () => {
      const tempDir = await Deno.makeTempDir();

      try {
        // devcontainer.jsonが存在しないリポジトリ
        const result = await getDevcontainerConfigPath(tempDir);

        // 成功を確認
        assertEquals(result.isOk(), true);
        if (result.isOk()) {
          // fallback devcontainer.jsonのパスが返されることを確認
          const filename = basename(result.value);
          const parentDir = basename(dirname(result.value));
          const grandParentDir = basename(dirname(dirname(result.value)));

          assertEquals(filename, "devcontainer.json");
          assertEquals(parentDir, ".devcontainer");
          assertEquals(grandParentDir, "fallback_devcontainer");
        }
      } finally {
        // クリーンアップ
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  );

  await t.step(
    "リポジトリにdevcontainer.jsonがある場合はそのパスを返す",
    async () => {
      const tempDir = await Deno.makeTempDir();

      try {
        // .devcontainerディレクトリとdevcontainer.jsonを作成
        const devcontainerPath = join(tempDir, ".devcontainer");
        await Deno.mkdir(devcontainerPath);
        const devcontainerJsonPath = join(
          devcontainerPath,
          "devcontainer.json",
        );
        await Deno.writeTextFile(
          devcontainerJsonPath,
          JSON.stringify({
            name: "Test Container",
            image: "mcr.microsoft.com/devcontainers/base:debian",
          }),
        );

        // getDevcontainerConfigPathを呼び出し
        const result = await getDevcontainerConfigPath(tempDir);

        // 成功を確認
        assertEquals(result.isOk(), true);
        if (result.isOk()) {
          // リポジトリ内のdevcontainer.jsonのパスが返されることを確認
          assertEquals(result.value, devcontainerJsonPath);
        }
      } finally {
        // クリーンアップ
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  );

  await t.step("fallback_devcontainerディレクトリの存在を確認", async () => {
    // fallback_devcontainerディレクトリが存在することを確認
    const currentDir = fromFileUrl(new URL(".", import.meta.url));
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
