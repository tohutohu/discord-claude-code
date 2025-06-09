/**
 * コマンド実行結果を表すインターフェース
 *
 * @property {boolean} success - コマンドが正常終了したかどうか（終了コード0の場合true）
 * @property {string} output - 標準出力の内容（UTF-8でデコード済み）
 * @property {string} error - 標準エラー出力の内容、または実行時エラーメッセージ
 */
export interface ExecResult {
  success: boolean;
  output: string;
  error: string;
}

/**
 * シェルコマンドを実行し、その結果を返す非同期関数
 *
 * @description
 * 指定されたコマンドをシェル（sh -c）経由で実行し、標準出力・標準エラー出力・終了コードを取得します。
 * コマンドはサブシェルで実行されるため、パイプやリダイレクトなどのシェル機能が使用可能です。
 *
 * @param command - 実行するシェルコマンド文字列
 * @returns コマンド実行結果を含むオブジェクト
 *
 * @example
 * // 単純なコマンドの実行
 * const result = await exec("ls -la");
 * if (result.success) {
 *   console.log(result.output);
 * } else {
 *   console.error(result.error);
 * }
 *
 * @example
 * // パイプを使った複雑なコマンド
 * const result = await exec("cat file.txt | grep pattern | wc -l");
 * const lineCount = parseInt(result.output.trim());
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
