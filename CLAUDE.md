# CLAUDE.md

## 🗂️ プロジェクト概要

Discord から **Claude Code** を並列操作し、複数 Git リポジトリに対するコード生成／修正を自動化する Deno 製 CLI ツールを開発する。ツールは **deno_tui** を用いた TUI を備え、各セッションの状態とログをリアルタイムで可視化する。

---

## 1. 前提・開発方針（必読）

1. **テスト**
   - すべてのモジュールに対して、**同じディレクトリに `*.test.ts` ファイルを配置**する（例: `logger.ts` に対して `logger.test.ts`）。
   - テストファイルはアプリケーションコードと同じディレクトリに配置し、コードとテストの関連性を明確にする。
   - **機能がちゃんとテストされていればカバレッジ率は気にしない**
   - 品質重視でテストを記述する。

2. **ロギング**
   - `logger.ts` に構造化ロガー（Pretty / JSON）を実装し、TUI とファイルの二重シンクとする。
   - ログレベル: `TRACE` < `DEBUG` < `INFO` < `WARN` < `ERROR` < `FATAL`
   - ログファイルは `~/.claude-bot/logs/` に日付別で保存、7日間保持後自動削除

3. **TUI**
   - ink/ink-uiを使ってTUIを実装する
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
   - **コミットする前に型チェック・フォーマット・リント・テストがエラーにならないことを確認し、健全な状態のソースコードのコミットのみが残るようにします。**
   - **コミットフックを無視することは許可されていません**
   - **リントエラーを無視するようなコメントを追加したり、any型を利用して型エラーをごまかすことは最も避けるべき行為**

8. **ライブラリ**
   - ライブラリは調査したうえで最新のものを使用する
   - ライブラリの読み込みはdeno公式に存在すればそれを、npmからは `npm:パッケージ名` 形式で読み込む
   - deno docコマンドを利用して、ライブラリから利用できる関数やクラスのドキュメントを確認する
   - 使用したことのないライブラリは使用前にリポジトリのREADME.mdやドキュメントを徹底的に調査し、使い方を理解する
   - 検索エンジンでの調査も活用し、ライブラリの使い方やベストプラクティスを学ぶ

9. **実装手順**
   - 可能な限り細かい単位でfmt,lint,check,testを行い、問題が残ったまま他の箇所の実装を行うことがないようにする
   - 実装ガイドの1タスクごとに `deno fmt`, `deno lint`, `deno check`, `deno test` を実行するくらいが基準
   - 型エラーを --no-check で無視することは許可されていません
   - fmt,lint,check,testのいずれかでエラーが発生した場合は、必ずそのエラーを解消してから次の実装に進むこと
   - エラーの解消のために無理やり辻褄合わせのような変更や対応を避ける

### PR‑1 ⛏️ リポジトリ初期化 & CI

- [x] **1.1 プロジェクトスケルトン**
  - [x] `README.md` を作成し以下を記載
    - [x] ツール概要・動作イメージ GIF
    - [x] Quick Start 手順 (`deno task start`)
    - [x] システム要件（Deno 2.0+, Docker, devcontainer CLI）
  - [x] `LICENSE` (MIT) を追加
  - [x] `.gitignore` (Deno/VSCode/OS/ログファイル) を用意

- [x] **1.2 `deno.json` セットアップ**
  - [x] `imports` に依存関係を定義（import map形式）
  - [x] `tasks` セクションに以下を登録
    - [x] `start`: `deno run -A cli.ts run`
    - [x] `dev`: `deno run -A --watch cli.ts run`
    - [x] `fmt`: `deno fmt`
    - [x] `lint`: `deno lint`
    - [x] `check`: `deno check **/*.ts`
    - [x] `test`: `deno test -A`
    - [x] `cov`: `deno test -A --coverage=coverage`

- [x] **1.3 Git Hooks**
  - [x] `scripts/install-hooks.ts` を作成（Deno製フック管理）
  - [x] `pre-commit` で `deno fmt --check && deno lint`
  - [x] `commit-msg` で Conventional Commits 検証
  - [x] `prepare-commit-msg` でブランチ名からプレフィックス自動追加

- [x] **1.4 GitHub Actions**
  - [x] `.github/workflows/ci.yml` を新規作成
    - [x] matrix: `ubuntu-latest`, `macos-latest`
    - [x] Deno 2.0+ のセットアップ
    - [x] step: `deno fmt --check`
    - [x] step: `deno lint`
    - [x] step: `deno task check`
    - [x] step: `deno task cov --lcov > coverage.lcov`
    - [x] step: Codecov upload with 90% threshold

### PR‑2 🚀 CLI & TUI 基盤

- [x] **2.1 依存一元化**
  - [x] `deps.ts` を作成
    - [x] Cliffy: `https://deno.land/x/cliffy@v1.0.0-rc.4/mod.ts`
    - [x] deno_tui: `https://deno.land/x/tui@2.1.5/mod.ts`
    - [x] std: `https://deno.land/std@0.224.0/mod.ts`

- [x] **2.2 設定管理**
  - [x] `config.ts` で YAML パース（std/yaml）
  - [x] スキーマ検証とデフォルト値適用
  - [x] 環境変数オーバーライド対応

- [x] **2.3 CLI 雛形**
  - [x] `cli.ts` にサブコマンド実装
    - [x] `run`: TUI起動（デフォルト）
    - [x] `list`: セッション一覧（JSON出力対応）
    - [x] `end <thread-id>`: セッション終了
    - [x] `clean`: 終了済みセッション・worktree削除
    - [x] `version`: バージョン表示
  - [x] グローバルオプション
    - [x] `--config`: 設定ファイルパス
    - [x] `--verbose`: ログレベルDEBUG
    - [x] `--quiet`: ログレベルERROR

- [x] **2.4 deno_tui 実装**
  - [x] `tui/app.ts` メインコンポーネント（簡略版）
    - [x] 基本構造の実装
    - [ ] キーイベントハンドリング（実装保留）
  - [x] `tui/sessionTable.ts` セッション一覧（簡略版）
    - [x] 基本構造の実装
    - [ ] リアルタイム更新（実装保留）
  - [x] `tui/logView.ts` ログビューア（簡略版）
    - [x] 基本構造の実装
    - [ ] ログレベルフィルタ（実装保留）
  - [x] `tui/helpBar.ts` ヘルプバー（簡略版）

### PR‑3 🌐 Discord 基盤

- [x] **3.1 Discord 接続**
  - [x] `discord/client.ts` で Discordeno 初期化
  - [x] Intents: `Guilds`, `GuildMessages`, `MessageContent`
  - [x] エラー時の再接続処理（指数バックオフ）

- [x] **3.2 Slash コマンド**
  - [x] `discord/commands/start.ts`
    - [x] 引数: `repository` (autocomplete), `branch` (optional)
    - [x] 権限チェック（Manage Messages）
    - [x] キュー待機時の位置表示
  - [x] `discord/commands/list.ts`
    - [x] ページネーション対応（10件/ページ）
  - [x] `discord/commands/config.ts`
    - [x] 設定表示・変更Modal

- [x] **3.3 インタラクション**
  - [x] `discord/interactions.ts` ボタン・Modal処理
  - [x] デバウンス処理（連打対策）
  - [x] エフェメラル応答の活用

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
