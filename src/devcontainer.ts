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
export async function startDevcontainer(
  repositoryPath: string,
  onProgress?: (message: string) => Promise<void>,
  ghToken?: string,
): Promise<{
  success: boolean;
  containerId?: string;
  error?: string;
}> {
  try {
    if (onProgress) {
      await onProgress("🐳 Dockerコンテナを準備しています...");
      await onProgress(`📁 作業ディレクトリ: ${repositoryPath}`);
    }

    // devcontainer up コマンドを実行（デバッグログとJSON形式で出力）
    if (onProgress) {
      await onProgress("🔧 devcontainer upコマンドを実行中...");
    }

    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    };

    // GitHub PATが提供されている場合は環境変数に設定
    if (ghToken) {
      env.GH_TOKEN = ghToken;
      env.GITHUB_TOKEN = ghToken; // 互換性のため両方設定
    }

    const command = new Deno.Command("devcontainer", {
      args: [
        "up",
        "--workspace-folder",
        repositoryPath,
        "--log-level",
        "debug",
        "--log-format",
        "json",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: repositoryPath,
      env,
    });

    const process = command.spawn();
    const decoder = new TextDecoder();
    let output = "";
    let errorOutput = "";
    const logBuffer: string[] = [];
    const maxLogLines = 30;
    let lastProgressUpdate = Date.now();
    const progressUpdateInterval = 2000; // 2秒

    // stdoutとstderrをストリーミングで読み取る
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    // 定期的なログ更新タイマー
    const progressTimer = setInterval(async () => {
      if (onProgress && logBuffer.length > 0) {
        const recentLogs = logBuffer.slice(-maxLogLines);
        const logMessage = "🐳 起動中...\n```\n" + recentLogs.join("\n") +
          "\n```";
        await onProgress(logMessage).catch(console.error);
      }
    }, progressUpdateInterval);

    // stdoutの読み取り
    const stdoutPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            output += chunk;

            // JSON形式のログをパースして処理
            const lines = chunk.split("\n").filter((line) => line.trim());
            for (const line of lines) {
              try {
                const logEntry = JSON.parse(line);
                // ログエントリから意味のあるメッセージを抽出
                const message = logEntry.message || logEntry.msg || line;
                const timestamp = logEntry.timestamp || logEntry.time || "";

                // 読みやすい形式でバッファに追加
                const formattedLog = timestamp
                  ? `[${timestamp}] ${message}`
                  : message;
                logBuffer.push(formattedLog);

                // バッファサイズを制限
                if (logBuffer.length > maxLogLines * 2) {
                  logBuffer.splice(0, logBuffer.length - maxLogLines);
                }

                // 重要なイベントは即座に通知
                const lowercaseMessage = message.toLowerCase();
                if (
                  lowercaseMessage.includes("pulling") ||
                  lowercaseMessage.includes("downloading") ||
                  lowercaseMessage.includes("extracting") ||
                  lowercaseMessage.includes("building") ||
                  lowercaseMessage.includes("creating") ||
                  lowercaseMessage.includes("starting") ||
                  lowercaseMessage.includes("running") ||
                  lowercaseMessage.includes("container") ||
                  lowercaseMessage.includes("image") ||
                  lowercaseMessage.includes("layer") ||
                  lowercaseMessage.includes("waiting") ||
                  lowercaseMessage.includes("complete") ||
                  lowercaseMessage.includes("success")
                ) {
                  const now = Date.now();
                  if (now - lastProgressUpdate > 1000) { // 1秒以上経過していれば更新
                    lastProgressUpdate = now;
                    if (onProgress) {
                      // 特定のイベントにアイコンを付与
                      let icon = "🐳";
                      if (
                        lowercaseMessage.includes("pulling") ||
                        lowercaseMessage.includes("downloading")
                      ) {
                        icon = "⬇️";
                      } else if (lowercaseMessage.includes("extracting")) {
                        icon = "📦";
                      } else if (lowercaseMessage.includes("building")) {
                        icon = "🔨";
                      } else if (
                        lowercaseMessage.includes("creating") ||
                        lowercaseMessage.includes("starting")
                      ) {
                        icon = "🚀";
                      } else if (
                        lowercaseMessage.includes("complete") ||
                        lowercaseMessage.includes("success")
                      ) {
                        icon = "✅";
                      }
                      await onProgress(`${icon} ${message}`).catch(
                        console.error,
                      );
                    }
                  }
                }
              } catch {
                // JSON以外の行はそのまま追加
                logBuffer.push(line);
                if (logBuffer.length > maxLogLines * 2) {
                  logBuffer.splice(0, logBuffer.length - maxLogLines);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("stdout読み取りエラー:", error);
      } finally {
        stdoutReader.releaseLock();
      }
    })();

    // stderrの読み取り
    const stderrPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            errorOutput += chunk;
          }
        }
      } catch (error) {
        console.error("stderr読み取りエラー:", error);
      } finally {
        stderrReader.releaseLock();
      }
    })();

    // プロセスの終了とストリーミング読み取りの完了を待つ
    const [{ code }] = await Promise.all([
      process.status,
      stdoutPromise,
      stderrPromise,
    ]);

    // タイマーをクリア
    clearInterval(progressTimer);

    if (code !== 0) {
      if (onProgress) {
        await onProgress(
          `❌ devcontainer起動失敗\n\`\`\`\n${errorOutput}\n\`\`\``,
        );
      }
      return {
        success: false,
        error: `devcontainer起動に失敗しました: ${errorOutput}`,
      };
    }

    // コンテナIDを取得（出力から抽出）
    const containerIdMatch = output.match(/container\s+id:\s*([a-f0-9]+)/i);
    const containerId = containerIdMatch?.[1];

    // 最終的なログサマリーを送信
    if (onProgress) {
      const finalLogs = logBuffer.slice(-10).join("\n");
      await onProgress(
        `✅ devcontainerが正常に起動しました\n\n**最終ログ:**\n\`\`\`\n${finalLogs}\n\`\`\`${
          containerId ? `\n🆔 コンテナID: ${containerId}` : ""
        }`,
      );
    }

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
  ghToken?: string,
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    DOCKER_DEFAULT_PLATFORM: "linux/amd64",
  };

  // GitHub PATが提供されている場合は環境変数に設定
  if (ghToken) {
    env.GH_TOKEN = ghToken;
    env.GITHUB_TOKEN = ghToken; // 互換性のため両方設定
  }

  const devcontainerCommand = new Deno.Command("devcontainer", {
    args: ["exec", "--workspace-folder", repositoryPath, ...command],
    stdout: "piped",
    stderr: "piped",
    cwd: repositoryPath,
    env,
  });

  const { code, stdout, stderr } = await devcontainerCommand.output();
  return { code, stdout, stderr };
}
