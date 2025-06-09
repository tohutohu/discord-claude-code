import { join } from "std/path/mod.ts";

/**
 * Dev Container設定ファイル（devcontainer.json）の構造を表すインターフェース
 *
 * @description
 * Dev Containerの設定を定義するための標準的な構造体。
 * コンテナイメージ、ビルド設定、機能拡張、カスタマイゼーション、
 * ライフサイクルコマンドなどを含む。
 *
 * @see https://containers.dev/implementors/json_reference/
 */
export interface DevcontainerConfig {
  /** Dev Containerの表示名 */
  name?: string;
  /** 使用するDockerイメージ名 */
  image?: string;
  /** Dockerfileのパス（非推奨、buildを使用） */
  dockerFile?: string;
  /** ビルド設定 */
  build?: {
    /** Dockerfileのパス */
    dockerfile?: string;
    /** ビルドコンテキストのパス */
    context?: string;
  };
  /** Dev Container Featuresの設定（キー: Feature ID、値: Feature設定） */
  features?: Record<string, unknown>;
  /** 各種ツールのカスタマイゼーション設定 */
  customizations?: {
    /** VS Code固有の設定 */
    vscode?: {
      /** インストールする拡張機能のID一覧 */
      extensions?: string[];
    };
  };
  /** コンテナ作成後に実行するコマンド */
  postCreateCommand?: string | string[];
  /** コンテナ開始後に実行するコマンド */
  postStartCommand?: string | string[];
  /** コンテナにアタッチ後に実行するコマンド */
  postAttachCommand?: string | string[];
}

/**
 * Dev Container設定の確認結果を表すインターフェース
 *
 * @description
 * リポジトリ内のdevcontainer.json設定の存在有無、パス、内容、
 * およびAnthropics Dev Container Featureの使用状況を含む情報を提供する。
 */
export interface DevcontainerInfo {
  /** devcontainer.jsonファイルが存在するかどうか */
  configExists: boolean;
  /** devcontainer.jsonファイルのフルパス（存在する場合） */
  configPath?: string;
  /** パースされたDev Container設定（存在する場合） */
  config?: DevcontainerConfig;
  /** Anthropics Dev Container Featureが含まれているかどうか */
  hasAnthropicsFeature?: boolean;
}

/**
 * 指定されたリポジトリパスでdevcontainer.jsonの存在と設定を確認する
 *
 * @description
 * リポジトリ内の標準的な場所（.devcontainer/devcontainer.jsonまたは
 * .devcontainer.json）でDev Container設定ファイルを検索し、
 * 存在する場合はその内容をパースして返す。
 * また、Anthropics Dev Container Featureの使用有無も確認する。
 *
 * @param repositoryPath - チェック対象のリポジトリのルートパス
 * @returns Dev Container設定の確認結果を含む情報
 *
 * @example
 * ```typescript
 * const info = await checkDevcontainerConfig("/path/to/repo");
 * if (info.configExists) {
 *   console.log(`設定ファイル: ${info.configPath}`);
 *   console.log(`Anthropics Feature: ${info.hasAnthropicsFeature}`);
 * }
 * ```
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
 * Dev Container設定にAnthropics Dev Container Featureが含まれているかチェックする
 *
 * @description
 * 設定のfeaturesセクションを検査し、Anthropics公式のDev Container Feature
 * （ghcr.io/anthropics/devcontainer-features/またはanthropics/devcontainer-features/）
 * が使用されているかを判定する。
 *
 * @param config - チェック対象のDev Container設定
 * @returns Anthropics Featureが含まれている場合true、それ以外はfalse
 *
 * @example
 * ```typescript
 * const config = {
 *   features: {
 *     "ghcr.io/anthropics/devcontainer-features/claude": {}
 *   }
 * };
 * const hasFeature = checkAnthropicsFeature(config); // true
 * ```
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
 * システムにDev Container CLIがインストールされており利用可能かチェックする
 *
 * @description
 * `devcontainer --version`コマンドを実行して、Dev Container CLIが
 * システムにインストールされており、正常に動作するかを確認する。
 * Docker Platformはlinux/amd64に固定される。
 *
 * @returns CLIが利用可能な場合true、それ以外はfalse
 *
 * @example
 * ```typescript
 * const isAvailable = await checkDevcontainerCli();
 * if (!isAvailable) {
 *   console.log("Dev Container CLIをインストールしてください");
 *   console.log("npm install -g @devcontainers/cli");
 * }
 * ```
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
 * 指定されたリポジトリのDev Containerを起動する
 *
 * @description
 * `devcontainer up`コマンドを実行して、リポジトリのDev Container設定に基づいて
 * Dockerコンテナを起動する。起動プロセスの進捗はonProgressコールバックで
 * リアルタイムに通知される。JSONログフォーマットを使用して詳細な
 * デバッグ情報を取得し、重要なイベント（イメージのダウンロード、ビルド、
 * コンテナの作成など）を適切なアイコン付きで通知する。
 *
 * @param repositoryPath - Dev Containerを起動するリポジトリのパス
 * @param onProgress - 起動プロセスの進捗を通知するコールバック関数（オプション）
 * @param ghToken - GitHub Personal Access Token（プライベートリポジトリやFeatureアクセス用、オプション）
 * @returns 起動結果（成功/失敗、コンテナID、エラー情報）
 *
 * @example
 * ```typescript
 * const result = await startDevcontainer(
 *   "/path/to/repo",
 *   async (message) => console.log(message),
 *   "ghp_xxxx"
 * );
 * if (result.success) {
 *   console.log(`コンテナ起動成功: ${result.containerId}`);
 * } else {
 *   console.error(`起動失敗: ${result.error}`);
 * }
 * ```
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
 * 起動済みのDev Container内でコマンドを実行する
 *
 * @description
 * `devcontainer exec`コマンドを使用して、既に起動されているDev Container内で
 * 任意のコマンドを実行する。コマンドの標準出力と標準エラー出力を
 * キャプチャして返す。GitHub PATが提供されている場合は、
 * コンテナ内でもGitHub認証が利用可能になる。
 *
 * @param repositoryPath - Dev Containerが起動されているリポジトリのパス
 * @param command - 実行するコマンドとその引数の配列
 * @param ghToken - GitHub Personal Access Token（コンテナ内でのGitHub認証用、オプション）
 * @returns コマンドの実行結果（終了コード、標準出力、標準エラー出力）
 *
 * @example
 * ```typescript
 * // Dev Container内でnpm installを実行
 * const result = await execInDevcontainer(
 *   "/path/to/repo",
 *   ["npm", "install"],
 *   "ghp_xxxx"
 * );
 * if (result.code === 0) {
 *   console.log("インストール成功");
 * } else {
 *   console.error("エラー:", new TextDecoder().decode(result.stderr));
 * }
 * ```
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
 * フォールバックDev Container設定をリポジトリにコピーして準備する
 *
 * @description
 * リポジトリにDev Container設定が存在しない場合に使用する、
 * 事前定義されたフォールバック設定（fallback_devcontainerディレクトリ）を
 * リポジトリの.devcontainerディレクトリにコピーする。
 * 既に.devcontainerディレクトリが存在する場合はエラーを返す。
 *
 * @param repositoryPath - フォールバック設定をコピーする対象のリポジトリパス
 * @returns 準備の成功/失敗とエラー情報
 *
 * @example
 * ```typescript
 * const result = await prepareFallbackDevcontainer("/path/to/repo");
 * if (result.success) {
 *   console.log("フォールバック設定の準備完了");
 * } else {
 *   console.error(`準備失敗: ${result.error}`);
 * }
 * ```
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
 * フォールバックDev Container設定を使用してコンテナを起動する
 *
 * @description
 * リポジトリにDev Container設定が存在しない場合に、事前定義された
 * フォールバック設定をコピーしてからDev Containerを起動する。
 * この関数は、prepareFallbackDevcontainer()とstartDevcontainer()を
 * 順次実行するラッパー関数として機能する。
 *
 * @param repositoryPath - Dev Containerを起動するリポジトリのパス
 * @param onProgress - 起動プロセスの進捗を通知するコールバック関数（オプション）
 * @param ghToken - GitHub Personal Access Token（プライベートリポジトリやFeatureアクセス用、オプション）
 * @returns 起動結果（成功/失敗、コンテナID、エラー情報）
 *
 * @example
 * ```typescript
 * const result = await startFallbackDevcontainer(
 *   "/path/to/repo",
 *   async (message) => console.log(message),
 *   "ghp_xxxx"
 * );
 * if (result.success) {
 *   console.log("フォールバックコンテナ起動成功");
 * }
 * ```
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
