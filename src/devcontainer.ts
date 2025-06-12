import { join } from "std/path/mod.ts";
import { DEVCONTAINER } from "./constants.ts";
import {
  DevcontainerConfig,
  DevcontainerLog,
  validateDevcontainerConfig,
  validateDevcontainerLog,
} from "./schemas/external-api-schema.ts";
import { err, ok, Result } from "neverthrow";
import { exec } from "./utils/exec.ts";

// エラー型定義
export type DevcontainerError =
  | { type: "CONFIG_NOT_FOUND"; path: string }
  | { type: "CLI_NOT_AVAILABLE"; message: string }
  | { type: "CONTAINER_START_FAILED"; error: string }
  | { type: "COMMAND_EXECUTION_FAILED"; command: string; error: string }
  | { type: "JSON_PARSE_ERROR"; path: string; error: string }
  | { type: "FILE_READ_ERROR"; path: string; error: string };

// DevcontainerConfigはexternal-api-schemaからインポートして使用

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
): Promise<Result<DevcontainerInfo, DevcontainerError>> {
  const possiblePaths = [
    join(repositoryPath, ".devcontainer", "devcontainer.json"),
    join(repositoryPath, ".devcontainer.json"),
  ];

  for (const configPath of possiblePaths) {
    try {
      const configContent = await Deno.readTextFile(configPath);
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(configContent);
      } catch (parseError) {
        return err({
          type: "JSON_PARSE_ERROR",
          path: configPath,
          error: (parseError as Error).message,
        });
      }

      const config = validateDevcontainerConfig(parsedConfig);

      if (!config) {
        console.warn(`devcontainer.json形式が無効です (${configPath})`);
        continue;
      }

      const hasAnthropicsFeature = checkAnthropicsFeature(config);

      return ok({
        configExists: true,
        configPath,
        config,
        hasAnthropicsFeature,
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        if (error instanceof Error) {
          return err({
            type: "FILE_READ_ERROR",
            path: configPath,
            error: error.message,
          });
        }
      }
    }
  }

  return ok({
    configExists: false,
  });
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
export async function checkDevcontainerCli(): Promise<
  Result<boolean, DevcontainerError>
> {
  const result = await exec(
    "DOCKER_DEFAULT_PLATFORM=linux/amd64 devcontainer --version",
  );
  if (result.isErr()) {
    return err({
      type: "CLI_NOT_AVAILABLE",
      message: `devcontainer CLIが利用できません: ${result.error.message}`,
    });
  }
  return ok(true);
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
function extractLogMessage(
  logEntry: DevcontainerLog | Record<string, unknown>,
): {
  message: string;
  timestamp: string;
} {
  // DevcontainerLogの場合はmessageとtimestampを使用
  if ("message" in logEntry || "timestamp" in logEntry) {
    const message = String(logEntry.message || JSON.stringify(logEntry));
    const timestamp = String(logEntry.timestamp || "");
    return { message, timestamp };
  }

  // その他のログ形式の場合
  const record = logEntry as Record<string, unknown>;
  const message = String(
    record.message || record.msg || JSON.stringify(logEntry),
  );
  const timestamp = String(record.timestamp || record.time || "");
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
    const parsedLog = JSON.parse(line);
    const validatedLog = validateDevcontainerLog(parsedLog);
    // バリデーションに失敗しても処理を継続（後方互換性のため）
    const logEntry = validatedLog || parsedLog;
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
): Promise<Result<{ containerId?: string }, DevcontainerError>> {
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
      return err({
        type: "CONTAINER_START_FAILED",
        error: `devcontainer起動に失敗しました: ${errorOutput}`,
      });
    }

    // コンテナIDを取得
    const containerId = extractContainerId(output);

    // 最終的なログサマリーを送信
    if (onProgress) {
      await onProgress(formatFinalMessage(logBuffer, containerId));
    }

    return ok({
      containerId: containerId || undefined,
    });
  } catch (error) {
    return err({
      type: "CONTAINER_START_FAILED",
      error: `devcontainer起動エラー: ${(error as Error).message}`,
    });
  }
}

/**
 * devcontainer内でコマンドを実行する
 */
export async function execInDevcontainer(
  repositoryPath: string,
  command: string[],
  ghToken?: string,
): Promise<Result<{ stdout: string; stderr: string }, DevcontainerError>> {
  // 環境変数を準備
  const envVars = ["DOCKER_DEFAULT_PLATFORM=linux/amd64"];
  if (ghToken) {
    envVars.push(`GH_TOKEN=${ghToken}`);
    envVars.push(`GITHUB_TOKEN=${ghToken}`);
  }

  // devcontainer execコマンドを構築
  const devcontainerArgs = [
    "exec",
    "--workspace-folder",
    repositoryPath,
    ...command,
  ];
  const fullCommand = `cd "${repositoryPath}" && ${
    envVars.join(" ")
  } devcontainer ${devcontainerArgs.map((arg) => `"${arg}"`).join(" ")}`;

  const result = await exec(fullCommand);
  if (result.isErr()) {
    const error = result.error;
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: command.join(" "),
      error: error.error || error.message,
    });
  }

  return ok({
    stdout: result.value.output,
    stderr: result.value.error,
  });
}

/**
 * fallback devcontainerをコピーして準備する
 */
export async function prepareFallbackDevcontainer(
  repositoryPath: string,
): Promise<Result<void, DevcontainerError>> {
  try {
    // fallback_devcontainerディレクトリのパスを取得
    const currentDir = new URL(".", import.meta.url).pathname;
    const fallbackDir = join(currentDir, "..", "fallback_devcontainer");

    // .devcontainerディレクトリをリポジトリにコピー
    const targetDevcontainerDir = join(repositoryPath, ".devcontainer");

    // ターゲットディレクトリが既に存在する場合はエラー
    try {
      await Deno.stat(targetDevcontainerDir);
      return err({
        type: "FILE_READ_ERROR",
        path: targetDevcontainerDir,
        error: ".devcontainerディレクトリが既に存在します",
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        return err({
          type: "FILE_READ_ERROR",
          path: targetDevcontainerDir,
          error: (error as Error).message,
        });
      }
    }

    // fallback devcontainerをコピー
    const copyResult = await exec(
      `cp -r "${join(fallbackDir, ".devcontainer")}" "${repositoryPath}"`,
    );
    if (copyResult.isErr()) {
      const error = copyResult.error;
      return err({
        type: "COMMAND_EXECUTION_FAILED",
        command: "cp",
        error: `fallback devcontainerのコピーに失敗しました: ${
          error.error || error.message
        }`,
      });
    }

    return ok(undefined);
  } catch (error) {
    return err({
      type: "COMMAND_EXECUTION_FAILED",
      command: "prepareFallbackDevcontainer",
      error: `fallback devcontainer準備エラー: ${(error as Error).message}`,
    });
  }
}

/**
 * fallback devcontainerを起動する
 */
export async function startFallbackDevcontainer(
  repositoryPath: string,
  onProgress?: (message: string) => Promise<void>,
  ghToken?: string,
): Promise<Result<{ containerId?: string }, DevcontainerError>> {
  if (onProgress) {
    await onProgress("📦 fallback devcontainerを準備しています...");
  }

  // fallback devcontainerをコピー
  const prepareResult = await prepareFallbackDevcontainer(repositoryPath);
  if (prepareResult.isErr()) {
    return err(prepareResult.error);
  }

  if (onProgress) {
    await onProgress("✅ fallback devcontainerの準備が完了しました");
    await onProgress("🐳 devcontainerを起動しています...");
  }

  // 通常のdevcontainer起動処理を実行
  return await startDevcontainer(repositoryPath, onProgress, ghToken);
}
