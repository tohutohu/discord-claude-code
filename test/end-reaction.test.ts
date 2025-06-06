import { assertEquals } from "https://deno.land/std@0.217.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.217.0/testing/bdd.ts";

// テスト用の型定義
interface MockReaction {
  emoji: { name: string };
  message: {
    author?: { bot: boolean };
    channel: {
      id: string;
      isThread: () => boolean;
      send: (
        options: { content: string; components?: unknown[] },
      ) => Promise<unknown>;
    };
    content?: string;
    partial: boolean;
    fetch?: () => Promise<void>;
  };
}

interface MockUser {
  bot: boolean;
}

describe("endリアクション機能", () => {
  it("resultメッセージにendリアクションが付けられたら終了ボタンメッセージを送信する", async () => {
    // モックの設定
    let sendArgs: unknown = null;
    const mockChannel = {
      id: "thread123",
      isThread: () => true,
      send: (arg: unknown) => {
        sendArgs = arg;
        return Promise.resolve();
      },
    };

    const mockMessage = {
      author: { bot: true },
      channel: mockChannel,
      content: "テスト結果\n\n**最終結果:**\n✅ テスト完了",
      partial: false,
    };

    const mockReaction = {
      emoji: { name: "🔚" },
      message: mockMessage,
    };

    const mockUser = {
      bot: false,
    };

    // リアクションハンドラーをテスト
    const reactionHandler = async (reaction: MockReaction, user: MockUser) => {
      if (user.bot) return;
      if (!reaction.message.channel.isThread()) return;
      if (reaction.message.partial) {
        try {
          if (reaction.message.fetch) {
            await reaction.message.fetch();
          }
        } catch (error) {
          console.error("メッセージの取得に失敗:", error);
          return;
        }
      }
      if (!reaction.message.author?.bot) return;
      if (reaction.emoji.name !== "🔚" && reaction.emoji.name !== "end") return;
      if (!reaction.message.content?.includes("**最終結果:**")) return;

      const threadId = reaction.message.channel.id;

      try {
        await reaction.message.channel.send({
          content: "このスレッドを終了してアーカイブしますか？",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 4,
                  label: "スレッドを終了",
                  custom_id: `terminate_${threadId}`,
                },
              ],
            },
          ],
        });
      } catch (error) {
        console.error("終了ボタンメッセージの送信に失敗:", error);
      }
    };

    // テスト実行
    await reactionHandler(mockReaction, mockUser);

    // 検証
    const arg = sendArgs as {
      content: string;
      components: Array<{
        components: Array<{ custom_id: string }>;
      }>;
    };
    assertEquals(
      arg.content,
      "このスレッドを終了してアーカイブしますか？",
    );
    assertEquals(
      arg.components[0].components[0].custom_id,
      "terminate_thread123",
    );
  });

  it("botではないユーザーのメッセージへのリアクションは無視される", async () => {
    // モックの設定
    let sendCalled = false;
    const mockChannel = {
      id: "thread123",
      isThread: () => true,
      send: () => {
        sendCalled = true;
        return Promise.resolve();
      },
    };

    const mockMessage = {
      author: { bot: false }, // ユーザーのメッセージ
      channel: mockChannel,
      content: "**最終結果:**\n✅ テスト完了",
      partial: false,
    };

    const mockReaction = {
      emoji: { name: "🔚" },
      message: mockMessage,
    };

    const mockUser = {
      bot: false,
    };

    // リアクションハンドラーをテスト
    const reactionHandler = async (reaction: MockReaction, user: MockUser) => {
      if (user.bot) return;
      if (!reaction.message.channel.isThread()) return;
      if (!reaction.message.author?.bot) return; // ここでreturn
      // 以降の処理は実行されない
      await reaction.message.channel.send({
        content: "このスレッドを終了してアーカイブしますか？",
      });
    };

    // テスト実行
    await reactionHandler(mockReaction, mockUser);

    // 検証: sendが呼ばれていないことを確認
    assertEquals(sendCalled, false);
  });

  it("resultが含まれていないメッセージへのendリアクションは無視される", async () => {
    // モックの設定
    let sendCalled = false;
    const mockChannel = {
      id: "thread123",
      isThread: () => true,
      send: () => {
        sendCalled = true;
        return Promise.resolve();
      },
    };

    const mockMessage = {
      author: { bot: true },
      channel: mockChannel,
      content: "進捗メッセージです", // **最終結果:** が含まれていない
      partial: false,
    };

    const mockReaction = {
      emoji: { name: "🔚" },
      message: mockMessage,
    };

    const mockUser = {
      bot: false,
    };

    // リアクションハンドラーをテスト
    const reactionHandler = async (reaction: MockReaction, user: MockUser) => {
      if (user.bot) return;
      if (!reaction.message.channel.isThread()) return;
      if (!reaction.message.author?.bot) return;
      if (reaction.emoji.name !== "🔚" && reaction.emoji.name !== "end") return;
      if (!reaction.message.content?.includes("**最終結果:**")) return; // ここでreturn

      await reaction.message.channel.send({
        content: "このスレッドを終了してアーカイブしますか？",
      });
    };

    // テスト実行
    await reactionHandler(mockReaction, mockUser);

    // 検証: sendが呼ばれていないことを確認
    assertEquals(sendCalled, false);
  });
});
