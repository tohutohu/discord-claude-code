# レートリミット自動再開のデバッグ手順

## 追加したデバッグログ

以下の場所にデバッグログを追加しました：

### 1. Admin側のタイマー設定（src/admin.ts）
- `[Admin] 自動再開タイマー設定` - タイマー設定時の詳細情報
- `[Admin] タイマーID ... を設定しました` - タイマーIDの確認
- `[Admin] 自動再開タイマー発火` - タイマーが実行された時

### 2. Admin側の自動再開実行（src/admin.ts）  
- `[Admin] 自動再開実行開始` - executeAutoResume開始時
- `[Admin] 自動再開コールバックを実行します` - コールバック実行前
- `[Admin] 自動再開コールバック実行完了` - コールバック実行後
- `[Admin] レートリミット情報をリセット` - 処理完了時

### 3. Main側のコールバック（src/main.ts）
- `[Main] 自動再開コールバック呼び出し` - コールバック開始時
- `[Main] チャンネル取得: 成功/失敗` - Discordチャンネル取得結果
- `[Main] admin.routeMessage呼び出し開始` - メッセージルーティング開始
- `[Main] admin.routeMessage呼び出し完了` - メッセージルーティング完了
- `[Main] 自動再開処理完了` - 全処理完了時

### 4. Worker側のメッセージ受信（src/worker.ts）
- `[Worker:name] 自動再開メッセージを受信` - "続けて"メッセージを検出
- `[Worker:name] Claude実行開始` - Claude CLI実行開始
- `[Worker:name] Claude実行完了` - Claude CLI実行完了

## デバッグ手順

1. Discord Botを起動する
2. スレッドでレートリミットエラーを発生させる
3. 「はい - 自動継続する」ボタンを押す
4. コンソールログを監視して以下を確認：
   - タイマーが正しく設定されているか
   - 5分後にタイマーが発火するか
   - コールバックが呼ばれているか
   - "続けて"メッセージがWorkerに届いているか
   - Claude CLIが実行されているか

## 予想される問題パターン

### パターン1: タイマーが動作しない
- `[Admin] 自動再開タイマー発火` が表示されない
- → タイマー設定に問題がある

### パターン2: コールバックが呼ばれない  
- `[Main] 自動再開コールバック呼び出し` が表示されない
- → コールバック設定に問題がある

### パターン3: Workerに届かない
- `[Worker:name] 自動再開メッセージを受信` が表示されない
- → routeMessageに問題がある

### パターン4: Claude実行されない
- `[Worker:name] Claude実行開始` が表示されない
- → Worker内部に問題がある

## ログ例

正常に動作する場合の期待されるログ順序：

```
[Admin] 自動再開タイマー設定 (threadId: xxx)
  - レートリミット時刻: 2025-06-07T00:00:00.000Z
  - 再開予定時刻: 2025-06-07T00:05:00.000Z
  - 待機時間: 300000ms (300秒)
[Admin] タイマーID 123 を設定しました

... 5分後 ...

[Admin] 自動再開タイマー発火 (threadId: xxx)
[Admin] 自動再開実行開始 (threadId: xxx)
[Admin] 自動再開コールバックを実行します (threadId: xxx)
[Main] 自動再開コールバック呼び出し (threadId: xxx, message: "続けて")
[Main] チャンネル取得: 成功
[Main] 最新のユーザーメッセージ: 取得成功
[Main] admin.routeMessage呼び出し開始
[Worker:name] 自動再開メッセージを受信
[Worker:name] Claude実行開始
[Main] 進捗メッセージ送信: "🤖 Claudeが考えています..."
[Worker:name] Claude実行完了
[Main] admin.routeMessage呼び出し完了: 文字列応答
[Main] 最終応答送信: "..."
[Main] 自動再開処理完了
[Admin] 自動再開コールバック実行完了 (threadId: xxx)
[Admin] レートリミット情報をリセット (threadId: xxx)
```