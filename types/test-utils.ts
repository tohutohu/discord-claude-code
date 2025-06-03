/**
 * テストユーティリティ
 */

/**
 * 標準出力をキャプチャする
 */
export function captureOutput() {
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  const errorOutput: string[] = [];

  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };

  console.error = (...args: unknown[]) => {
    errorOutput.push(args.map(String).join(' '));
  };

  return {
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
    getOutput: () => output.join('\n'),
    getErrorOutput: () => errorOutput.join('\n'),
  };
}

/**
 * Deno.exitのモック
 */
export function mockExit() {
  const originalExit = Deno.exit;
  let exitCode: number | undefined;
  let exitCalled = false;

  Deno.exit = (code?: number) => {
    exitCode = code;
    exitCalled = true;
    throw new Error(`Exit called with code: ${code}`);
  };

  return {
    restore: () => {
      Deno.exit = originalExit;
    },
    getExitCode: () => exitCode,
    wasCalled: () => exitCalled,
  };
}

/**
 * 一時ファイルのヘルパー
 */
export async function withTempFile(
  content: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const tempFile = await Deno.makeTempFile();
  await Deno.writeTextFile(tempFile, content);
  try {
    await fn(tempFile);
  } finally {
    await Deno.remove(tempFile);
  }
}

/**
 * 一時ディレクトリのヘルパー
 */
export async function withTempDir(
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    await fn(tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * テスト用のモックボタンコンポーネント型
 */
export interface MockButtonComponent {
  type: number;
  style: number;
  label: string;
  custom_id: string;
  disabled?: boolean;
  emoji?: { name: string };
}
