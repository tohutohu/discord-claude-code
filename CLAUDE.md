# CLAUDE.md

## 🗂️ プロジェクト概要

Discord から **Claude Code** を並列操作し、複数 Git リポジトリに対するコード生成／修正を自動化する Deno 製 CLI ツールを開発する。ツールは **deno_tui** を用いた TUI を備え、各セッションの状態とログをリアルタイムで可視化する。

---

## 1. 前提・開発方針（必読）

1. **テスト**
   - すべてのモジュールに _in‑source_ の `Deno.test` を実装する。
   - `deno test -A --coverage` でカバレッジを取得し **90 % 未満なら CI 失敗** とする。

2. **ロギング**
   - `logger.ts` に構造化ロガー（Pretty / JSON）を実装し、TUI とファイルの二重シンクとする。
   - ログレベル: `TRACE` < `DEBUG` < `INFO` < `WARN` < `ERROR` < `FATAL`
   - ログファイルは `~/.claude-bot/logs/` に日付別で保存、7日間保持後自動削除

3. **TUI (deno_tui)**
   - ~~ink~~ → **deno_tui** を使用（InkはDenoでESMサポートが不完全なため）
   - CLI 起動と同時に起動し、アクティブセッション表・ログビュー・ヘルプを持つ。

4. **Dev Container**
   - 対象リポジトリには既に `devcontainer.json` が存在する前提とし、`devcontainer` CLI のラッパーのみ実装する。
   - Claude Code実行時の環境変数: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `TZ=Asia/Tokyo`

5. **リポジトリの扱い**
   - 設定ファイル(_YAML_)には **キャッシュ用ルートディレクトリのみ** を定義し、配下の **サブディレクトリに `.git` が存在するもの全て** をリポジトリとして扱う。
   - ローカルに存在しない場合は最初の `/claude start` で clone を試みる（URL は設定ファイルまたはユーザー入力から取得）。

6. **コードコメント**
   - **関数宣言・複雑なロジック・分岐** には日本語コメントを過不足なく記述し、Claude 生成時にも保持・更新する。

7. **CI / Git Hooks**
   - GitHub Actions で `fmt → lint → check → test → coverage` を実行。
   - `pre-commit` で `deno fmt && deno lint`、`commit-msg` で Conventional Commits 準拠を検証。

---

## 2. 設定ファイル (`claude-bot.yaml`)

```yaml
# Git リポジトリをキャッシュするルートディレクトリ
rootDir: ~/claude-work/repos

# 並列実行設定
parallel:
  maxSessions: 3 # 最大同時実行セッション数
  queueTimeout: 300 # キュー待機タイムアウト（秒）

# Discord設定
discord:
  # ギルドIDを指定（省略時は全ギルドで有効）
  guildIds: []
  # コマンドのプレフィックス（省略時は /claude）
  commandPrefix: /claude

# Claude設定
claude:
  # モデル名（省略時はデフォルト）
  model: claude-opus-4-20250514
  # タイムアウト（秒）
  timeout: 600

# ログ設定
logging:
  level: INFO # TRACE, DEBUG, INFO, WARN, ERROR, FATAL
  retentionDays: 7
  maxFileSize: 10MB

# リポジトリ設定（オプション）
repositories:
  # リポジトリ名とURLのマッピング（自動検出に追加）
  core-api: https://github.com/myorg/core-api.git
  web-admin: https://github.com/myorg/web-admin.git
```

---

## 3. リポジトリ検出 & クローン仕様

- `repoScanner.ts` を実装し、以下の責務を負う：

  1. `scanRepos(rootDir): RepoMeta[]`
     - `rootDir` 直下のディレクトリを対象に再帰 **2 階層まで** 探索（柔軟性向上）
     - `.git` が存在 → `git rev-parse --show-toplevel` で正当性確認
     - シンボリックリンクも追跡し、実体を確認
     - `name` はディレクトリ名、`path` は絶対パス、`url` は `git remote get-url origin`、`branch` は `git symbolic-ref --short HEAD`
     - エラー時は警告ログを出力し、スキップ

  2. `ensureRepo(name, url?): Promise<RepoPath>`
     - `scanRepos` に該当が無い場合：
       - 設定ファイルの `repositories` セクションを確認
       - それでも無い場合は `url` パラメータを使用（必須）
     - `git clone <url> <rootDir>/<name>` を実行
     - clone 成功後、fetch して最新化
     - 失敗時は詳細なエラーメッセージと共に例外をスロー

- **Autocomplete**: Slash コマンドで `repository` 引数を入力すると、`scanRepos` の結果 + 設定ファイルの `repositories` を提示

---

## 4. Discord インターフェース仕様

| # | シーン           | 表示内容                                                     | インタラクティブ要素                              |
| - | ---------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 1 | `/claude start`  | Embed `Claude セッション作成` (Repo/Thread/Status/Queue位置) | **開く** ボタン：スレッドへジャンプ               |
| 2 | スレッド開始     | Embed `セッション開始 🚀` + 初期設定情報                     | **/end** ボタン、**設定変更** ボタン              |
| 3 | 質問投稿         | Plain Message `> 指示`                                       | 進捗バー (5秒毎更新) + 経過時間                   |
| 4 | 実行中           | Embed `実行中...` + リアルタイムログ（最新5行）              | **キャンセル** ボタン                             |
| 5 | 完了             | Embed + プレビュー（差分統計付き）                           | **全文表示** / **差分確認** / **コミット** ボタン |
| 6 | エラー           | Embed (赤) `エラー詳細` + スタックトレース                   | **再試行** / **ログ全文** / **終了** ボタン       |
| 7 | `/claude list`   | Embed テーブル (Thread/Repo/Status/Uptime/Memory)            | 各行に **詳細** / **終了** ボタン                 |
| 8 | `/claude config` | 現在の設定表示                                               | **編集** ボタン → Modal で設定変更                |

---

## 5. TUI 画面レイアウト

```
┌─ Claude Bot v0.1.0 ─────────────────────────────────┐
│ Sessions: 2/3 | Queue: 1 | Uptime: 02:34:56         │
├────────┬────────────┬───────────┬────────┬─────────┤
│ Sel ▶  │ Thread ID  │ Repository│ Status │ Uptime  │
├────────┼────────────┼───────────┼────────┼─────────┤
│   ▷    │ 123..7890  │ core-api  │ 🟢 Run │ 00:12:34│
│        │ 987..3210  │ web-admin │ ⏸️ Wait│ 00:03:10│
│        │ 456..1234  │ auth-svc  │ ❌ Err │ 00:45:23│
└────────┴────────────┴───────────┴────────┴─────────┘
┌─ Logs [INFO+] ──────────────────────────────────────┐
│ 12:01:23 [INFO ] Clone core-api completed          │
│ 12:02:45 [INFO ] [123] Starting devcontainer...    │
│ 12:03:12 [DEBUG] [123] Container ID: abc123def     │
│ 12:03:15 [INFO ] [123] Claude generating diff...   │
│ 12:03:45 [ERROR] [456] Exit code 1: syntax error   │
└─────────────────────────────────────────────────────┘
┌─ Help ──────────────────────────────────────────────┐
│ ↑/↓:移動 Enter:詳細 d:終了 r:再起動 f:フィルタ     │  
│ l:ログレベル q:終了 ?:ヘルプ                       │
└─────────────────────────────────────────────────────┘
```

---

## 6. モジュール構成（改訂版）

| ファイル / ディレクトリ   | 役割                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| **cli.ts**                | Cliffy によるエントリポイント・サブコマンド解析                                     |
| **config.ts**             | 設定ファイル読み込み・検証・デフォルト値適用                                        |
| **tui/**                  | deno_tui コンポーネント群 (`app.ts`, `sessionTable.ts`, `logView.ts`, `helpBar.ts`) |
| **discord/**              | Discordeno ラッパー・コマンド/インタラクションハンドラ                              |
| **discord/embeds.ts**     | Embed生成ヘルパー関数群                                                             |
| **discord/components.ts** | ボタン・セレクトメニュー生成ヘルパー                                                |
| **repoScanner.ts**        | rootDir 以下のリポジトリ検出・clone/fetch                                           |
| **sessionManager.ts**     | Thread ↔ Worktree ↔ Repo 対応管理・永続化                                           |
| **worktree.ts**           | `git worktree` 操作ユーティリティ                                                   |
| **devcontainer.ts**       | `devcontainer` CLI ラッパー                                                         |
| **claudeRunner.ts**       | `claude -c` (継続モード) / `-p` (単一実行) ラッパー                                 |
| **parallelController.ts** | Semaphore実装・キュー管理                                                           |
| **logger.ts**             | 構造化ロガー（Pretty/JSON）・ファイル出力                                           |
| **utils/**                | 共通ユーティリティ（Git操作、文字列処理等）                                         |
| **types/**                | TypeScript型定義                                                                    |

---

## 7. Claude Code 実行詳細

### 実行モード

1. **継続モード** (`claude -c`): インタラクティブな対話形式
2. **プリントモード** (`claude -p "<prompt>"`): 単一コマンド実行

### 実行フロー

```bash
# 1. devcontainer起動
devcontainer up --workspace-folder /path/to/worktree

# 2. Claude Code実行（devcontainer内）
devcontainer exec --workspace-folder /path/to/worktree \
  bash -c "cd /workspace && claude -p 'ユーザーの指示'"

# 3. 出力をストリーム処理
# stdout → Discord投稿 + TUIログ表示
# stderr → エラーハンドリング
```

### エラーハンドリング

- devcontainer起動失敗 → 3回リトライ後、エラー報告
- Claude実行失敗 → exit codeに応じた処理
  - 1: 一般エラー → ユーザーに修正を促す
  - 130: ユーザーによる中断 → 正常終了扱い
  - その他: 詳細ログと共にエラー報告

---

## 8. セッション管理詳細

### セッションライフサイクル

```typescript
interface SessionState {
  INITIALIZING = "初期化中",  // リポジトリclone、worktree作成
  STARTING = "起動中",        // devcontainer起動
  READY = "準備完了",        // Claude実行待機
  RUNNING = "実行中",        // Claude実行中
  WAITING = "待機中",        // キュー待ち
  ERROR = "エラー",          // エラー状態
  COMPLETED = "完了",        // 正常終了
  CANCELLED = "キャンセル"   // ユーザーによる中断
}
```

### セッションデータ永続化

```json
// ~/.claude-bot/sessions.json
{
  "sessions": {
    "thread_id_123": {
      "repository": "core-api",
      "worktreePath": "/path/to/worktree",
      "containerId": "abc123def",
      "state": "RUNNING",
      "createdAt": "2025-06-02T10:00:00Z",
      "updatedAt": "2025-06-02T10:05:00Z",
      "metadata": {
        "userId": "discord_user_id",
        "guildId": "discord_guild_id"
      }
    }
  }
}
```

---

## 9. 詳細タスクリスト（改訂版）

> **凡例**
>
> - **\[x]** = 追加・修正項目
> - **\[ ]** = 未完了
> - インデント 2 つめが "コミット単位"、3 つめが "コード変更単位"

### PR‑1 ⛏️ リポジトリ初期化 & CI

- [ ] **1.1 プロジェクトスケルトン**
  - [ ] `README.md` を作成し以下を記載
    - [ ] ツール概要・動作イメージ GIF
    - [ ] Quick Start 手順 (`deno task start`)
    - [ ] システム要件（Deno 2.0+, Docker, devcontainer CLI）
  - [ ] `LICENSE` (MIT) を追加
  - [ ] `.gitignore` (Deno/VSCode/OS/ログファイル) を用意

- [ ] **1.2 `deno.json` セットアップ**
  - [ ] `imports` に依存関係を定義（import map形式）
  - [ ] `tasks` セクションに以下を登録
    - [ ] `start`: `deno run -A cli.ts run`
    - [ ] `dev`: `deno run -A --watch cli.ts run`
    - [ ] `fmt`: `deno fmt`
    - [ ] `lint`: `deno lint`
    - [ ] `check`: `deno check **/*.ts`
    - [ ] `test`: `deno test -A`
    - [ ] `cov`: `deno test -A --coverage=coverage`

- [ ] **1.3 Git Hooks**
  - [ ] `scripts/install-hooks.ts` を作成（Deno製フック管理）
  - [ ] `pre-commit` で `deno fmt --check && deno lint`
  - [ ] `commit-msg` で Conventional Commits 検証
  - [ ] `prepare-commit-msg` でブランチ名からプレフィックス自動追加

- [ ] **1.4 GitHub Actions**
  - [ ] `.github/workflows/ci.yml` を新規作成
    - [ ] matrix: `ubuntu-latest`, `macos-latest`
    - [ ] Deno 2.0+ のセットアップ
    - [ ] step: `deno fmt --check`
    - [ ] step: `deno lint`
    - [ ] step: `deno task check`
    - [ ] step: `deno task cov --lcov > coverage.lcov`
    - [ ] step: Codecov upload with 90% threshold

### PR‑2 🚀 CLI & TUI 基盤

- [ ] **2.1 依存一元化**
  - [ ] `deps.ts` を作成
    - [ ] Cliffy: `https://deno.land/x/cliffy@v1.0.0-rc.4/mod.ts`
    - [ ] deno_tui: `https://deno.land/x/tui@2.1.5/mod.ts`
    - [ ] std: `https://deno.land/std@0.224.0/mod.ts`

- [ ] **2.2 設定管理**
  - [ ] `config.ts` で YAML パース（std/yaml）
  - [ ] スキーマ検証とデフォルト値適用
  - [ ] 環境変数オーバーライド対応

- [ ] **2.3 CLI 雛形**
  - [ ] `cli.ts` にサブコマンド実装
    - [ ] `run`: TUI起動（デフォルト）
    - [ ] `list`: セッション一覧（JSON出力対応）
    - [ ] `end <thread-id>`: セッション終了
    - [ ] `clean`: 終了済みセッション・worktree削除
    - [ ] `version`: バージョン表示
  - [ ] グローバルオプション
    - [ ] `--config`: 設定ファイルパス
    - [ ] `--verbose`: ログレベルDEBUG
    - [ ] `--quiet`: ログレベルERROR

- [ ] **2.4 deno_tui 実装**
  - [ ] `tui/app.ts` メインコンポーネント
    - [ ] 3ペイン構成（ヘッダー、テーブル、ログ）
    - [ ] キーイベントハンドリング
  - [ ] `tui/sessionTable.ts` セッション一覧
    - [ ] リアルタイム更新（1秒毎）
    - [ ] ステータスアイコン表示
  - [ ] `tui/logView.ts` ログビューア
    - [ ] ログレベルフィルタ
    - [ ] 自動スクロール
  - [ ] `tui/helpBar.ts` ヘルプバー

### PR‑3 🌐 Discord 基盤

- [ ] **3.1 Discord 接続**
  - [ ] `discord/client.ts` で Discordeno 初期化
  - [ ] Intents: `Guilds`, `GuildMessages`, `MessageContent`
  - [ ] エラー時の再接続処理（指数バックオフ）

- [ ] **3.2 Slash コマンド**
  - [ ] `discord/commands/start.ts`
    - [ ] 引数: `repository` (autocomplete), `branch` (optional)
    - [ ] 権限チェック（Manage Messages）
    - [ ] キュー待機時の位置表示
  - [ ] `discord/commands/list.ts`
    - [ ] ページネーション対応（10件/ページ）
  - [ ] `discord/commands/config.ts`
    - [ ] 設定表示・変更Modal

- [ ] **3.3 インタラクション**
  - [ ] `discord/interactions.ts` ボタン・Modal処理
  - [ ] デバウンス処理（連打対策）
  - [ ] エフェメラル応答の活用

### PR‑3.5 🖼️ Discord UX 拡張

- [ ] **3.5.1 Embed生成**
  - [ ] `discord/embeds.ts`
    - [ ] 色定義（成功: 緑、エラー: 赤、実行中: 青）
    - [ ] フッターにタイムスタンプ
    - [ ] フィールド数制限対応（25個まで）

- [ ] **3.5.2 進捗表示**
  - [ ] プログレスバー生成関数
  - [ ] 更新頻度: 5秒（rate limit考慮）
  - [ ] アニメーション: `[▓▓▓░░] 60% (03:45)`

- [ ] **3.5.3 出力分割**
  - [ ] 1900文字で自動分割
  - [ ] コードブロック維持
  - [ ] 分割メッセージ番号付与

### PR‑3.8 📚 リポジトリ検出 & クローン

- [ ] **3.8.1 `repoScanner.ts`**
  - [ ] 並列スキャン（Promise.all）
  - [ ] `.gitignore` されたディレクトリをスキップ
  - [ ] パフォーマンス: 1000リポジトリを5秒以内

- [ ] **3.8.2 クローン処理**
  - [ ] 浅いクローン (`--depth 1`) オプション
  - [ ] SSH/HTTPS自動判定
  - [ ] プログレス表示

- [ ] **3.8.3 Autocomplete**
  - [ ] fuzzy検索対応
  - [ ] 最近使用したリポジトリを上位表示

### PR‑4 📂 セッション / Worktree

- [ ] **4.1 `sessionManager.ts`**
  - [ ] 状態遷移の厳密な管理
  - [ ] イベントエミッター実装
  - [ ] 自動リカバリー機能

- [ ] **4.2 `worktree.ts`**
  - [ ] worktree名に timestamp 付与（重複回避）
  - [ ] 定期的なprune実行（1日1回）
  - [ ] ディスク容量チェック

- [ ] **4.3 並列制御**
  - [ ] `parallelController.ts` Semaphore実装
  - [ ] キューイング with priority
  - [ ] デッドロック検出

### PR‑5 🐳 DevContainer

- [ ] **5.1 `devcontainer.ts`**
  - [ ] health check実装
  - [ ] リソース制限設定（CPU/Memory）
  - [ ] ボリュームマウント最適化

- [ ] **5.2 エラー処理**
  - [ ] Dockerfile不在時の対処
  - [ ] ポート競合の自動解決
  - [ ] タイムアウト処理（設定可能）

### PR‑6 🤖 Claude Runner

- [ ] **6.1 `claudeRunner.ts`**
  - [ ] ストリーミング出力のバッファリング
  - [ ] プロンプトテンプレート機能
  - [ ] 実行履歴の保存

- [ ] **6.2 出力パース**
  - [ ] diff形式の認識と整形
  - [ ] ファイル作成/削除の検出
  - [ ] 構文ハイライト（Discord用）

### PR‑7 ⚙️ 監視 & メトリクス

- [ ] **7.1 メトリクス収集**
  - [ ] 実行時間、成功率、エラー率
  - [ ] リソース使用量（CPU/Memory）
  - [ ] Prometheus形式でエクスポート

- [ ] **7.2 アラート**
  - [ ] エラー率閾値超過時にDiscord通知
  - [ ] リソース枯渇警告

### PR‑8 🔒 ロギング & セキュリティ

- [ ] **8.1 ロガー拡張**
  - [ ] コンテキスト情報付与（session ID等）
  - [ ] センシティブ情報のマスキング
  - [ ] 構造化ログのクエリ機能

- [ ] **8.2 セキュリティ**
  - [ ] API キーの暗号化保存
  - [ ] rate limit対策
  - [ ] 入力サニタイゼーション

### PR‑9 🧪 テスト & 品質

- [ ] **9.1 単体テスト**
  - [ ] モック戦略（MSW for HTTP, fake-timers）
  - [ ] スナップショットテスト（TUI）
  - [ ] プロパティベーステスト（fuzzing）

- [ ] **9.2 統合テスト**
  - [ ] Docker Compose でテスト環境構築
  - [ ] E2Eシナリオ（happy path + edge cases）

- [ ] **9.3 パフォーマンステスト**
  - [ ] 負荷テスト（100セッション同時実行）
  - [ ] メモリリークチェック

### PR‑10 📦 リリース & 運用

- [ ] **10.1 ビルド**
  - [ ] `deno compile` 最適化
  - [ ] 実行ファイルサイズ削減（tree shaking）
  - [ ] 起動時間最適化

- [ ] **10.2 配布**
  - [ ] Homebrew Formula
  - [ ] AUR Package
  - [ ] Docker Image

- [ ] **10.3 ドキュメント**
  - [ ] アーキテクチャ図（Mermaid）
  - [ ] トラブルシューティングガイド
  - [ ] 動画チュートリアル

- [ ] **10.4 監視・運用**
  - [ ] ヘルスチェックエンドポイント
  - [ ] グレースフルシャットダウン
  - [ ] ログローテーション自動化

---

## 10. 実装上の注意事項

### パフォーマンス

- リポジトリスキャンは並列実行し、大規模環境でも高速動作
- Worktree作成は非同期・並列実行
- Discord API rate limitを考慮した更新頻度

### エラーハンドリング

- すべての外部コマンド実行は失敗を想定
- リトライは指数バックオフ
- ユーザーへのエラーメッセージは具体的かつ実行可能

### セキュリティ

- APIキーは環境変数から取得、ログに出力しない
- ユーザー入力は必ずサニタイズ
- ファイルパスは絶対パスに正規化

### 拡張性

- プラグインアーキテクチャを意識した設計
- 各モジュールは疎結合
- 設定は環境変数でオーバーライド可能

---

## 11. 参考リンク（更新版）

| カテゴリ                     | リンク                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Deno**                     | [https://deno.com/manual](https://deno.com/manual)                                                                 |
| **Deno – テスト/カバレッジ** | [https://docs.deno.com/runtime/manual/basics/testing](https://docs.deno.com/runtime/manual/basics/testing)         |
| **deno_tui**                 | [https://deno.land/x/tui](https://deno.land/x/tui)                                                                 |
| **Cliffy**                   | [https://cliffy.io/](https://cliffy.io/)                                                                           |
| **Discordeno**               | [https://github.com/discordeno/discordeno](https://github.com/discordeno/discordeno)                               |
| **Discord API**              | [https://discord.com/developers/docs](https://discord.com/developers/docs)                                         |
| **devcontainer CLI**         | [https://github.com/devcontainers/cli](https://github.com/devcontainers/cli)                                       |
| **Git Worktree**             | [https://git-scm.com/docs/git-worktree](https://git-scm.com/docs/git-worktree)                                     |
| **Claude Code**              | [https://www.anthropic.com/claude-code](https://www.anthropic.com/claude-code)                                     |
| **Claude Code Docs**         | [https://docs.anthropic.com/en/docs/claude-code/overview](https://docs.anthropic.com/en/docs/claude-code/overview) |

---

> **メンテナンス指針**
>
> - 新規 PR は常にこのドキュメントのタスクリストを更新してから作成すること
> - Claude へ大きなコード生成を依頼する場合は **コンテキスト** と **差分** を明示し、生成物にコメントが含まれているか必ず確認すること
> - 定期的に依存関係を更新し、セキュリティ脆弱性をチェックすること
