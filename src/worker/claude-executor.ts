import { ClaudeStreamProcessor } from "./claude-stream-processor.ts";
import { MessageFormatter } from "./message-formatter.ts";

export interface ClaudeCommandExecutor {
  executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }>;
}

export class DefaultClaudeCommandExecutor implements ClaudeCommandExecutor {
  private readonly verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  async executeStreaming(
    args: string[],
    cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    // VERBOSEモードでコマンド詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DefaultClaudeCommandExecutor] Claudeコマンド実行:`,
      );
      console.log(`  作業ディレクトリ: ${cwd}`);
      console.log(`  引数: ${JSON.stringify(args)}`);
    }

    const command = new Deno.Command("claude", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // ClaudeStreamProcessorのprocessStreamsメソッドを使用
    const processor = new ClaudeStreamProcessor(
      new MessageFormatter(), // formatterインスタンスを渡す
    );

    // プロセスの終了を待つ
    const [{ code }, stderrOutput] = await Promise.all([
      process.status,
      processor.processStreams(process.stdout, process.stderr, onData),
    ]);

    // VERBOSEモードで実行結果詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DefaultClaudeCommandExecutor] 実行完了:`,
      );
      console.log(`  終了コード: ${code}`);
      console.log(`  stderr長: ${stderrOutput.length}バイト`);
    }

    return { code, stderr: stderrOutput };
  }
}

export class DevcontainerClaudeExecutor implements ClaudeCommandExecutor {
  private readonly repositoryPath: string;
  private readonly verbose: boolean;
  private readonly ghToken?: string;

  constructor(
    repositoryPath: string,
    verbose = false,
    ghToken?: string,
  ) {
    this.repositoryPath = repositoryPath;
    this.verbose = verbose;
    this.ghToken = ghToken;
  }

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const argsWithDefaults = [
      "exec",
      "--workspace-folder",
      this.repositoryPath,
      "claude",
      ...args,
    ];
    // VERBOSEモードでdevcontainerコマンド詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [DevcontainerClaudeExecutor] devcontainerコマンド実行:`,
      );
      console.log(`  リポジトリパス: ${this.repositoryPath}`);
      console.log(`  引数: ${JSON.stringify(argsWithDefaults)}`);
    }

    // devcontainer内でclaudeコマンドをストリーミング実行
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    };

    // GitHub PATが提供されている場合は環境変数に設定
    if (this.ghToken) {
      env.GH_TOKEN = this.ghToken;
      env.GITHUB_TOKEN = this.ghToken; // 互換性のため両方設定
    }

    const devcontainerCommand = new Deno.Command("devcontainer", {
      args: argsWithDefaults,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      cwd: this.repositoryPath,
      env,
    });

    const process = devcontainerCommand.spawn();

    // ClaudeStreamProcessorのprocessStreamsメソッドを使用
    const processor = new ClaudeStreamProcessor(
      new MessageFormatter(), // formatterインスタンスを渡す
    );

    // プロセスの終了を待つ
    const [{ code }, stderrOutput] = await Promise.all([
      process.status,
      processor.processStreams(process.stdout, process.stderr, onData),
    ]);

    // VERBOSEモードで実行結果詳細ログ
    if (this.verbose) {
      console.log(
        `[${new Date().toISOString()}] [DevcontainerClaudeExecutor] 実行完了:`,
      );
      console.log(`  終了コード: ${code}`);
      console.log(`  stderr長: ${stderrOutput.length}バイト`);
    }

    return { code, stderr: stderrOutput };
  }
}
