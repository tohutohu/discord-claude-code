import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Worker } from "../src/worker.ts";

Deno.test("Worker - メッセージを受け取って返信する", async () => {
  const workerName = "happy-panda";
  const worker = new Worker(workerName);

  const message = "テストメッセージです";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    `こんにちは、${workerName}です。${message}というメッセージを受け取りました！`,
  );
});

Deno.test("Worker - 名前を取得できる", () => {
  const workerName = "clever-fox";
  const worker = new Worker(workerName);

  assertEquals(worker.getName(), workerName);
});

Deno.test("Worker - 空のメッセージも処理できる", async () => {
  const workerName = "gentle-bear";
  const worker = new Worker(workerName);

  const message = "";
  const reply = await worker.processMessage(message);

  assertEquals(
    reply,
    `こんにちは、${workerName}です。${message}というメッセージを受け取りました！`,
  );
});
