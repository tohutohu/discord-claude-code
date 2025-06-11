# neverthrow ライブラリ導入ガイド

## 概要

neverthrowは、TypeScriptで型安全なエラーハンドリングを実現するライブラリです。Rustの`Result<T, E>`型に着想を得て、JavaScriptの例外処理（try/catch）の代わりに、エラーを型として扱う関数型プログラミングのアプローチを採用しています。

## 主な利点

- **型安全性**: コンパイル時にエラーの型が確認される
- **明示的なエラーハンドリング**:
  エラーが発生する可能性のある関数が型レベルで明確
- **予測可能なフロー**: 例外によるジャンプがなく、制御フローが追いやすい
- **自己文書化**: エラーの型が関数のシグネチャに含まれる
- **関数の合成が容易**: map、andThenなどで関数を組み合わせやすい

## Denoでの使用方法

```typescript
// deno.jsonのimports設定
{
  "imports": {
    "neverthrow": "npm:neverthrow@7.3.1"
  }
}
```

## 基本的な使い方

### Result型

```typescript
import { err, ok, Result } from "neverthrow";

// 成功または失敗を返す関数
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return err("Division by zero");
  }
  return ok(a / b);
}

// 使用例
const result = divide(10, 2);

// パターンマッチング
result.match(
  (value) => console.log(`Result: ${value}`),
  (error) => console.log(`Error: ${error}`),
);

// 型ガード
if (result.isOk()) {
  console.log(result.value); // 型安全にアクセス可能
} else {
  console.log(result.error);
}
```

### メソッドチェーン

```typescript
const result = divide(10, 2)
  .map((x) => x * 2) // 成功値を変換
  .andThen((x) => divide(x, 5)) // 別のResult関数と結合
  .mapErr((err) => `計算エラー: ${err}`); // エラー値を変換
```

### 非同期処理（ResultAsync）

```typescript
import { errAsync, okAsync, ResultAsync } from "neverthrow";

// Promise を ResultAsync に変換
const fetchUser = (id: string): ResultAsync<User, string> => {
  return ResultAsync.fromPromise(
    fetch(`/api/users/${id}`).then((res) => res.json()),
    (error) => `Failed to fetch user: ${error}`,
  );
};

// 使用例
const userResult = await fetchUser("123")
  .andThen((user) => fetchUserPosts(user.id))
  .map((posts) => posts.length)
  .mapErr((error) => ({ type: "FETCH_ERROR", message: error }));
```

## Discord Botでの実装パターン

### 1. エラー型の定義

```typescript
// src/admin/types.ts
export type AdminError =
  | { type: "RATE_LIMIT"; retryAfter: number }
  | { type: "WORKER_NOT_FOUND"; threadId: string }
  | { type: "DEVCONTAINER_SETUP_FAILED"; error: string }
  | { type: "PERMISSION_ERROR"; message: string };
```

### 2. エラーハンドリング関数

```typescript
// src/admin/admin.ts
import { err, ok, Result } from "neverthrow";

class Admin {
  createWorker(threadId: string): Result<Worker, AdminError> {
    // レート制限チェック
    if (this.isRateLimited()) {
      return err({
        type: "RATE_LIMIT",
        retryAfter: this.getRateLimitRemaining(),
      });
    }

    try {
      const worker = new Worker(name, this.workspaceManager);
      this.workers.set(threadId, worker);
      return ok(worker);
    } catch (error) {
      return err({
        type: "PERMISSION_ERROR",
        message: error.message,
      });
    }
  }
}
```

### 3. 複数の操作の組み合わせ

```typescript
const setupDevcontainer = (
  repo: GitRepository,
): ResultAsync<string, AdminError> => {
  return checkDevcontainerConfig(repo.path)
    .andThen(() => startDevcontainer(repo.path))
    .andThen((container) => getDevcontainerConnectionInfo(container))
    .mapErr((error) => ({
      type: "DEVCONTAINER_SETUP_FAILED",
      error: error.message,
    }));
};
```

## ベストプラクティス

### 1. 予期されるエラーと予期しないエラーの区別

```typescript
// 予期されるエラー → Result型
function parseConfig(content: string): Result<Config, string> {
  // バリデーションエラーなど
}

// 予期しないエラー → 例外
function criticalSystemOperation(): void {
  // メモリ不足などのシステムエラーは例外として扱う
}
```

### 2. サードパーティライブラリのラップ

```typescript
const safeExec = (command: string): ResultAsync<string, string> => {
  return ResultAsync.fromPromise(
    exec(command),
    (error) => `Command failed: ${error}`,
  );
};
```

### 3. 早期リターンパターン

```typescript
function processMessage(content: string): Result<Response, AdminError> {
  const validationResult = validateMessage(content);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const parseResult = parseCommand(validationResult.value);
  if (parseResult.isErr()) {
    return err(parseResult.error);
  }

  // 処理を続行...
}
```

### 4. safeTryを使った読みやすいコード

```typescript
import { safeTry } from "neverthrow";

const processWithDevcontainer = safeTry(async function* () {
  const config = yield* checkDevcontainerConfig(path);
  const container = yield* startDevcontainer(path);
  const result = yield* executeInContainer(container, command);
  return ok(result);
});
```

## 注意点

1. **パフォーマンス**: Result型のラッピングには若干のオーバーヘッドがある
2. **学習曲線**:
   チームメンバーが関数型プログラミングに慣れていない場合は学習が必要
3. **既存コードとの統合**: 段階的な移行戦略が必要
4. **ライブラリサイズ**: 約20KB（gzipped: 約5KB）

## 参考リンク

- [公式ドキュメント](https://github.com/supermacro/neverthrow)
- [ESLintプラグイン](https://github.com/mdbetancourt/eslint-plugin-neverthrow)
- [実装例集](https://github.com/supermacro/neverthrow/wiki/Recipes)
