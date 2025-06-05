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

## アーキテクチャ

- **Admin**:
  プロセスで1つだけ起動され、Workerの管理とメッセージルーティングを担当
- **Worker**: スレッドごとに作成され、メッセージの処理を担当
- 各Workerには `{形容詞}-{動物}` 形式の名前が付けられます（例: happy-panda）
