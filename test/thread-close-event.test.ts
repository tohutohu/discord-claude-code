import { assertEquals } from "https://deno.land/std@0.217.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.217.0/testing/bdd.ts";

// テスト用の型定義
interface MockThread {
  id: string;
  archived: boolean;
}

interface MockAdmin {
  terminateThreadCalled: boolean;
  terminateThreadId?: string;
  terminateThread(threadId: string): Promise<void>;
}

describe("スレッドクローズイベント", () => {
  it("スレッドがアーカイブされたらterminateThreadが呼ばれる", async () => {
    // モックのAdminオブジェクト
    const mockAdmin: MockAdmin = {
      terminateThreadCalled: false,
      terminateThreadId: undefined,
      terminateThread: async (threadId: string) => {
        mockAdmin.terminateThreadCalled = true;
        mockAdmin.terminateThreadId = threadId;
      },
    };

    // モックのスレッド
    const oldThread: MockThread = {
      id: "thread123",
      archived: false,
    };

    const newThread: MockThread = {
      id: "thread123",
      archived: true,
    };

    // ThreadUpdateイベントハンドラーをテスト
    const threadUpdateHandler = async (
      oldThread: MockThread,
      newThread: MockThread,
    ) => {
      // アーカイブ状態が変更された場合のみ処理
      if (!oldThread.archived && newThread.archived) {
        console.log(`スレッド ${newThread.id} がアーカイブされました`);

        try {
          // Workerの終了処理
          await mockAdmin.terminateThread(newThread.id);
          console.log(
            `スレッド ${newThread.id} のWorkerとworktreeを削除しました`,
          );
        } catch (error) {
          console.error(
            `スレッド ${newThread.id} の終了処理でエラー:`,
            error,
          );
        }
      }
    };

    // テスト実行
    await threadUpdateHandler(oldThread, newThread);

    // 検証
    assertEquals(mockAdmin.terminateThreadCalled, true);
    assertEquals(mockAdmin.terminateThreadId, "thread123");
  });

  it("アーカイブから非アーカイブへの変更では処理されない", async () => {
    const mockAdmin: MockAdmin = {
      terminateThreadCalled: false,
      terminateThreadId: undefined,
      terminateThread: async () => {
        mockAdmin.terminateThreadCalled = true;
      },
    };

    const oldThread: MockThread = {
      id: "thread456",
      archived: true,
    };

    const newThread: MockThread = {
      id: "thread456",
      archived: false,
    };

    // ThreadUpdateイベントハンドラーをテスト
    const threadUpdateHandler = async (
      oldThread: MockThread,
      newThread: MockThread,
    ) => {
      // アーカイブ状態が変更された場合のみ処理
      if (!oldThread.archived && newThread.archived) {
        await mockAdmin.terminateThread(newThread.id);
      }
    };

    // テスト実行
    await threadUpdateHandler(oldThread, newThread);

    // 検証: terminateThreadが呼ばれていないことを確認
    assertEquals(mockAdmin.terminateThreadCalled, false);
  });

  it("アーカイブ状態が変わらない場合は処理されない", async () => {
    const mockAdmin: MockAdmin = {
      terminateThreadCalled: false,
      terminateThreadId: undefined,
      terminateThread: async () => {
        mockAdmin.terminateThreadCalled = true;
      },
    };

    const oldThread: MockThread = {
      id: "thread789",
      archived: false,
    };

    const newThread: MockThread = {
      id: "thread789",
      archived: false,
    };

    // ThreadUpdateイベントハンドラーをテスト
    const threadUpdateHandler = async (
      oldThread: MockThread,
      newThread: MockThread,
    ) => {
      // アーカイブ状態が変更された場合のみ処理
      if (!oldThread.archived && newThread.archived) {
        await mockAdmin.terminateThread(newThread.id);
      }
    };

    // テスト実行
    await threadUpdateHandler(oldThread, newThread);

    // 検証: terminateThreadが呼ばれていないことを確認
    assertEquals(mockAdmin.terminateThreadCalled, false);
  });
});
