# devcontainer CLI オプション調査結果

## 概要

devcontainer
CLIのオプションについて調査した結果、特に`devcontainer up`と`devcontainer exec`コマンドでdevcontainer.jsonファイルを明示的に指定する方法について以下の通り判明しました。

## 1. devcontainer upコマンドでdevcontainer.jsonファイルを明示的に指定する方法

### --configオプション

`devcontainer up`コマンドは`--config`オプションを使用してdevcontainer.jsonファイルのパスを明示的に指定できます。

```bash
# カスタムパスのdevcontainer.jsonを指定
devcontainer up --workspace-folder /path/to/project --config ./custom/path/devcontainer.json

# デフォルト以外の場所にあるdevcontainer.jsonを使用
devcontainer up --config /absolute/path/to/devcontainer.json
```

**デフォルトパス:**

- `.devcontainer/devcontainer.json`
- `.devcontainer.json`（プロジェクトルート）

### --override-configオプション

既存のワークスペースのdevcontainer.jsonを上書きする場合に使用します。デフォルトの設定ファイルが存在しない場合は必須となります。

```bash
devcontainer up --workspace-folder /path/to/project --override-config ./override/devcontainer.json
```

## 2. --config-fileや類似のオプションについて

調査の結果、`--config-file`という名前のオプションは存在せず、設定ファイルの指定には`--config`オプションを使用することが判明しました。

## 3. devcontainer execコマンドでの指定方法

`devcontainer exec`コマンドでも同様に`--config`オプションが利用可能です。

```bash
# カスタム設定ファイルを使用してコマンドを実行
devcontainer exec --workspace-folder /path/to/project --config ./custom/devcontainer.json <command>

# 例：カスタム設定でnpm testを実行
devcontainer exec --config ./test/devcontainer.json npm test
```

### execコマンドで利用可能なオプション

- `--config`: devcontainer.jsonパスを指定
- `--override-config`: ワークスペースのdevcontainer.jsonを上書き
- `--workspace-folder`:
  設定を検索するためのパス（configが明示的に指定されていない場合）

## 4. デフォルトパス以外の場所にあるdevcontainer.jsonを使用する方法

### 方法1: --configオプションの使用（推奨）

```bash
# 絶対パスで指定
devcontainer up --config /home/user/configs/my-devcontainer.json

# 相対パスで指定
devcontainer up --workspace-folder . --config ../shared-configs/devcontainer.json
```

### 方法2: --workspace-folderオプションの活用

`--workspace-folder`で指定したディレクトリ内の標準的な場所（`.devcontainer/devcontainer.json`または`.devcontainer.json`）から設定を読み込みます。

```bash
# プロジェクトディレクトリを指定
devcontainer up --workspace-folder /path/to/project
# → /path/to/project/.devcontainer/devcontainer.json を探す
```

## 5. その他の重要なオプション

### devcontainer upの主要オプション

- `--workspace-folder`: ワークスペースフォルダのパス
- `--config`: devcontainer.json設定ファイルのパス
- `--override-config`: ワークスペースのdevcontainer.jsonを上書き
- `--docker-compose-path`: Docker Composeファイルのパス
- `--id-label`: コンテナを識別するためのラベル
- `--mount`: 追加のマウント指定
- `--additional-features`: 追加機能の指定
- `--log-level`: ログレベル（debug、info、warn、error）
- `--log-format`: ログフォーマット（text、json）

## 6. 実装への推奨事項

現在のコードでは`--workspace-folder`オプションのみを使用していますが、より柔軟な設定ファイルの指定を可能にするために以下の改善を推奨します：

### 現在の実装

```typescript
function createDevcontainerCommand(
  repositoryPath: string,
  env: Record<string, string>,
): Deno.Command {
  return new Deno.Command("devcontainer", {
    args: [
      "up",
      "--workspace-folder",
      repositoryPath,
      "--log-level",
      "debug",
      "--log-format",
      "json",
    ],
    // ...
  });
}
```

### 推奨される改善案

```typescript
interface DevcontainerCommandOptions {
  repositoryPath: string;
  env: Record<string, string>;
  configPath?: string; // カスタム設定ファイルパス
}

function createDevcontainerCommand(
  options: DevcontainerCommandOptions,
): Deno.Command {
  const args = [
    "up",
    "--workspace-folder",
    options.repositoryPath,
    "--log-level",
    "debug",
    "--log-format",
    "json",
  ];

  // カスタム設定ファイルが指定されている場合
  if (options.configPath) {
    args.push("--config", options.configPath);
  }

  return new Deno.Command("devcontainer", {
    args,
    stdout: "piped",
    stderr: "piped",
    cwd: options.repositoryPath,
    env: options.env,
  });
}
```

同様に、`execInDevcontainer`関数でも`--config`オプションをサポートすることで、より柔軟な実行環境の管理が可能になります。

## 7. 注意事項

1. `--config`オプションで指定されたパスは、相対パスの場合は現在の作業ディレクトリからの相対パスとして解釈されます
2. 設定ファイルが見つからない場合、コマンドはエラーで終了します
3. `--override-config`は既存の設定を完全に置き換えるため、使用には注意が必要です
4. devcontainer.jsonは他のdevcontainer.jsonファイルからの設定をインポートまたは継承することはできません

## 参考資料

- [GitHub - devcontainers/cli](https://github.com/devcontainers/cli)
- [Dev Container CLI - VS Code Documentation](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli)
- [Dev Container metadata reference](https://containers.dev/implementors/json_reference/)
- [devcontainer CLI ソースコード (devContainersSpecCLI.ts)](https://github.com/devcontainers/cli/blob/main/src/spec-node/devContainersSpecCLI.ts)
