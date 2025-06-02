# Claude Bot トラブルシューティングガイド

## 🔍 一般的な問題と解決方法

### 起動時の問題

#### 1. Discord ボットが起動しない

**症状:**

```
Error: Invalid token
```

**原因と解決策:**

- **DISCORD_TOKEN が設定されていない**
  ```bash
  export DISCORD_TOKEN=your_bot_token_here
  ```
- **トークンが無効**
  - Discord Developer Portal でトークンを再生成
  - Bot の権限を確認（Manage Messages, Send Messages, Use Slash Commands）

#### 2. Claude API 接続エラー

**症状:**

```
Error: ANTHROPIC_API_KEY is required
```

**原因と解決策:**

- **API キーが設定されていない**
  ```bash
  export ANTHROPIC_API_KEY=your_api_key_here
  ```
- **API キーが無効または期限切れ**
  - Anthropic Console で新しいキーを発行
  - 残高を確認

#### 3. devcontainer CLI が見つからない

**症状:**

```
Error: devcontainer command not found
```

**解決策:**

```bash
# devcontainer CLI をインストール
npm install -g @devcontainers/cli

# または Docker Extension を使用
# https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers
```

### セッション管理の問題

#### 4. セッションが INITIALIZING でスタックする

**症状:**

- セッションが初期化中で止まる
- TUI で状態が変わらない

**診断方法:**

```bash
# ログを確認
tail -f ~/.claude-bot/logs/claude-bot-$(date +%Y-%m-%d).log

# セッション詳細を確認
curl http://localhost:3000/health
```

**原因と解決策:**

- **Git リポジトリのクローンに失敗**
  ```bash
  # SSH キーの設定を確認
  ssh -T git@github.com

  # または HTTPS 認証を設定
  git config --global credential.helper store
  ```
- **ディスク容量不足**
  ```bash
  # ディスク容量を確認
  df -h

  # 古いワークツリーを削除
  deno run -A cli.ts clean
  ```

#### 5. セッションが WAITING でスタックする

**症状:**

- セッションがキュー待ちで進まない
- 実行中セッション数が上限に達していない

**診断方法:**

```bash
# 並列制御の状態を確認
curl http://localhost:3000/health | jq '.components.parallelController'
```

**解決策:**

- **デッドロック状態**
  ```bash
  # ボットを再起動
  deno run -A cli.ts end --all
  ```
- **設定の maxSessions を確認**
  ```yaml
  # ~/.claude-bot/claude-bot.yaml
  parallel:
    maxSessions: 3 # この値を増やす
  ```

### DevContainer の問題

#### 6. コンテナの起動に失敗する

**症状:**

```
Error: Failed to start devcontainer
```

**診断方法:**

```bash
# Docker の状態を確認
docker ps -a

# Docker ログを確認
docker logs <container_id>

# devcontainer.json を確認
cat .devcontainer/devcontainer.json
```

**解決策:**

- **Docker が起動していない**
  ```bash
  # Docker を起動
  sudo systemctl start docker

  # または Docker Desktop を起動
  ```
- **devcontainer.json が無効**
  ```bash
  # JSON 構文をチェック
  cat .devcontainer/devcontainer.json | jq .
  ```
- **ベースイメージが見つからない**
  ```bash
  # イメージを手動でプル
  docker pull mcr.microsoft.com/devcontainers/typescript-node:latest
  ```

#### 7. コンテナ内で Claude が見つからない

**症状:**

```
Error: claude: command not found
```

**解決策:**

- **Claude CLI をインストール**
  ```dockerfile
  # devcontainer.json に追加
  "postCreateCommand": "curl -fsSL https://claude.ai/install.sh | sh"
  ```
- **PATH を設定**
  ```bash
  export PATH="$PATH:$HOME/.local/bin"
  ```

### パフォーマンスの問題

#### 8. 実行が遅い

**症状:**

- Claude の応答が遅い
- セッション作成に時間がかかる

**診断方法:**

```bash
# システムリソースを確認
curl http://localhost:3000/health | jq '.system'

# メトリクスを確認
curl http://localhost:3000/metrics | grep claude_execution_duration
```

**解決策:**

- **CPU・メモリ不足**
  ```bash
  # リソース使用量を確認
  top

  # 不要なコンテナを停止
  docker container prune
  ```
- **並列実行数を調整**
  ```yaml
  # ~/.claude-bot/claude-bot.yaml
  parallel:
    maxSessions: 2 # 値を減らす
  ```
- **リポジトリキャッシュをクリア**
  ```bash
  rm -rf ~/.claude-bot/repos/*
  ```

#### 9. メモリリーク

**症状:**

- 長時間実行後にメモリ使用量が増加
- システムが不安定になる

**診断方法:**

```bash
# メモリ使用量の推移を監視
watch -n 5 'curl -s http://localhost:3000/health | jq ".system.memoryUsage"'

# プロセスのメモリ使用量
ps aux | grep deno
```

**解決策:**

- **定期的な再起動**
  ```bash
  # cron で定期再起動を設定
  0 3 * * * systemctl restart claude-bot
  ```
- **セッション数を制限**
  ```yaml
  parallel:
    maxSessions: 1
    queueTimeout: 60
  ```

### ネットワークの問題

#### 10. Rate Limit エラー

**症状:**

```
Error: Rate limit exceeded
```

**解決策:**

- **API 使用量を確認**
  ```bash
  # ユーザーごとの制限をチェック
  curl http://localhost:3000/health | jq '.components.monitoring.details'
  ```
- **制限を調整**
  ```typescript
  // 設定で制限を緩和
  rateLimiter.addConfig('claude_execution', {
    windowSeconds: 3600,
    maxRequests: 20, // 増やす
  });
  ```

#### 11. Discord API エラー

**症状:**

```
Error: 429 Too Many Requests
```

**解決策:**

- **メッセージ更新頻度を調整**
  ```typescript
  // 更新間隔を長くする
  const UPDATE_INTERVAL = 10000; // 10秒
  ```
- **バッチ処理を使用**
  ```typescript
  // 複数の更新をまとめる
  await discord.bulkUpdateMessages(updates);
  ```

## 🛠️ デバッグ手順

### 1. ログレベルを上げる

```bash
# DEBUG レベルでログを出力
export LOG_LEVEL=DEBUG
deno run -A cli.ts run --verbose
```

```yaml
# 設定ファイルで指定
logging:
  level: DEBUG
```

### 2. ヘルスチェックを使用

```bash
# 全体の健康状態を確認
curl http://localhost:3000/health | jq .

# 特定のコンポーネントをチェック
curl http://localhost:3000/health | jq '.components.sessionManager'
```

### 3. メトリクスを監視

```bash
# Prometheus メトリクスを確認
curl http://localhost:3000/metrics

# 特定のメトリクスをフィルタ
curl http://localhost:3000/metrics | grep claude_executions_total
```

### 4. TUI でリアルタイム監視

```bash
# TUI ダッシュボードを起動
deno run -A cli.ts run

# ログレベルを変更（l キーを押す）
# セッション詳細を表示（Enter キーを押す）
```

## 🧪 テスト手順

### 単体テスト

```bash
# 全テストを実行
deno test -A

# 特定のモジュールをテスト
deno test -A sessionManager.ts

# カバレッジ付きでテスト
deno test -A --coverage=coverage
```

### 統合テスト

```bash
# 統合テストを実行
deno test -A integration-tests.ts

# E2E テストを実行
RUN_E2E_TESTS=true deno test -A
```

### 負荷テスト

```bash
# 負荷テストを実行
RUN_LOAD_TESTS=true deno test -A integration-tests.ts

# メモリリークテスト
RUN_MEMORY_TESTS=true deno test -A integration-tests.ts
```

## 📋 設定の確認

### 必須設定項目

```bash
# 環境変数をチェック
echo "DISCORD_TOKEN: ${DISCORD_TOKEN:+設定済み}"
echo "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+設定済み}"
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:+設定済み}"
```

### 設定ファイルの検証

```bash
# YAML 構文をチェック
deno run -A -e "
import { yaml } from './deps.ts';
const config = yaml.parse(await Deno.readTextFile('~/.claude-bot/claude-bot.yaml'));
console.log('設定ファイルは有効です:', config);
"
```

### 権限の確認

```bash
# ファイル権限をチェック
ls -la ~/.claude-bot/

# Discord ボットの権限を確認
# Discord Developer Portal > Bot > Bot Permissions
```

## 🚨 緊急時の対応

### システムの完全停止

```bash
# 全セッションを終了
deno run -A cli.ts end --all

# 全コンテナを停止
docker stop $(docker ps -q --filter "label=devcontainer")

# プロセスを強制終了
pkill -f "claude-bot"
```

### データの復旧

```bash
# セッション状態のバックアップから復旧
cp ~/.claude-bot/sessions.json.backup ~/.claude-bot/sessions.json

# 設定のリセット
cp claude-bot.yaml.default ~/.claude-bot/claude-bot.yaml
```

### ログの収集

```bash
# サポート用のログ収集
tar -czf claude-bot-logs-$(date +%Y%m%d).tar.gz \
  ~/.claude-bot/logs/ \
  ~/.claude-bot/sessions.json \
  ~/.claude-bot/claude-bot.yaml
```

## 📞 サポート

### 報告すべき情報

1. **エラーメッセージ**: 完全なスタックトレース
2. **環境情報**: OS、Deno バージョン、Docker バージョン
3. **設定**: 機密情報を除いた設定ファイル
4. **ログ**: 関連するログの抜粋
5. **再現手順**: 問題を再現するための手順

### 問題報告のテンプレート

```markdown
## 問題の概要

[問題の簡潔な説明]

## 環境

- OS: [例: Ubuntu 20.04]
- Deno: [例: 1.40.0]
- Docker: [例: 20.10.21]
- Claude Bot: [例: v1.0.0]

## 再現手順

1. [手順1]
2. [手順2]
3. [手順3]

## 期待される動作

[期待される結果]

## 実際の動作

[実際に起こった結果]

## ログ
```

[関連するログの抜粋]

```
## 追加情報
[その他の関連情報]
```

### GitHub Issues

問題を報告する場合は、以下のリポジトリに Issue を作成してください：

- https://github.com/your-org/claude-bot/issues

### Discord サポート

リアルタイムサポートが必要な場合：

- Discord サーバー: [招待リンク]
- サポートチャンネル: #claude-bot-support
