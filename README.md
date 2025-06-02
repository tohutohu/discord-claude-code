# discord-claude-code

Discord から **Claude Code** を並列操作し、複数 Git リポジトリに対するコード生成／修正を自動化する Deno 製 CLI ツール。**deno_tui** を用いた TUI でセッションの状態とログをリアルタイムで可視化します。

![デモ動画](https://placehold.co/800x400?text=Demo+GIF+Here)

## ✨ 特徴

- 🚀 **並列実行**: 最大3つのClaude Codeセッションを同時実行
- 💬 **Discord統合**: Slashコマンドで簡単操作
- 📊 **TUIダッシュボード**: リアルタイムでセッション状態を監視
- 🐳 **Dev Container対応**: 各リポジトリの開発環境を自動構築
- 🌳 **Git Worktree**: リポジトリごとに独立した作業環境
- 📝 **構造化ログ**: 詳細なログでトラブルシューティングが容易

## 🚦 システム要件

- **Deno** 2.0 以上
- **Docker** & **Docker Compose**
- **devcontainer CLI**
- **Git** 2.20 以上（worktree機能）
- **Discord Bot Token**
- **Anthropic API Key**

## 🚀 Quick Start

### 1. 環境変数の設定

```bash
export ANTHROPIC_API_KEY="your-api-key"
export DISCORD_TOKEN="your-bot-token"
export GITHUB_TOKEN="your-github-token"  # Optional
```

### 2. 設定ファイルの作成

```bash
cp claude-bot.example.yaml ~/.claude-bot/claude-bot.yaml
# エディタで設定を編集
```

### 3. 起動

```bash
# インストール & 起動
deno task start

# 開発モード（ファイル変更監視）
deno task dev
```

## 📖 使い方

### Discord コマンド

```
/claude start <repository> [branch]  # 新しいセッションを開始
/claude list                        # アクティブなセッション一覧
/claude config                      # 設定の確認・変更
```

### TUI キーボードショートカット

| キー    | 動作               |
| ------- | ------------------ |
| `↑/↓`   | セッション選択     |
| `Enter` | セッション詳細表示 |
| `d`     | セッション終了     |
| `r`     | セッション再起動   |
| `f`     | ログフィルタ       |
| `l`     | ログレベル変更     |
| `?`     | ヘルプ表示         |
| `q`     | 終了               |

## 🔧 開発

```bash
# フォーマット
deno task fmt

# リント
deno task lint

# 型チェック
deno task check

# テスト実行
deno task test

# カバレッジ付きテスト
deno task cov
```

## 📁 プロジェクト構成

```
discord-claude-code/
├── cli.ts                  # CLIエントリポイント
├── config.ts               # 設定管理
├── tui/                    # TUIコンポーネント
│   ├── app.ts             # メインアプリケーション
│   ├── sessionTable.ts    # セッション一覧
│   └── logView.ts         # ログビューア
├── discord/                # Discord関連
│   ├── client.ts          # Discordクライアント
│   ├── commands/          # Slashコマンド
│   └── embeds.ts          # Embed生成
├── repoScanner.ts         # リポジトリ検出
├── sessionManager.ts      # セッション管理
├── worktree.ts           # Git worktree操作
├── devcontainer.ts       # Dev Container制御
├── claudeRunner.ts       # Claude Code実行
└── logger.ts             # ロギング
```

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'feat: add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを作成

## 📄 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) を参照してください。

## 🙏 謝辞

- [Claude Code](https://www.anthropic.com/claude-code) by Anthropic
- [Deno](https://deno.com) ランタイム
- [Discordeno](https://github.com/discordeno/discordeno) Discord APIライブラリ
- [deno_tui](https://deno.land/x/tui) TUIフレームワーク
