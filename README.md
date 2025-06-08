# Claude Discord Bot

Claude AIを活用したDiscord
Bot。GitHubリポジトリをクローンして、Claudeがコードを読み込み、修正やレビューを行えます。

## 機能

- **GitHubリポジトリ連携**:
  スラッシュコマンドでGitHubリポジトリを指定すると、自動的にクローン/更新
- **リポジトリ名オートコンプリート**: GitHub
  APIを使用したリアルタイムのリポジトリ名補完機能
- **Claude AI統合**: Claude CLIを使用してコードの読み込み、修正、レビューを実行
- **スレッド管理**:
  1つのスレッドにつき1つのWorkerが割り当てられ、独立した作業環境を提供
- **永続化機能**:
  スレッド情報、セッションログ、監査ログを保存し、再起動後も継続可能
- **Dev Container対応**:
  リポジトリにdevcontainer.jsonがある場合、その環境内でClaudeを実行
- **レート制限対応**: Claude APIのレート制限に対応し、自動再開ボタンを提供

## セットアップ

### 前提条件

#### 必須コマンド

- [Deno](https://deno.land/) (v1.40以上)
- [Git](https://git-scm.com/downloads)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)

#### 推奨コマンド

- [GitHub CLI (gh)](https://cli.github.com/) - プライベートリポジトリ対応
- [Dev Container CLI](https://github.com/devcontainers/cli) -
  `npm install -g @devcontainers/cli`

### インストール手順

1. リポジトリをクローン

```bash
git clone https://github.com/[your-org]/claude-discord-bot.git
cd claude-discord-bot
```

2. Discord Botを作成
   - [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーションを作成
   - Botトークンを取得
   - 必要な権限: `Send Messages`, `Read Message History`, `Use Slash Commands`,
     `Create Public Threads`, `Send Messages in Threads`

3. 環境変数を設定

```bash
# .env.exampleをコピーして.envファイルを作成
cp .env.example .env

# .envファイルを編集して、実際の値を設定
# DISCORD_TOKEN: Discord Developer Portalで取得したトークン
# WORK_BASE_DIR: 作業ディレクトリのパス（例: ~/claude-bot-work）
```

4. Git hooksをセットアップ（推奨）

```bash
deno task setup-hooks
```

5. Botを起動

```bash
# 開発モード（ウォッチモード）
deno task dev

# 本番モード
deno task start
```

## 使い方

### Discordでの使用方法

1. Botを招待したサーバーで以下のスラッシュコマンドを実行:

```text
/claude <GitHubリポジトリ名>
```

例: `/claude octocat/Hello-World`

2. Botが自動的にスレッドを作成し、リポジトリをクローン
3. スレッド内でClaudeに指示を送信
4. Claudeがコードを読み込み、修正やレビューを実行

### コマンド例

- 「このリポジトリの構造を説明して」
- 「READMEを改善して」
- 「テストを追加して」
- 「バグを修正して」

## 設定項目

### 環境変数

| 変数名                        | 説明                                     | 必須 |
| ----------------------------- | ---------------------------------------- | ---- |
| `DISCORD_TOKEN`               | Discord Botのトークン                    | ✅   |
| `WORK_BASE_DIR`               | 作業ディレクトリのベースパス             | ✅   |
| `CLAUDE_APPEND_SYSTEM_PROMPT` | Claude実行時に追加するシステムプロンプト | ❌   |

### 作業ディレクトリ構造

```text
WORK_BASE_DIR/
├── repositories/          # クローンされたGitHubリポジトリ
│   └── {org}/
│       └── {repo}/
├── threads/              # スレッド情報の永続化
│   └── {thread_id}.json
├── sessions/             # Claudeセッションログ
│   └── {thread_id}/
│       └── {session_id}.json
└── audit/               # 監査ログ（JSONL形式）
    └── {date}/
        └── activity.jsonl
```

## 開発方法

### 開発環境のセットアップ

```bash
# 依存関係のインストール（Denoは自動的に管理）
deno cache src/main.ts

# Git hooksのセットアップ
deno task setup-hooks
```

### 開発コマンド

```bash
# コードフォーマット
deno task fmt

# リント
deno task lint

# 型チェック
deno task check

# テスト実行
deno task test

# 全チェック（フォーマット → リント → 型チェック → テスト）
deno task test:all:quiet
```

### トークン節約版コマンド（CI/CD向け）

エラー時のみ詳細を出力するquiet版:

```bash
deno task fmt:quiet
deno task lint:quiet
deno task check:quiet
deno task test:quiet
deno task test:all:quiet
```

### テスト

```bash
# 全テスト実行
deno test --allow-read --allow-write --allow-env --allow-run

# 特定のテストファイルを実行
deno test --allow-read --allow-write --allow-env --allow-run src/worker_test.ts
```

### デバッグ

1. 開発モードで起動

```bash
deno task dev
```

2. ログの確認

- 標準出力にログが表示されます
- 監査ログ: `WORK_BASE_DIR/audit/{date}/activity.jsonl`
- セッションログ: `WORK_BASE_DIR/sessions/{thread_id}/{session_id}.json`

## アーキテクチャ

### 主要コンポーネント

- **Admin** (`src/admin.ts`): Workerの管理とメッセージルーティング
- **Worker** (`src/worker.ts`): Claude実行とメッセージ処理
- **WorkspaceManager** (`src/workspace.ts`): 作業ディレクトリとデータ永続化
- **GitUtils** (`src/git-utils.ts`): Gitリポジトリ操作

### メッセージフロー

```text
Discord User
    ↓
main.ts (MessageCreate)
    ↓
admin.routeMessage()
    ↓
worker.processMessage()
    ↓
Claude CLI実行
    ↓
結果をDiscordに送信
```

## トラブルシューティング

### Botが応答しない

- Discord Tokenが正しく設定されているか確認
- Botに必要な権限があるか確認
- ログでエラーメッセージを確認

### Claude CLIエラー

- Claude CLIがインストールされているか確認: `claude --version`
- Claude APIキーが設定されているか確認

### リポジトリクローンエラー

- プライベートリポジトリの場合、GitHub CLIがインストールされ認証済みか確認:
  `gh auth status`
- 作業ディレクトリの権限を確認

## 技術スタック

- **Runtime**: Deno v1.40+
- **Language**: TypeScript (厳格モード)
- **Discord Library**: Discord.js v14.16.3+
- **AI Integration**: Claude CLI
- **Version Control**: Git

## 開発ツール

標準的なものに加えて、以下のツールが利用可能です：

- **ripgrep**: 高速なテキスト検索
- **ast-grep (sg)**: 構文木ベースのコード検索
- **semgrep**: セマンティックなコード分析

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを作成して変更内容について議論してください。

### 開発方針

- TypeScriptの厳格モードを使用（any型禁止）
- すべての機能にテストを追加
- コミット前に`deno task test:all:quiet`を実行
- テスト駆動開発（TDD）を推奨
