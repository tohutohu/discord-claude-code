import { join } from "std/path/mod.ts";

export interface DevcontainerConfig {
  name?: string;
  image?: string;
  dockerFile?: string;
  build?: {
    dockerfile?: string;
    context?: string;
  };
  features?: Record<string, unknown>;
  customizations?: {
    vscode?: {
      extensions?: string[];
    };
  };
  postCreateCommand?: string | string[];
  postStartCommand?: string | string[];
  postAttachCommand?: string | string[];
}

export interface DevcontainerInfo {
  configExists: boolean;
  configPath?: string;
  config?: DevcontainerConfig;
  hasAnthropicsFeature?: boolean;
}

/**
 * 指定されたパスでdevcontainer.jsonの存在と設定を確認する
 */
export async function checkDevcontainerConfig(
  repositoryPath: string,
): Promise<DevcontainerInfo> {
  const possiblePaths = [
    join(repositoryPath, ".devcontainer", "devcontainer.json"),
    join(repositoryPath, ".devcontainer.json"),
  ];

  for (const configPath of possiblePaths) {
    try {
      const configContent = await Deno.readTextFile(configPath);
      const config: DevcontainerConfig = JSON.parse(configContent);

      const hasAnthropicsFeature = checkAnthropicsFeature(config);

      return {
        configExists: true,
        configPath,
        config,
        hasAnthropicsFeature,
      };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`devcontainer.json読み込みエラー (${configPath}):`, error);
      }
    }
  }

  return {
    configExists: false,
  };
}

/**
 * devcontainer設定にanthropics/devcontainer-featuresが含まれているかチェック
 */
function checkAnthropicsFeature(config: DevcontainerConfig): boolean {
  if (!config.features) {
    return false;
  }

  // anthropics/devcontainer-featuresが使用されているかチェック
  for (const featureKey of Object.keys(config.features)) {
    if (
      featureKey.startsWith("ghcr.io/anthropics/devcontainer-features/") ||
      featureKey.startsWith("anthropics/devcontainer-features/")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * devcontainer CLIが利用可能かチェック
 */
export async function checkDevcontainerCli(): Promise<boolean> {
  try {
    const command = new Deno.Command("devcontainer", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
      env: {
        ...Deno.env.toObject(),
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      },
    });

    const result = await command.output();
    return result.success;
  } catch {
    return false;
  }
}

/**
 * devcontainerを起動する
 */
export async function startDevcontainer(repositoryPath: string): Promise<{
  success: boolean;
  containerId?: string;
  error?: string;
}> {
  try {
    // devcontainer up コマンドを実行
    const command = new Deno.Command("devcontainer", {
      args: ["up", "--workspace-folder", repositoryPath],
      stdout: "piped",
      stderr: "piped",
      cwd: repositoryPath,
      env: {
        ...Deno.env.toObject(),
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      },
    });

    const result = await command.output();

    if (!result.success) {
      const error = new TextDecoder().decode(result.stderr);
      return {
        success: false,
        error: `devcontainer起動に失敗しました: ${error}`,
      };
    }

    // コンテナIDを取得（出力から抽出）
    const output = new TextDecoder().decode(result.stdout);
    const containerIdMatch = output.match(/container\s+id:\s*([a-f0-9]+)/i);
    const containerId = containerIdMatch?.[1];

    return {
      success: true,
      containerId: containerId || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: `devcontainer起動エラー: ${(error as Error).message}`,
    };
  }
}

/**
 * devcontainer内でコマンドを実行する
 */
export async function execInDevcontainer(
  repositoryPath: string,
  command: string[],
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const devcontainerCommand = new Deno.Command("devcontainer", {
    args: ["exec", "--workspace-folder", repositoryPath, ...command],
    stdout: "piped",
    stderr: "piped",
    cwd: repositoryPath,
    env: {
      ...Deno.env.toObject(),
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    },
  });

  const { code, stdout, stderr } = await devcontainerCommand.output();
  return { code, stdout, stderr };
}
