import { err, ok, Result } from "neverthrow";

/**
 * コマンド実行成功時の結果
 */
export interface ExecSuccess {
  output: string;
  error: string;
}

/**
 * コマンド実行エラー
 */
export interface ExecError {
  type: "COMMAND_FAILED" | "EXECUTION_ERROR";
  message: string;
  output?: string;
  error?: string;
}

/**
 * コマンドを実行し、結果を返す
 */
export async function exec(
  command: string,
): Promise<Result<ExecSuccess, ExecError>> {
  const decoder = new TextDecoder();

  try {
    const process = new Deno.Command("sh", {
      args: ["-c", command],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await process.output();
    const output = decoder.decode(stdout);
    const error = decoder.decode(stderr);

    if (code === 0) {
      return ok({ output, error });
    } else {
      return err({
        type: "COMMAND_FAILED",
        message: `Command exited with code ${code}`,
        output,
        error,
      });
    }
  } catch (error) {
    return err({
      type: "EXECUTION_ERROR",
      message: (error as Error).message,
    });
  }
}
