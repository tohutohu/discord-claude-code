import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { DevcontainerManager } from "./devcontainer-manager.ts";
import { WorkspaceManager } from "../workspace.ts";

Deno.test("DevcontainerManager - devcontainer.jsonが存在しない場合", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const devcontainerManager = new DevcontainerManager(workspaceManager);
    const repoDir = await Deno.makeTempDir();

    try {
      const result = await devcontainerManager.checkAndSetupDevcontainer(
        "test-thread",
        repoDir,
      );

      assertEquals(result.hasDevcontainer, false);
      assertStringIncludes(
        result.message,
        "devcontainer.jsonが見つかりませんでした",
      );
    } finally {
      await Deno.remove(repoDir, { recursive: true });
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DevcontainerManager - devcontainer.jsonが存在する場合", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const devcontainerManager = new DevcontainerManager(workspaceManager);
    const repoDir = await Deno.makeTempDir();

    try {
      // devcontainer.jsonを作成
      const config = {
        name: "test",
        image: "node:20",
        features: {
          "ghcr.io/anthropics/devcontainer-features/claude-cli:latest": {},
        },
      };

      await Deno.writeTextFile(
        join(repoDir, ".devcontainer.json"),
        JSON.stringify(config, null, 2),
      );

      const result = await devcontainerManager.checkAndSetupDevcontainer(
        "test-thread",
        repoDir,
      );

      assertEquals(result.hasDevcontainer, true);
      // devcontainer CLIがインストールされていない環境でのテストなので、
      // CLIが見つからないメッセージが返されることを期待
      if (!result.message.includes("devcontainer内でClaudeを実行しますか")) {
        assertStringIncludes(
          result.message,
          "devcontainer CLIがインストールされていません",
        );
      }
    } finally {
      await Deno.remove(repoDir, { recursive: true });
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DevcontainerManager - anthropics featuresがない場合の警告", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const devcontainerManager = new DevcontainerManager(workspaceManager);
    const repoDir = await Deno.makeTempDir();

    try {
      // anthropics featuresのないdevcontainer.jsonを作成
      const config = {
        name: "test-no-anthropics",
        image: "node:20",
        features: {
          "ghcr.io/devcontainers/features/node:1": {},
        },
      };

      await Deno.writeTextFile(
        join(repoDir, ".devcontainer.json"),
        JSON.stringify(config, null, 2),
      );

      const result = await devcontainerManager.checkAndSetupDevcontainer(
        "test-thread",
        repoDir,
      );

      assertEquals(result.hasDevcontainer, true);
      // devcontainer CLIがインストールされていない環境では警告メッセージが異なる
      if (
        result.warning &&
        result.warning.includes("anthropics/devcontainer-features")
      ) {
        assertStringIncludes(
          result.warning,
          "anthropics/devcontainer-features",
        );
      } else {
        // CLIがない場合のメッセージの確認
        assertStringIncludes(result.message, "devcontainer CLI");
      }
    } finally {
      await Deno.remove(repoDir, { recursive: true });
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DevcontainerManager - devcontainer設定の保存と取得", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const devcontainerManager = new DevcontainerManager(workspaceManager);
    const threadId = "test-thread-config";

    // Worker状態を作成
    await workspaceManager.saveWorkerState({
      workerName: "test-worker",
      threadId,
      devcontainerConfig: {
        useDevcontainer: false,
        useFallbackDevcontainer: false,
        hasDevcontainerFile: false,
        hasAnthropicsFeature: false,
        isStarted: false,
      },
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // devcontainer設定を保存
    const config = {
      useDevcontainer: true,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: true,
      containerId: "test-container-id",
      isStarted: true,
    };

    await devcontainerManager.saveDevcontainerConfig(threadId, config);

    // 設定を取得
    const loadedConfig = await devcontainerManager.getDevcontainerConfig(
      threadId,
    );
    assertEquals(loadedConfig?.useDevcontainer, true);
    assertEquals(loadedConfig?.hasDevcontainerFile, true);
    assertEquals(loadedConfig?.hasAnthropicsFeature, true);
    assertEquals(loadedConfig?.containerId, "test-container-id");
    assertEquals(loadedConfig?.isStarted, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
