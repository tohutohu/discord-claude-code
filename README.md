# Discord Claude Code Bot

Deno で開発された Discord
Bot。AdminとWorkerアーキテクチャを採用し、スレッドごとに独立したWorkerが割り当てられます。

## セットアップ

1. 環境変数の設定

```bash
cp .env.example .env
# .env ファイルを編集して Discord Bot のトークンを設定
```

2. 依存関係のインストール

```bash
deno cache src/main.ts
```

3. Botの起動（スラッシュコマンドは起動時に自動登録されます）

```bash
deno task start
```

## 開発

### テストの実行

```bash
deno task test
```

### コードフォーマット

```bash
deno task fmt
```

### 型チェック

```bash
deno task check
```

### リント

```bash
deno task lint
```

### 開発モード（ファイル変更監視）

```bash
deno task dev
```

## Git Hooks

このプロジェクトではコミット前に自動的にコード品質チェックを実行するGit
Hooksが設定されています。

### セットアップ

```bash
# Git Hooksをインストール
deno task setup-hooks
# または
./setup-hooks.sh
```

### 実行されるチェック

1. **pre-commit**: コミット前に以下を実行
   - `deno fmt --check`: フォーマットチェック
   - `deno lint`: リントチェック
   - `deno check`: 型チェック
   - `deno test`: テスト実行

2. **commit-msg**: `--no-verify`の使用を防止

3. **pre-push**: プッシュ前に同じチェックを再実行

### 手動での実行

```bash
# pre-commitチェックを手動で実行
deno task pre-commit
```

### 注意事項

- `--no-verify`オプションは使用できません
- devcontainer環境でも自動的にHooksが有効化されます
- 全てのチェックが成功した場合のみコミット/プッシュが可能です

## 機能

### devcontainer対応

このBotは対象リポジトリにdevcontainer.jsonが存在する場合、devcontainer内でClaudeを実行することができます。

#### 前提条件

- Docker が実行可能な環境
- devcontainer CLI のインストール
  ```bash
  npm install -g @devcontainers/cli
  ```

#### 推奨設定

対象リポジトリのdevcontainer.jsonに以下の設定を含めることを推奨します：

```json
{
  "name": "Your Project",
  "image": "mcr.microsoft.com/devcontainers/universal:latest",
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-cli:latest": {}
  }
}
```

#### 動作フロー

1. スレッド開始時に対象リポジトリをチェック
2. devcontainer.jsonが見つかった場合、使用するかを確認
3. ユーザーが同意した場合、devcontainerを起動
4. 以降のClaude実行はdevcontainer内で実行される

#### サポートする設定ファイル

- `.devcontainer/devcontainer.json`
- `.devcontainer.json`（ルート直下）

## 環境変数

| 変数名          | 説明                         | 必須 |
| --------------- | ---------------------------- | ---- |
| `DISCORD_TOKEN` | Discord Bot のトークン       | ✅   |
| `WORK_BASE_DIR` | 作業ディレクトリのベースパス | ✅   |

作業ディレクトリ構造:

```
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

## アーキテクチャ

- **Admin**:
  プロセスで1つだけ起動され、Workerの管理とメッセージルーティングを担当
- **Worker**: スレッドごとに作成され、メッセージの処理を担当
- 各Workerには `{形容詞}-{動物}` 形式の名前が付けられます（例: happy-panda）

## トラブルシューティング

### devcontainer関連

**Q: "devcontainer CLIがインストールされていません"と表示される**

A: 以下のコマンドでdevcontainer CLIをインストールしてください：

```bash
npm install -g @devcontainers/cli
```

**Q:
"anthropics/devcontainer-featuresが設定に含まれていません"という警告が表示される**

A: devcontainer.jsonに以下の設定を追加してください：

```json
{
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-cli:latest": {}
  }
}
```

**Q: devcontainerの起動に失敗する**

A: 以下を確認してください：

- Dockerが正常に動作している
- devcontainer.jsonの構文が正しい
- 必要な権限（Docker実行権限）がある
- ディスク容量が十分にある

**Q: devcontainer内でClaudeが動作しない**

A: 以下を確認してください：

- anthropics/devcontainer-featuresが正しく設定されている
- Claude CLIの認証が設定されている
- devcontainer内でネットワーク接続が可能

### 一般的な問題

**Q: Bot が Discord に接続できない**

A: 以下を確認してください：

- `DISCORD_TOKEN` が正しく設定されている
- Bot に必要な権限（メッセージ送信、スラッシュコマンド使用等）が付与されている

**Q: リポジトリのクローンに失敗する**

A: 以下を確認してください：

- Git が正しくインストールされている
- 対象リポジトリがパブリックリポジトリである
- ネットワーク接続が安定している
