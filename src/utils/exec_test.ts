import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { exec } from "./exec.ts";

Deno.test("exec - 成功するコマンドを実行", async () => {
  const result = await exec("echo 'Hello, World!'");

  assertEquals(result.success, true);
  assertEquals(result.output.trim(), "Hello, World!");
  assertEquals(result.error, "");
});

Deno.test("exec - 失敗するコマンドを実行", async () => {
  const result = await exec("ls /nonexistent-directory-12345");

  assertEquals(result.success, false);
  assertEquals(result.output, "");
  assertEquals(result.error.includes("No such file or directory"), true);
});

Deno.test("exec - 複数行の出力", async () => {
  const result = await exec("echo 'Line 1' && echo 'Line 2' && echo 'Line 3'");

  assertEquals(result.success, true);
  const lines = result.output.trim().split("\n");
  assertEquals(lines.length, 3);
  assertEquals(lines[0], "Line 1");
  assertEquals(lines[1], "Line 2");
  assertEquals(lines[2], "Line 3");
});

Deno.test("exec - エラー出力のキャプチャ", async () => {
  const result = await exec("sh -c 'echo Error message >&2 && exit 1'");

  assertEquals(result.success, false);
  assertEquals(result.error.trim(), "Error message");
});

Deno.test("exec - パイプを使用したコマンド", async () => {
  const result = await exec("echo 'test\ndata\nhere' | grep data");

  assertEquals(result.success, true);
  assertEquals(result.output.trim(), "data");
});
