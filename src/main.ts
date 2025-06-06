import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { Admin } from "./admin.ts";
import { Worker } from "./worker.ts";
import { getEnv } from "./env.ts";
import { ensureRepository, parseRepository } from "./git-utils.ts";
import { WorkspaceManager } from "./workspace.ts";
import {
  checkSystemRequirements,
  formatSystemCheckResults,
} from "./system-check.ts";
import { performGitUpdate } from "./git-update.ts";

// システム要件チェック
console.log("システム要件をチェックしています...");
const systemCheck = await checkSystemRequirements();
const checkResults = formatSystemCheckResults(
  systemCheck.results,
  systemCheck.missingRequired,
);
console.log(checkResults);

if (!systemCheck.success) {
  console.error(
    "\n❌ 必須コマンドが不足しているため、アプリケーションを終了します。",
  );
  Deno.exit(1);
}

console.log("\n✅ システム要件チェック完了\n");

const env = await getEnv();
const workspaceManager = new WorkspaceManager(env.WORK_BASE_DIR);
await workspaceManager.initialize();
const admin = new Admin(workspaceManager, env.VERBOSE);

if (env.VERBOSE) {
  console.log("🔍 VERBOSEモードが有効です - 詳細ログが出力されます");
}

// Discord Clientの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// スレッドクローズコールバックを設定
admin.setThreadCloseCallback(async (threadId: string) => {
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread && thread.isThread()) {
      await thread.setArchived(true);
      console.log(`スレッド ${threadId} をアーカイブしました`);
    }
  } catch (error) {
    console.error(`スレッド ${threadId} のアーカイブに失敗:`, error);
  }
});

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("新しいチャットスレッドを開始します")
    .addStringOption((option) =>
      option.setName("repository")
        .setDescription("対象のGitHubリポジトリ（例: owner/repo）")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Discord Botのコードを最新版に更新します")
    .toJSON(),
];

// Bot起動時の処理
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ログイン完了: ${readyClient.user.tag}`);

  // 自動再開コールバックを設定
  admin.setAutoResumeCallback(async (threadId: string, message: string) => {
    try {
      const channel = await readyClient.channels.fetch(threadId);
      if (channel && channel.isTextBased() && "send" in channel) {
        // スレッドから最新のメッセージを取得（リアクション用）
        const messages = await channel.messages.fetch({ limit: 10 });
        const userMessages = messages.filter((msg) => !msg.author.bot);
        const lastUserMessage = userMessages.first();

        // 進捗コールバック
        const onProgress = async (content: string) => {
          try {
            await channel.send({
              content: content,
              flags: 4096, // SUPPRESS_NOTIFICATIONS flag
            });
          } catch (sendError) {
            console.error("自動再開メッセージ送信エラー:", sendError);
          }
        };

        // リアクションコールバック
        const onReaction = async (emoji: string) => {
          if (lastUserMessage) {
            try {
              await lastUserMessage.react(emoji);
            } catch (error) {
              console.error("自動再開リアクション追加エラー:", error);
            }
          }
        };

        const reply = await admin.routeMessage(
          threadId,
          message,
          onProgress,
          onReaction,
        );

        if (typeof reply === "string") {
          await (channel as TextChannel).send(reply);
        } else {
          await (channel as TextChannel).send({
            content: reply.content,
            components: reply.components,
          });
        }
      }
    } catch (error) {
      console.error("自動再開メッセージ送信エラー:", error);
    }
  });

  // スレッドクローズコールバックを設定
  admin.setThreadCloseCallback(async (threadId: string) => {
    try {
      const channel = await readyClient.channels.fetch(threadId);
      if (channel && channel.type === ChannelType.PublicThread) {
        await (channel as ThreadChannel).setArchived(true);
        console.log(`スレッドをアーカイブしました: ${threadId}`);
      }
    } catch (error) {
      console.error(`スレッドのアーカイブに失敗しました (${threadId}):`, error);
    }
  });

  // アクティブなスレッドを復旧
  console.log("アクティブなスレッドを復旧しています...");
  await admin.restoreActiveThreads();
  console.log("スレッドの復旧が完了しました。");

  // スラッシュコマンドを登録
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  try {
    console.log("スラッシュコマンドの登録を開始します...");

    await rest.put(
      Routes.applicationCommands(readyClient.user.id),
      { body: commands },
    );

    console.log("スラッシュコマンドの登録が完了しました！");
  } catch (error) {
    console.error("スラッシュコマンドの登録に失敗しました:", error);
  }
});

// インタラクションの処理
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  } else if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
  }
});

async function handleButtonInteraction(interaction: ButtonInteraction) {
  try {
    const threadId = interaction.channel?.id;
    if (!threadId) {
      await interaction.reply("スレッドIDが取得できませんでした。");
      return;
    }

    await interaction.deferReply();

    const result = await admin.handleButtonInteraction(
      threadId,
      interaction.customId,
    );

    // スレッド終了ボタンが押された場合は元のメッセージからボタンを削除
    if (interaction.customId === `terminate_${threadId}`) {
      // 先にボタンを削除（スレッドがアーカイブされる前に）
      try {
        await interaction.message.edit({
          content: interaction.message.content,
          components: [], // ボタンを削除
        });
      } catch (error) {
        // スレッドがアーカイブされている場合のエラーは無視（期待される動作）
        if (
          error instanceof Error && "code" in error &&
          (error as Error & { code: number }).code === 50083
        ) {
          // Thread is archived エラーは正常な動作として扱う
          console.log("スレッドは既にアーカイブされています（正常動作）");
        } else {
          console.error("ボタン削除エラー:", error);
        }
      }

      // その後で結果を返す（これによりスレッドがアーカイブされる）
      await interaction.editReply(result);
      return;
    }

    // devcontainerの権限選択フローの処理
    if (result === "devcontainer_permissions_choice") {
      try {
        await interaction.message.edit({
          content: interaction.message.content +
            "\n\n✅ devcontainer使用を選択しました\n\n権限設定を選択してください：",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 1,
                  label: "権限チェックあり",
                  custom_id: `devcontainer_permissions_no_skip_${threadId}`,
                },
                {
                  type: 2,
                  style: 2,
                  label: "権限チェックスキップ",
                  custom_id: `devcontainer_permissions_skip_${threadId}`,
                },
              ],
            },
          ],
        });
      } catch (error) {
        console.error("メッセージ更新エラー:", error);
      }
      await interaction.editReply(
        "devcontainerでの実行を選択しました。権限設定を選択してください。",
      );
      return;
    }

    if (result === "local_permissions_choice") {
      try {
        await interaction.message.edit({
          content: interaction.message.content +
            "\n\n✅ ローカル環境使用を選択しました\n\n権限設定を選択してください：",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 1,
                  label: "権限チェックあり",
                  custom_id: `permissions_no_skip_${threadId}`,
                },
                {
                  type: 2,
                  style: 2,
                  label: "権限チェックスキップ",
                  custom_id: `permissions_skip_${threadId}`,
                },
              ],
            },
          ],
        });
      } catch (error) {
        console.error("メッセージ更新エラー:", error);
      }
      await interaction.editReply(
        "ローカル環境での実行を選択しました。権限設定を選択してください。",
      );
      return;
    }

    // すべてのボタン選択でボタンを削除し、選択結果をテキストに置き換えて、終了ボタンを追加
    try {
      let selectedChoice = "";

      if (interaction.customId.includes("devcontainer_permissions_no_skip")) {
        selectedChoice =
          "\n\n✅ devcontainer使用・権限チェックありを選択しました";
      } else if (
        interaction.customId.includes("devcontainer_permissions_skip")
      ) {
        selectedChoice =
          "\n\n✅ devcontainer使用・権限チェックスキップを選択しました";
      } else if (interaction.customId.includes("permissions_no_skip")) {
        selectedChoice = "\n\n✅ ローカル環境・権限チェックありを選択しました";
      } else if (interaction.customId.includes("permissions_skip")) {
        selectedChoice =
          "\n\n✅ ローカル環境・権限チェックスキップを選択しました";
      }

      if (selectedChoice) {
        await interaction.message.edit({
          content: interaction.message.content + selectedChoice,
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
      }
    } catch (error) {
      console.error("ボタン削除エラー:", error);
    }

    // devcontainerの起動処理を特別扱い
    if (result === "devcontainer_start_with_progress") {
      await interaction.editReply("🐳 devcontainerを起動しています...");

      let lastUpdateTime = Date.now();
      const UPDATE_INTERVAL = 2000; // 2秒ごとに更新

      // 進捗更新用のコールバック（新規メッセージ投稿、通知なし）
      const onProgress = async (content: string) => {
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          try {
            if (interaction.channel && "send" in interaction.channel) {
              await interaction.channel.send({
                content: content,
                flags: 4096, // SUPPRESS_NOTIFICATIONS flag
              });
            }
            lastUpdateTime = now;
          } catch (sendError) {
            console.error("メッセージ送信エラー:", sendError);
          }
        }
      };

      // devcontainerを起動
      const startResult = await admin.startDevcontainerForWorker(
        threadId,
        onProgress,
      );

      const worker = admin.getWorker(threadId);
      const skipPermissions = (worker as Worker)?.isSkipPermissions() || false;

      if (startResult.success) {
        const permissionMsg = skipPermissions
          ? " (権限チェックスキップ有効)"
          : " (権限チェック有効)";
        if (interaction.channel && "send" in interaction.channel) {
          await interaction.channel.send(
            `<@${interaction.user.id}> ${startResult.message}${permissionMsg}\n\n準備完了です！何かご質問をどうぞ。`,
          );
        }
      } else {
        if (worker) {
          (worker as Worker).setUseDevcontainer(false);
        }
        if (interaction.channel && "send" in interaction.channel) {
          await interaction.channel.send(
            `<@${interaction.user.id}> ${startResult.message}\n\n通常環境でClaude実行を継続します。`,
          );
        }
      }
    } else {
      await interaction.editReply(result);
    }
  } catch (error) {
    console.error("ボタンインタラクションエラー:", error);
    try {
      await interaction.editReply("エラーが発生しました。");
    } catch {
      await interaction.reply("エラーが発生しました。");
    }
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  try {
    if (interaction.commandName === "start") {
      const focusedOption = interaction.options.getFocused(true);

      if (focusedOption.name === "repository") {
        const localRepositories = await workspaceManager.getLocalRepositories();
        const input = focusedOption.value.toLowerCase();

        // 入力文字列でフィルタリング
        const filtered = localRepositories.filter((repo) =>
          repo.toLowerCase().includes(input)
        );

        // Discord.jsの制限により最大25件まで
        const choices = filtered.slice(0, 25).map((repo) => ({
          name: repo,
          value: repo,
        }));

        await interaction.respond(choices);
      }
    }
  } catch (error) {
    console.error("オートコンプリートエラー:", error);
    // エラー時は空の選択肢を返す
    await interaction.respond([]);
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "update") {
    try {
      await interaction.deferReply();

      // Git操作を実行
      const updateResult = await performGitUpdate();

      if (updateResult.success) {
        await interaction.editReply(
          `✅ 更新が完了しました！\n\n${updateResult.message}\n\n⚠️ Botを再起動してください。HMRが有効な場合は自動的に反映されます。`,
        );
      } else {
        await interaction.editReply(
          `❌ 更新に失敗しました。\n\n${updateResult.message}`,
        );
      }
    } catch (error) {
      console.error("更新コマンドエラー:", error);
      await interaction.editReply("エラーが発生しました。");
    }
  } else if (commandName === "start") {
    try {
      if (!interaction.channel || !("threads" in interaction.channel)) {
        await interaction.reply("このチャンネルではスレッドを作成できません。");
        return;
      }

      // リポジトリ引数を取得
      const repositorySpec = interaction.options.getString("repository", true);

      // リポジトリ名をパース
      let repository;
      try {
        repository = parseRepository(repositorySpec);
      } catch (error) {
        await interaction.reply(`エラー: ${(error as Error).message}`);
        return;
      }

      // インタラクションを遅延レスポンスで処理（clone処理が時間がかかる可能性があるため）
      await interaction.deferReply();

      // リポジトリをclone/更新
      let repositoryResult;
      try {
        repositoryResult = await ensureRepository(repository, workspaceManager);
      } catch (error) {
        await interaction.editReply(
          `リポジトリの取得に失敗しました: ${(error as Error).message}`,
        );
        return;
      }

      // スレッドを作成
      const thread = await interaction.channel.threads.create({
        name: `${repository.fullName}-${Date.now()}`,
        autoArchiveDuration: 60,
        reason: `${repository.fullName}のチャットセッション`,
      });

      if (!thread) {
        await interaction.editReply("スレッドの作成に失敗しました。");
        return;
      }

      // Workerを作成してリポジトリ情報を設定
      const worker = await admin.createWorker(thread.id);
      await worker.setRepository(repository, repositoryResult.path);

      // 更新状況に応じたメッセージを作成
      let statusMessage = repositoryResult.wasUpdated
        ? `${repository.fullName}の既存リポジトリをデフォルトブランチの最新に更新しました。`
        : `${repository.fullName}を新規取得しました。`;

      // メタデータがある場合は追加情報を表示
      if (repositoryResult.metadata) {
        const metadata = repositoryResult.metadata;
        const repoInfo = [
          metadata.description ? `説明: ${metadata.description}` : "",
          metadata.language ? `言語: ${metadata.language}` : "",
          `デフォルトブランチ: ${metadata.defaultBranch}`,
          metadata.isPrivate
            ? "🔒 プライベートリポジトリ"
            : "🌐 パブリックリポジトリ",
        ].filter(Boolean).join(" | ");

        statusMessage += `\n📋 ${repoInfo}`;
      }

      await interaction.editReply(
        `${statusMessage}\nチャットスレッドを作成しました: ${thread.toString()}`,
      );

      // devcontainer.jsonの存在確認と設定
      const devcontainerInfo = await admin.checkAndSetupDevcontainer(
        thread.id,
        repositoryResult.path,
      );

      // 初期メッセージを終了ボタン付きで送信
      const initialMessage = admin.createInitialMessage(thread.id);
      const greeting =
        `こんにちは！私は${worker.getName()}です。${repository.fullName}について何か質問はありますか？\n\n`;

      let devcontainerMessage = "";
      if (devcontainerInfo.warning) {
        devcontainerMessage += `${devcontainerInfo.warning}\n\n`;
      }
      devcontainerMessage += devcontainerInfo.message;

      // devcontainerの設定ボタンがある場合はそれを使用、ない場合は終了ボタンのみ
      const components = devcontainerInfo.components ||
        initialMessage.components;

      await thread.send({
        content:
          `${greeting}${devcontainerMessage}\n\n${initialMessage.content}`,
        components: components,
      });
    } catch (error) {
      console.error("スレッド作成エラー:", error);
      try {
        await interaction.editReply("エラーが発生しました。");
      } catch {
        await interaction.reply("エラーが発生しました。");
      }
    }
  }
}

// リアクションの処理
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  // Bot自身のリアクションは無視
  if (user.bot) return;

  // スレッド内のメッセージのみ処理
  if (!reaction.message.channel.isThread()) return;

  // partial messageの場合は完全に取得
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error("メッセージの取得に失敗:", error);
      return;
    }
  }

  // Bot自身のメッセージかチェック
  if (!reaction.message.author?.bot) return;

  // endリアクションかチェック（絵文字の名前で判定）
  if (reaction.emoji.name !== "🔚" && reaction.emoji.name !== "end") return;

  // メッセージ内容にresultが含まれているかチェック
  if (!reaction.message.content?.includes("**最終結果:**")) return;

  const threadId = reaction.message.channel.id;

  try {
    // 終了ボタン付きメッセージを投稿
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
});

// メッセージの処理
client.on(Events.MessageCreate, async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return;

  // スレッド内のメッセージのみ処理
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  try {
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 2000; // 2秒ごとに更新

    // 進捗更新用のコールバック（新規メッセージ投稿、通知なし）
    const onProgress = async (content: string) => {
      const now = Date.now();
      if (now - lastUpdateTime >= UPDATE_INTERVAL) {
        try {
          await message.channel.send({
            content: content,
            flags: 4096, // SUPPRESS_NOTIFICATIONS flag
          });
          lastUpdateTime = now;
        } catch (sendError) {
          console.error("メッセージ送信エラー:", sendError);
        }
      }
    };

    // リアクション追加用のコールバック
    const onReaction = async (emoji: string) => {
      try {
        await message.react(emoji);
      } catch (error) {
        console.error("リアクション追加エラー:", error);
      }
    };

    // AdminにメッセージをルーティングしてWorkerからの返信を取得
    const reply = await admin.routeMessage(
      threadId,
      message.content,
      onProgress,
      onReaction,
    );

    // 最終的な返信を送信
    if (typeof reply === "string") {
      // 通常のテキストレスポンス（メンション付きで通知あり）
      await message.channel.send(`<@${message.author.id}> ${reply}`);
    } else {
      // DiscordMessage形式（ボタン付きメッセージなど）
      await message.channel.send({
        content: `<@${message.author.id}> ${reply.content}`,
        components: reply.components,
      });
    }
  } catch (error) {
    if ((error as Error).message.includes("Worker not found")) {
      // このスレッド用のWorkerがまだ作成されていない場合
      await message.channel.send(
        "このスレッドはアクティブではありません。/start コマンドで新しいスレッドを開始してください。",
      );
    } else {
      console.error("メッセージ処理エラー:", error);
      await message.channel.send("エラーが発生しました。");
    }
  }
});

// Botを起動
client.login(env.DISCORD_TOKEN);
