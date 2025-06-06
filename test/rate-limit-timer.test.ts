import {
  assertEquals,
} from "https://deno.land/std@0.200.0/testing/asserts.ts";
import { Admin } from "../src/admin.ts";
import { WorkspaceManager } from "../src/workspace.ts";

Deno.test("レートリミットタイマーのテスト - 短時間でのテスト", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();
  
  const admin = new Admin(workspaceManager, true); // VERBOSEモード有効
  const threadId = "test-thread-timer";
  
  // Workerを作成
  const worker = await admin.createWorker(threadId);
  
  // タイマー発火を記録するフラグ
  let callbackCalled = false;
  let callbackMessage = "";
  
  // 自動再開コールバックを設定
  admin.setAutoResumeCallback(async (tid: string, message: string) => {
    console.log(`[Test] コールバック呼び出し: threadId=${tid}, message="${message}"`);
    callbackCalled = true;
    callbackMessage = message;
  });
  
  // レートリミット情報を保存（5秒後に再開するように設定）
  const now = Math.floor(Date.now() / 1000);
  await workspaceManager.saveThreadInfo({
    threadId: threadId,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: "active",
    repositoryFullName: null,
    repositoryLocalPath: null,
    worktreePath: null,
    devcontainerConfig: null,
    rateLimitTimestamp: now,
    autoResumeAfterRateLimit: true,
  });
  
  // privateメソッドにアクセスするためのハック
  const adminAny = admin as any;
  
  // 5秒後に再開するようにタイマーを設定（本番は5分だが、テスト用に短縮）
  console.log("[Test] 5秒タイマーを設定");
  
  // scheduleAutoResumeメソッドを短い時間でテスト
  adminAny.scheduleAutoResume = function(tid: string, timestamp: number) {
    // 5秒後に設定（本番は5分）
    const resumeTime = timestamp * 1000 + 5 * 1000; // 5秒
    const currentTime = Date.now();
    const delay = Math.max(0, resumeTime - currentTime);
    
    console.log(`[Test] タイマー設定: ${delay}ms後に実行`);
    
    const timerId = setTimeout(async () => {
      console.log(`[Test] タイマー発火`);
      try {
        await adminAny.executeAutoResume(tid);
      } catch (error) {
        console.error(`[Test] エラー:`, error);
      }
    }, delay);
    
    adminAny.autoResumeTimers.set(tid, timerId);
  };
  
  // タイマーを設定
  adminAny.scheduleAutoResume(threadId, now);
  
  // 6秒待つ（タイマーが発火するのを待つ）
  console.log("[Test] タイマー発火を待機中...");
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  // 検証
  assertEquals(callbackCalled, true, "コールバックが呼ばれるべき");
  assertEquals(callbackMessage, "続けて", "メッセージは'続けて'であるべき");
  
  // クリーンアップ
  await admin.terminateThread(threadId);
  await Deno.remove(tempDir, { recursive: true });
});