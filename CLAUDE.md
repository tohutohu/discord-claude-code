## 概要

Denoで開発されたDiscord Bot。
テストが充実しており、anyなどを使わないTypeScriptで書かれており、CIなども完備されているため、保守性が高いプロダクトになっている。

## アーキテクチャ

Discord Botのアーキテクチャは、以下のような構成になっている。

### Admin

Adminモジュールは以下の特徴を持つ

- プロセスで１つだけ起動される
- Discordから起動のスラッシュコマンドを受け取るとスレッドを作成し、それを担当するWorkerを起動する
  - Workerが進捗状況を通知できるように進捗コールバック（onProgress）を提供する
- Discordからスレッドに対してメッセージを受け取ると、担当のWorkerに対してメッセージを渡す
- Discordのボタンインタラクション（devcontainer選択、権限設定等）を処理する
- スレッドの終了とworktreeのクリーンアップ機能を提供する

### Worker

WorkerモジュールはAdminモジュールによって起動・管理される。
1つのWorkerが1つのスレッドを担当する。

- Claudeコマンドの実行と応答のストリーミング処理
- devcontainer環境での実行をサポート（DevcontainerClaudeExecutor）
- セッションログの永続化（JSON形式とraw JSONL形式）
- Git worktreeを使用した独立した作業環境の提供

### WorkspaceManager

WorkspaceManagerモジュールは作業ディレクトリの管理とデータ永続化を担当する。

- 構造化された作業ディレクトリ（repositories/、worktrees/、threads/、sessions/、audit/）を管理
- スレッド情報、Claudeセッションログ、監査ログのJSON永続化
- 再起動後の継続性とaudit log的な検証機能を提供

## 作業ディレクトリ構造

```
WORK_BASE_DIR/
├── repositories/          # クローンされたGitHubリポジトリ
│   └── {org}/
│       └── {repo}/
├── worktrees/            # Git worktree（各Workerの作業環境）
│   └── {thread_id}/
├── threads/              # スレッド情報の永続化
│   └── {thread_id}.json
├── sessions/             # Claudeセッションログ
│   ├── {thread_id}/
│   │   └── {session_id}.json
│   └── {repositoryFullName}/
│       └── {timestamp}_{sessionId}.jsonl  # raw JSONL形式
└── audit/               # 監査ログ（JSONL形式）
    └── {date}/
        └── activity.jsonl
```

## 必要なコマンド

このアプリケーションは起動時に以下のコマンドが利用可能かチェックし、必須コマンドが不足している場合はエラー終了します。

### 必須コマンド

- **git**: Gitバージョン管理システム
  - リポジトリのクローン・更新・worktree操作に使用
  - インストール: https://git-scm.com/downloads
- **claude**: Claude CLI ツール
  - Claude AIとの対話処理に使用
  - インストール: https://docs.anthropic.com/en/docs/claude-code

### 推奨コマンド

- **gh**: GitHub CLI（推奨）
  - リポジトリのメタデータ取得・プライベートリポジトリ対応に使用
  - 利用可能な場合はより洗練されたリポジトリ管理が可能
  - インストール: https://cli.github.com/
- **devcontainer**: Dev Container CLI
  - 開発コンテナサポートに使用
  - 利用可能な場合はdevcontainer.jsonに基づいた実行環境を提供
  - インストール: `npm install -g @devcontainers/cli`

アプリケーション起動時にシステム要件チェックが実行され、必須コマンドが不足している場合は適切なエラーメッセージとインストール手順が表示されます。

## 環境変数

- `DISCORD_TOKEN`: Discord Botのトークン
- `WORK_BASE_DIR`: 作業ディレクトリのベースパス（旧CLONE_BASE_DIR）

## 主要モジュール

### src/workspace.ts

- WorkspaceManager: 作業ディレクトリとデータ永続化の管理
- ThreadInfo: スレッド情報の型定義
- SessionLog: Claudeセッションログの型定義
- AuditEntry: 監査ログの型定義

### src/admin.ts

- Admin: Workerの作成・管理、メッセージルーティング
- WorkspaceManagerと統合してスレッド情報と監査ログを記録
- devcontainer設定の検出とユーザーへの選択UI提供
- 権限設定（--dangerously-skip-permissions）の選択機能

### src/worker.ts

- Worker: Claudeコマンド実行、セッションログ記録
- WorkspaceManagerと統合してセッションログを永続化
- ClaudeCommandExecutorインターフェースによる実行環境の抽象化
- ストリーミング対応による進捗のリアルタイム通知

### src/git-utils.ts

- GitRepository: リポジトリ情報の型定義
- parseRepository: リポジトリ名のパース
- ensureRepository: リポジトリのクローン・更新（WorkspaceManager対応）

### src/devcontainer.ts

- DevcontainerConfig: devcontainer設定の型定義
- checkDevcontainerConfig: devcontainer.jsonの検出と検証
- startDevcontainer: Dev Containerの起動（進捗ストリーミング対応）
- DevcontainerClaudeExecutor: devcontainer内でのClaude実行

## テストコマンド

```bash
# 全体チェック
deno task test    # フォーマット、lint、型チェック、テスト実行

# 個別実行
deno task fmt     # フォーマット
deno task lint    # lint
deno task check   # 型チェック
deno test --allow-read --allow-write --allow-env --allow-run  # テストのみ
```

## データ永続化機能

- **スレッド情報**: 作成時刻、最終アクティブ時刻、リポジトリ情報、ステータス、worktreePath
- **セッションログ**:
  - Claudeとのやり取り（コマンド、レスポンス、エラー）を詳細記録
  - JSON形式とraw JSONL形式の両方で保存
- **監査ログ**: Worker作成、メッセージ受信などのアクティビティをJSONL形式で記録
- **再起動対応**: アプリケーション再起動後もスレッド情報を復旧可能

## Dev Container対応

リポジトリに`.devcontainer/devcontainer.json`または`.devcontainer.json`が存在する場合、Dev Container環境内でClaudeを実行できます。

### 機能の特徴

- **自動検出**: リポジトリのdevcontainer設定を自動的に検出
- **インタラクティブな選択**: ボタンUIでdevcontainer使用/ローカル環境を選択可能
- **進捗表示**: devcontainerの構築進捗をリアルタイムで表示
- **環境の分離**: コンテナ内での隔離された実行環境を提供
- **プラットフォーム対応**: DOCKER_DEFAULT_PLATFORMを自動設定（M1/M2 Mac対応）

### 必要な設定

- devcontainer CLIのインストール: `npm install -g @devcontainers/cli`
- devcontainer.jsonにAnthropic features（`ghcr.io/anthropics/devcontainer-features/claude-code`）の追加を推奨

## 開発方針（最重要）

- ライブラリは導入前に徹底的に調査し情報をdocsディレクトリ以下にまとめる
- ライブラリは最新のものを使用する
- テスト駆動開発により実装を行う
- 最小単位ごとに `deno fmt`, `deno check`, `deno lint`, `deno test`
  を実行して成功することを確認してから先に進む
- any型やlintの無視をしない
- 指示された作業が終わるごとにコミットする

## 重要な実装パターン

### WorkspaceManagerの利用

```typescript
// WorkspaceManagerの初期化
const workspaceManager = new WorkspaceManager(env.WORK_BASE_DIR);
await workspaceManager.initialize();

// AdminとWorkerでの利用
const admin = new Admin(workspaceManager);
const worker = new Worker(name, workspaceManager, claudeExecutor);
```

### エラーハンドリング

- ファイル操作はtry-catchで適切にエラーハンドリング
- NotFoundエラーは許容し、適切なデフォルト値を返す
- ログ記録失敗は運用に影響させず、console.errorで記録のみ

### テスト作成時の注意

- 各テストで独立したテスト用ディレクトリを使用
- 適切な権限フラグ（--allow-read --allow-write --allow-env）を指定
- テスト後のクリーンアップを確実に実行
