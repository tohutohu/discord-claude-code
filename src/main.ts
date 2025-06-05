import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { Admin } from "./admin.ts";
import { getEnv } from "./env.ts";
import { ensureRepository, parseRepository } from "./git-utils.ts";
import { WorkspaceManager } from "./workspace.ts";
import {
  checkSystemRequirements,
  formatSystemCheckResults,
} from "./system-check.ts";

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
const admin = new Admin(workspaceManager);

// Discord Clientの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
];

// Bot起動時の処理
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ログイン完了: ${readyClient.user.tag}`);

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
      try {
        await interaction.message.edit({
          content: interaction.message.content,
          components: [], // ボタンを削除
        });
      } catch (error) {
        console.error("ボタン削除エラー:", error);
      }
    }

    await interaction.editReply(result);
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

  if (commandName === "start") {
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

      await thread.send({
        content:
          `${greeting}${devcontainerMessage}\n\n${initialMessage.content}`,
        components: initialMessage.components,
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

// メッセージの処理
client.on(Events.MessageCreate, async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return;

  // スレッド内のメッセージのみ処理
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  try {
    // devcontainer設定に関する応答かチェック
    const content = message.content.trim().toLowerCase();
    if (isDevcontainerConfigurationMessage(content)) {
      await handleDevcontainerConfiguration(message, threadId, content);
      return;
    }

    // AdminにメッセージをルーティングしてWorkerからの返信を取得
    const reply = await admin.routeMessage(threadId, message.content);

    // Workerからの返信をDiscordに送信
    await message.reply(reply);
  } catch (error) {
    if ((error as Error).message.includes("Worker not found")) {
      // このスレッド用のWorkerがまだ作成されていない場合
      await message.reply(
        "このスレッドはアクティブではありません。/start コマンドで新しいスレッドを開始してください。",
      );
    } else {
      console.error("メッセージ処理エラー:", error);
      await message.reply("エラーが発生しました。");
    }
  }
});

function isDevcontainerConfigurationMessage(content: string): boolean {
  const devcontainerResponses = [
    "devcontainer-yes-skip",
    "devcontainer-yes-no-skip",
    "devcontainer-no-skip",
    "devcontainer-no-no-skip",
    "yes",
    "no",
  ];

  return devcontainerResponses.includes(content);
}

async function handleDevcontainerConfiguration(
  message: { reply: (content: string) => Promise<unknown> },
  threadId: string,
  content: string,
): Promise<void> {
  const worker = admin.getWorker(threadId);
  if (!worker) {
    await message.reply("Workerが見つかりません。");
    return;
  }

  const workerTyped = worker as import("./worker.ts").Worker;

  if (content.startsWith("devcontainer-")) {
    // devcontainer関連の設定
    const useDevcontainer = content.includes("-yes-");
    const skipPermissions = content.includes("-skip");

    workerTyped.setUseDevcontainer(useDevcontainer);
    workerTyped.setSkipPermissions(skipPermissions);

    if (useDevcontainer) {
      await message.reply("devcontainerを起動しています...");

      const result = await admin.startDevcontainerForWorker(threadId);

      if (result.success) {
        const permissionMsg = skipPermissions
          ? " (権限チェックスキップ有効)"
          : " (権限チェック有効)";
        await message.reply(
          `${result.message}${permissionMsg}\n\n準備完了です！何かご質問をどうぞ。`,
        );
      } else {
        await message.reply(
          `${result.message}\n\n通常環境でClaude実行を継続します。`,
        );
        workerTyped.setUseDevcontainer(false);
      }
    } else {
      const permissionMsg = skipPermissions
        ? " (権限チェックスキップ有効)"
        : " (権限チェック有効)";
      workerTyped.setSkipPermissions(skipPermissions);
      await message.reply(
        `通常のローカル環境でClaude実行を設定しました。${permissionMsg}\n\n準備完了です！何かご質問をどうぞ。`,
      );
    }
  } else if (content === "yes" || content === "no") {
    // 権限スキップの設定のみ
    const skipPermissions = content === "yes";
    workerTyped.setSkipPermissions(skipPermissions);

    const permissionMsg = skipPermissions
      ? "権限チェックスキップを有効にしました。"
      : "権限チェックを有効にしました。";
    await message.reply(
      `${permissionMsg}\n\n準備完了です！何かご質問をどうぞ。`,
    );
  }
}

// Botを起動
client.login(env.DISCORD_TOKEN);
