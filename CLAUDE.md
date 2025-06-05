## 概要

Denoで開発されたDiscord Bot。
テストが充実しており、anyなどを使わないTypeScriptで書かれており、CIなども完備されているため、保守性が高いプロダクトになっている。

## アーキテクチャ

Discord Botのアーキテクチャは、以下のような構成になっている。

### Admin

Adminモジュールは以下の特徴を持つ

- プロセスで１つだけ起動される
- Discordから起動のスラッシュコマンドを受け取るとスレッドを作成し、それを担当するWorkerを起動する
  - Workerがスレッドに対してメッセージを返信できるようにコールバックを提供する
- Discordからスレッドに対してメッセージを受け取ると、担当のWorkerに対してメッセージを渡す

### Worker

WorkerモジュールはAdminモジュールによって起動・管理される。
1つのWorkerが1つのスレッドを担当する。

### WorkspaceManager

WorkspaceManagerモジュールは作業ディレクトリの管理とデータ永続化を担当する。

- 構造化された作業ディレクトリ（repositories/、threads/、sessions/、audit/）を管理
- スレッド情報、Claudeセッションログ、監査ログのJSON永続化
- 再起動後の継続性とaudit log的な検証機能を提供

## 作業ディレクトリ構造

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

### src/worker.ts

- Worker: Claudeコマンド実行、セッションログ記録
- WorkspaceManagerと統合してセッションログを永続化

### src/git-utils.ts

- GitRepository: リポジトリ情報の型定義
- parseRepository: リポジトリ名のパース
- ensureRepository: リポジトリのクローン・更新（WorkspaceManager対応）

## テストコマンド

```bash
# 全体チェック
deno task test    # フォーマット、lint、型チェック、テスト実行

# 個別実行
deno task fmt     # フォーマット
deno task lint    # lint
deno task check   # 型チェック
deno test --allow-read --allow-write --allow-env  # テストのみ
```

## データ永続化機能

- **スレッド情報**: 作成時刻、最終アクティブ時刻、リポジトリ情報、ステータス
- **セッションログ**:
  Claudeとのやり取り（コマンド、レスポンス、エラー）を詳細記録
- **監査ログ**: Worker作成、メッセージ受信などのアクティビティをJSONL形式で記録
- **再起動対応**: アプリケーション再起動後もスレッド情報を復旧可能

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
