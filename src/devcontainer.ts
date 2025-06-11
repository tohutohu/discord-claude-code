import { join } from "std/path/mod.ts";
import { DEVCONTAINER } from "./constants.ts";

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
 * devcontainer起動用の環境変数を準備する
 */
function prepareEnvironment(ghToken?: string): Record<string, string> {
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    DOCKER_DEFAULT_PLATFORM: "linux/amd64",
  };

  // GitHub PATが提供されている場合は環境変数に設定
  if (ghToken) {
    env.GH_TOKEN = ghToken;
    env.GITHUB_TOKEN = ghToken; // 互換性のため両方設定
  }

  return env;
}

/**
 * devcontainerコマンドを作成する
 */
function createDevcontainerCommand(
  repositoryPath: string,
  env: Record<string, string>,
): Deno.Command {
  return new Deno.Command("devcontainer", {
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
}

/**
 * 進捗タイマーを設定する
 */
function setupProgressTimer(
  logBuffer: string[],
  maxLogLines: number,
  onProgress?: (message: string) => Promise<void>,
): number {
  const progressUpdateInterval = DEVCONTAINER.PROGRESS_UPDATE_INTERVAL_MS;
  return setInterval(async () => {
    if (onProgress && logBuffer.length > 0) {
      const recentLogs = logBuffer.slice(-maxLogLines);
      const logMessage = "🐳 起動中...\n```\n" + recentLogs.join("\n") +
        "\n```";
      await onProgress(logMessage).catch(console.error);
    }
  }, progressUpdateInterval);
}

/**
 * JSONログからメッセージを抽出する
 */
function extractLogMessage(logEntry: Record<string, unknown>): {
  message: string;
  timestamp: string;
} {
  const message = String(
    logEntry.message || logEntry.msg || JSON.stringify(logEntry),
  );
  const timestamp = String(logEntry.timestamp || logEntry.time || "");
  return { message, timestamp };
}

/**
 * 進捗メッセージのアイコンを決定する
 */
function getProgressIcon(message: string): string {
  const lowercaseMessage = message.toLowerCase();
  if (
    lowercaseMessage.includes("pulling") ||
    lowercaseMessage.includes("downloading")
  ) {
    return "⬇️";
  } else if (lowercaseMessage.includes("extracting")) {
    return "📦";
  } else if (lowercaseMessage.includes("building")) {
    return "🔨";
  } else if (
    lowercaseMessage.includes("creating") ||
    lowercaseMessage.includes("starting")
  ) {
    return "🚀";
  } else if (
    lowercaseMessage.includes("complete") ||
    lowercaseMessage.includes("success")
  ) {
    return "✅";
  }
  return "🐳";
}

/**
 * 重要なイベントかどうかを判定する
 */
function isImportantEvent(message: string): boolean {
  const lowercaseMessage = message.toLowerCase();
  const keywords = [
    "pulling",
    "downloading",
    "extracting",
    "building",
    "creating",
    "starting",
    "running",
    "container",
    "image",
    "layer",
    "waiting",
    "complete",
    "success",
  ];
  return keywords.some((keyword) => lowercaseMessage.includes(keyword));
}

/**
 * stdout行を処理する
 */
async function processStdoutLine(
  line: string,
  logBuffer: string[],
  maxLogLines: number,
  lastProgressUpdate: { time: number },
  onProgress?: (message: string) => Promise<void>,
): Promise<void> {
  try {
    const logEntry = JSON.parse(line);
    const { message, timestamp } = extractLogMessage(logEntry);

    // 読みやすい形式でバッファに追加
    const formattedLog = timestamp ? `[${timestamp}] ${message}` : message;
    logBuffer.push(formattedLog);

    // バッファサイズを制限
    if (logBuffer.length > maxLogLines * 2) {
      logBuffer.splice(0, logBuffer.length - maxLogLines);
    }

    // 重要なイベントは即座に通知
    if (isImportantEvent(message)) {
      const now = Date.now();
      if (
        now - lastProgressUpdate.time > DEVCONTAINER.PROGRESS_NOTIFY_INTERVAL_MS
      ) { // 1秒以上経過していれば更新
        lastProgressUpdate.time = now;
        if (onProgress) {
          const icon = getProgressIcon(message);
          await onProgress(`${icon} ${message}`).catch(console.error);
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

/**
 * ストリーム出力を処理する
 */
async function processStreamOutput(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  logBuffer: string[],
  maxLogLines: number,
  lastProgressUpdate: { time: number },
  onProgress?: (message: string) => Promise<void>,
): Promise<string> {
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        output += chunk;

        // JSON形式のログをパースして処理
        const lines = chunk.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          await processStdoutLine(
            line,
            logBuffer,
            maxLogLines,
            lastProgressUpdate,
            onProgress,
          );
        }
      }
    }
  } catch (error) {
    console.error("stdout読み取りエラー:", error);
  } finally {
    reader.releaseLock();
  }
  return output;
}

/**
 * stderrストリームを読み取る
 */
async function readStderrStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): Promise<string> {
  let errorOutput = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        errorOutput += chunk;
      }
    }
  } catch (error) {
    console.error("stderr読み取りエラー:", error);
  } finally {
    reader.releaseLock();
  }
  return errorOutput;
}

/**
 * コンテナIDを抽出する
 */
function extractContainerId(output: string): string | undefined {
  const containerIdMatch = output.match(/container\s+id:\s*([a-f0-9]+)/i);
  return containerIdMatch?.[1];
}

/**
 * 最終メッセージをフォーマットする
 */
function formatFinalMessage(
  logBuffer: string[],
  containerId?: string,
): string {
  const finalLogs = logBuffer.slice(-10).join("\n");
  return `✅ devcontainerが正常に起動しました\n\n**最終ログ:**\n\`\`\`\n${finalLogs}\n\`\`\`${
    containerId ? `\n🆔 コンテナID: ${containerId}` : ""
  }`;
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

    const env = prepareEnvironment(ghToken);
    const command = createDevcontainerCommand(repositoryPath, env);
    const process = command.spawn();

    const decoder = new TextDecoder();
    const logBuffer: string[] = [];
    const maxLogLines = DEVCONTAINER.MAX_LOG_LINES;
    const lastProgressUpdate = { time: Date.now() };

    // stdoutとstderrをストリーミングで読み取る
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    // 定期的なログ更新タイマー
    const progressTimer = setupProgressTimer(
      logBuffer,
      maxLogLines,
      onProgress,
    );

    // ストリーム読み取りを並列実行
    const [{ code }, output, errorOutput] = await Promise.all([
      process.status,
      processStreamOutput(
        stdoutReader,
        decoder,
        logBuffer,
        maxLogLines,
        lastProgressUpdate,
        onProgress,
      ),
      readStderrStream(stderrReader, decoder),
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

    // コンテナIDを取得
    const containerId = extractContainerId(output);

    // 最終的なログサマリーを送信
    if (onProgress) {
      await onProgress(formatFinalMessage(logBuffer, containerId));
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

/**
 * fallback devcontainerをコピーして準備する
 */
export async function prepareFallbackDevcontainer(
  repositoryPath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // fallback_devcontainerディレクトリのパスを取得
    const currentDir = new URL(".", import.meta.url).pathname;
    const fallbackDir = join(currentDir, "..", "fallback_devcontainer");

    // .devcontainerディレクトリをリポジトリにコピー
    const targetDevcontainerDir = join(repositoryPath, ".devcontainer");

    // ターゲットディレクトリが既に存在する場合はエラー
    try {
      await Deno.stat(targetDevcontainerDir);
      return {
        success: false,
        error: ".devcontainerディレクトリが既に存在します",
      };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    // fallback devcontainerをコピー
    const command = new Deno.Command("cp", {
      args: ["-r", join(fallbackDir, ".devcontainer"), repositoryPath],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stderr } = await command.output();

    if (code !== 0) {
      const errorMsg = new TextDecoder().decode(stderr);
      return {
        success: false,
        error: `fallback devcontainerのコピーに失敗しました: ${errorMsg}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `fallback devcontainer準備エラー: ${(error as Error).message}`,
    };
  }
}

/**
 * fallback devcontainerを起動する
 */
export async function startFallbackDevcontainer(
  repositoryPath: string,
  onProgress?: (message: string) => Promise<void>,
  ghToken?: string,
): Promise<{
  success: boolean;
  containerId?: string;
  error?: string;
}> {
  if (onProgress) {
    await onProgress("📦 fallback devcontainerを準備しています...");
  }

  // fallback devcontainerをコピー
  const prepareResult = await prepareFallbackDevcontainer(repositoryPath);
  if (!prepareResult.success) {
    return {
      success: false,
      error: prepareResult.error,
    };
  }

  if (onProgress) {
    await onProgress("✅ fallback devcontainerの準備が完了しました");
    await onProgress("🐳 devcontainerを起動しています...");
  }

  // 通常のdevcontainer起動処理を実行
  return await startDevcontainer(repositoryPath, onProgress, ghToken);
}
