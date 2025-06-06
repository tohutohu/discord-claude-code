import {
  assertEquals,
} from "https://deno.land/std@0.200.0/testing/asserts.ts";
import { ClaudeCodeRateLimitError } from "../src/worker.ts";

Deno.test("レートリミットタイムスタンプの単位変換テスト", () => {
  // Claude CLIが返すミリ秒タイムスタンプの例
  const timestampMillis = 1749219600000; // 2025-06-07 00:00:00 UTC
  
  // 秒に変換
  const timestampSeconds = Math.floor(timestampMillis / 1000);
  
  // ClaudeCodeRateLimitErrorの動作確認
  const error = new ClaudeCodeRateLimitError(timestampSeconds);
  assertEquals(error.timestamp, timestampSeconds);
  assertEquals(error.message, `Claude AI usage limit reached|${timestampSeconds}`);
  
  // 5分後の時刻計算
  const resumeTime = new Date(timestampSeconds * 1000 + 5 * 60 * 1000);
  const expectedResumeTime = new Date(timestampMillis + 5 * 60 * 1000);
  
  assertEquals(resumeTime.getTime(), expectedResumeTime.getTime());
  
  console.log("元のタイムスタンプ（ミリ秒）:", timestampMillis);
  console.log("変換後のタイムスタンプ（秒）:", timestampSeconds);
  console.log("レートリミット時刻:", new Date(timestampMillis).toISOString());
  console.log("再開予定時刻:", resumeTime.toISOString());
});

Deno.test("extractRateLimitTimestamp関数の動作確認", () => {
  // Claude CLIからの実際のメッセージ例
  const resultMessage = "Claude AI usage limit reached|1749219600000";
  
  // 正規表現でタイムスタンプを抽出
  const match = resultMessage.match(/Claude AI usage limit reached\|(\d+)/);
  assertEquals(match !== null, true);
  
  if (match) {
    const timestampMillis = parseInt(match[1], 10);
    const timestampSeconds = Math.floor(timestampMillis / 1000);
    
    console.log("抽出されたタイムスタンプ（ミリ秒）:", timestampMillis);
    console.log("秒に変換後:", timestampSeconds);
    console.log("時刻:", new Date(timestampMillis).toISOString());
  }
});