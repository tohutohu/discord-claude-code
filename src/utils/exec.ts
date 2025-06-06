export interface ExecResult {
  success: boolean;
  output: string;
  error: string;
}

/**
 * コマンドを実行し、結果を返す
 */
export async function exec(command: string): Promise<ExecResult> {
  const decoder = new TextDecoder();

  try {
    const process = new Deno.Command("sh", {
      args: ["-c", command],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await process.output();

    return {
      success: code === 0,
      output: decoder.decode(stdout),
      error: decoder.decode(stderr),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: (error as Error).message,
    };
  }
}
