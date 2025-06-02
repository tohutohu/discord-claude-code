# CLAUDE.md

## 🗂️ プロジェクト概要

Discord から **Claude Code** を並列操作し、複数 Git リポジトリに対するコード生成／修正を自動化する Deno 製 CLI ツールを開発する。ツールは **deno_tui** を用いた TUI を備え、各セッションの状態とログをリアルタイムで可視化する。

---

## 1. 前提・開発方針（必読）

1. **テスト**
   - すべてのモジュールに対して、**同じディレクトリに `*.test.ts` ファイルを配置**する（例: `logger.ts` に対して `logger.test.ts`）。
   - テストファイルはアプリケーションコードと同じディレクトリに配置し、コードとテストの関連性を明確にする。
   - **機能がちゃんとテストされていればカバレッジ率は気にしない** - 品質重視でテストを記述する。

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
   - **コミットする前にフォーマット・リント・テストがエラーにならないことを確認し、健全な状態のソースコードのコミットのみが残るようにします。**

[以下、既存のドキュメント内容が続く...]
