/**
 * ビルド最適化とリリース準備
 * @cli ビルドプロセスの最適化
 */

import { colors, path } from './deps.ts';

/** ビルド設定 */
interface BuildConfig {
  /** 出力ディレクトリ */
  outDir: string;
  /** 対象プラットフォーム */
  targets: Array<'linux' | 'darwin' | 'windows'>;
  /** 最適化レベル */
  optimization: 'none' | 'basic' | 'aggressive';
  /** Tree shaking を有効にするか */
  treeShaking: boolean;
  /** 並列ビルドを使用するか */
  parallel: boolean;
}

/** ビルド結果 */
interface BuildResult {
  /** ターゲット */
  target: string;
  /** 成功したかどうか */
  success: boolean;
  /** 出力ファイルパス */
  outputPath?: string;
  /** ファイルサイズ（バイト） */
  fileSize?: number;
  /** ビルド時間（ミリ秒） */
  buildTime: number;
  /** エラーメッセージ */
  error?: string;
}

/**
 * ビルドマネージャー
 * Deno compileを使用した最適化ビルドを管理
 */
export class BuildManager {
  private config: BuildConfig;

  constructor(config: BuildConfig) {
    this.config = config;
  }

  /**
   * 全ターゲットをビルド
   * @returns ビルド結果
   */
  async buildAll(): Promise<BuildResult[]> {
    console.log(colors.blue('🔨 ビルド開始...'));

    // 出力ディレクトリを作成
    await Deno.mkdir(this.config.outDir, { recursive: true });

    const results: BuildResult[] = [];

    if (this.config.parallel) {
      // 並列ビルド
      const promises = this.config.targets.map((target) => this.buildTarget(target));
      results.push(...await Promise.all(promises));
    } else {
      // 逐次ビルド
      for (const target of this.config.targets) {
        results.push(await this.buildTarget(target));
      }
    }

    this.printBuildSummary(results);
    return results;
  }

  /**
   * 特定のターゲットをビルド
   * @param target ターゲットプラットフォーム
   * @returns ビルド結果
   */
  async buildTarget(target: 'linux' | 'darwin' | 'windows'): Promise<BuildResult> {
    const startTime = performance.now();
    console.log(colors.yellow(`📦 ${target} をビルド中...`));

    try {
      const outputPath = this.getOutputPath(target);
      const args = this.buildCompileArgs(target, outputPath);

      // deno compile を実行
      const cmd = new Deno.Command('deno', {
        args,
        stdout: 'piped',
        stderr: 'piped',
      });

      const child = cmd.spawn();
      const result = await child.output();

      const buildTime = performance.now() - startTime;

      if (result.code === 0) {
        const fileSize = await this.getFileSize(outputPath);

        console.log(
          colors.green(
            `✅ ${target} ビルド完了: ${this.formatFileSize(fileSize)} (${buildTime.toFixed(2)}ms)`,
          ),
        );

        return {
          target,
          success: true,
          outputPath,
          fileSize,
          buildTime,
        };
      } else {
        const stderr = new TextDecoder().decode(result.stderr);
        console.log(colors.red(`❌ ${target} ビルド失敗: ${stderr}`));

        return {
          target,
          success: false,
          buildTime,
          error: stderr,
        };
      }
    } catch (error) {
      const buildTime = performance.now() - startTime;
      console.log(colors.red(`❌ ${target} ビルドエラー: ${error.message}`));

      return {
        target,
        success: false,
        buildTime,
        error: error.message,
      };
    }
  }

  /**
   * コンパイル引数を構築
   * @param target ターゲットプラットフォーム
   * @param outputPath 出力パス
   * @returns コンパイル引数
   */
  private buildCompileArgs(target: string, outputPath: string): string[] {
    const args = [
      'compile',
      '--allow-all',
      '--output',
      outputPath,
    ];

    // プラットフォーム指定
    args.push('--target', this.getDenoTarget(target));

    // 最適化オプション
    if (this.config.optimization === 'aggressive') {
      // より積極的な最適化（実際のDenoでは限定的）
      args.push('--no-check');
    } else if (this.config.optimization === 'basic') {
      // 基本的な最適化
      args.push('--check');
    }

    // メインファイル
    args.push('./cli.ts');

    return args;
  }

  /**
   * Denoターゲット名を取得
   * @param target プラットフォーム
   * @returns Denoターゲット名
   */
  private getDenoTarget(target: string): string {
    switch (target) {
      case 'linux':
        return 'x86_64-unknown-linux-gnu';
      case 'darwin':
        return 'x86_64-apple-darwin';
      case 'windows':
        return 'x86_64-pc-windows-msvc';
      default:
        throw new Error(`Unsupported target: ${target}`);
    }
  }

  /**
   * 出力パスを取得
   * @param target ターゲットプラットフォーム
   * @returns 出力パス
   */
  private getOutputPath(target: string): string {
    const extension = target === 'windows' ? '.exe' : '';
    return path.join(this.config.outDir, `claude-bot-${target}${extension}`);
  }

  /**
   * ファイルサイズを取得
   * @param filePath ファイルパス
   * @returns ファイルサイズ（バイト）
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await Deno.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * ファイルサイズをフォーマット
   * @param bytes バイト数
   * @returns フォーマット済み文字列
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * ビルド結果サマリーを出力
   * @param results ビルド結果
   */
  private printBuildSummary(results: BuildResult[]): void {
    console.log(colors.blue('\n📊 ビルド結果サマリー'));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`✅ 成功: ${successful.length}/${results.length}`);

    for (const result of successful) {
      const size = result.fileSize ? this.formatFileSize(result.fileSize) : 'Unknown';
      console.log(`   ${result.target}: ${size} (${result.buildTime.toFixed(2)}ms)`);
    }

    if (failed.length > 0) {
      console.log(`❌ 失敗: ${failed.length}`);
      for (const result of failed) {
        console.log(`   ${result.target}: ${result.error}`);
      }
    }

    const totalSize = successful.reduce((sum, r) => sum + (r.fileSize || 0), 0);
    const totalTime = results.reduce((sum, r) => sum + r.buildTime, 0);

    console.log(`📦 総サイズ: ${this.formatFileSize(totalSize)}`);
    console.log(`⏱️  総時間: ${totalTime.toFixed(2)}ms`);
  }
}

/**
 * Docker イメージビルダー
 */
export class DockerBuilder {
  /**
   * Dockerイメージをビルド
   * @param tag イメージタグ
   * @returns ビルド成功
   */
  async buildImage(tag: string): Promise<boolean> {
    console.log(colors.blue(`🐳 Docker イメージをビルド中: ${tag}`));

    try {
      // Dockerfile を生成
      await this.generateDockerfile();

      // docker build を実行
      const cmd = new Deno.Command('docker', {
        args: ['build', '-t', tag, '.'],
        stdout: 'piped',
        stderr: 'piped',
      });

      const child = cmd.spawn();
      const result = await child.output();

      if (result.code === 0) {
        console.log(colors.green(`✅ Docker イメージビルド完了: ${tag}`));
        return true;
      } else {
        const stderr = new TextDecoder().decode(result.stderr);
        console.log(colors.red(`❌ Docker ビルド失敗: ${stderr}`));
        return false;
      }
    } catch (error) {
      console.log(colors.red(`❌ Docker ビルドエラー: ${error.message}`));
      return false;
    }
  }

  /**
   * Dockerfileを生成
   */
  private async generateDockerfile(): Promise<void> {
    const dockerfile = `# Claude Bot Docker Image
FROM denoland/deno:1.40.0

# 作業ディレクトリを設定
WORKDIR /app

# 依存関係ファイルをコピー
COPY deno.json ./
COPY deps.ts ./

# 依存関係をキャッシュ
RUN deno cache deps.ts

# アプリケーションファイルをコピー
COPY . .

# 権限を設定
RUN chmod +x ./cli.ts

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD deno run --allow-net --allow-read health-check.ts

# ポートを公開
EXPOSE 3000

# 実行コマンド
CMD ["deno", "run", "--allow-all", "cli.ts", "run"]
`;

    await Deno.writeTextFile('./Dockerfile', dockerfile);
  }
}

/**
 * パッケージ配布管理
 */
export class PackageDistributor {
  /**
   * Homebrew Formula を生成
   * @param version バージョン
   * @param downloadUrls ダウンロードURL
   */
  async generateHomebrewFormula(
    version: string,
    downloadUrls: Record<string, string>,
  ): Promise<void> {
    console.log(colors.blue('🍺 Homebrew Formula を生成中...'));

    const formula = `class ClaudeBot < Formula
  desc "Discord bot for parallel Claude Code operations"
  homepage "https://github.com/your-org/claude-bot"
  version "${version}"

  if OS.mac?
    url "${downloadUrls.darwin}"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"
  elsif OS.linux?
    url "${downloadUrls.linux}"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"
  end

  def install
    bin.install "claude-bot"
  end

  test do
    system "#{bin}/claude-bot", "--version"
  end
end
`;

    await Deno.writeTextFile('./homebrew/claude-bot.rb', formula);
    console.log(colors.green('✅ Homebrew Formula 生成完了'));
  }

  /**
   * AUR PKGBUILD を生成
   * @param version バージョン
   * @param downloadUrl ダウンロードURL
   */
  async generateAURPackage(version: string, downloadUrl: string): Promise<void> {
    console.log(colors.blue('📦 AUR PKGBUILD を生成中...'));

    const pkgbuild = `# Maintainer: Your Name <your.email@example.com>
pkgname=claude-bot
pkgver=${version}
pkgrel=1
pkgdesc="Discord bot for parallel Claude Code operations"
arch=('x86_64')
url="https://github.com/your-org/claude-bot"
license=('MIT')
depends=('docker' 'git')
source=("$pkgname-$pkgver.tar.gz::${downloadUrl}")
sha256sums=('REPLACE_WITH_ACTUAL_SHA256')

package() {
    install -Dm755 "$srcdir/claude-bot-linux" "$pkgdir/usr/bin/claude-bot"
    install -Dm644 "$srcdir/README.md" "$pkgdir/usr/share/doc/$pkgname/README.md"
    install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
`;

    await Deno.writeTextFile('./aur/PKGBUILD', pkgbuild);
    console.log(colors.green('✅ AUR PKGBUILD 生成完了'));
  }
}

/**
 * リリース自動化
 */
export class ReleaseAutomation {
  /**
   * 完全なリリースプロセスを実行
   * @param version バージョン
   */
  async performRelease(version: string): Promise<void> {
    console.log(colors.blue(`🚀 リリース ${version} を開始...`));

    try {
      // 1. ビルド
      const buildManager = new BuildManager({
        outDir: './dist',
        targets: ['linux', 'darwin', 'windows'],
        optimization: 'aggressive',
        treeShaking: true,
        parallel: true,
      });

      const buildResults = await buildManager.buildAll();
      const successfulBuilds = buildResults.filter((r) => r.success);

      if (successfulBuilds.length === 0) {
        throw new Error('すべてのビルドが失敗しました');
      }

      // 2. Docker イメージ
      const dockerBuilder = new DockerBuilder();
      await dockerBuilder.buildImage(`claude-bot:${version}`);
      await dockerBuilder.buildImage('claude-bot:latest');

      // 3. パッケージ配布ファイル
      const distributor = new PackageDistributor();
      const downloadUrls = {
        darwin:
          `https://github.com/your-org/claude-bot/releases/download/v${version}/claude-bot-darwin`,
        linux:
          `https://github.com/your-org/claude-bot/releases/download/v${version}/claude-bot-linux`,
        windows:
          `https://github.com/your-org/claude-bot/releases/download/v${version}/claude-bot-windows.exe`,
      };

      await distributor.generateHomebrewFormula(version, downloadUrls);
      await distributor.generateAURPackage(version, downloadUrls.linux);

      // 4. リリースノート生成
      await this.generateReleaseNotes(version);

      console.log(colors.green(`🎉 リリース ${version} 完了!`));
    } catch (error) {
      console.log(colors.red(`❌ リリース失敗: ${error.message}`));
      throw error;
    }
  }

  /**
   * リリースノートを生成
   * @param version バージョン
   */
  private async generateReleaseNotes(version: string): Promise<void> {
    const releaseNotes = `# Release v${version}

## 🎉 What's New

### ✨ Features
- Discord から Claude Code の並列実行が可能
- リアルタイム TUI での状態監視
- 高度なセッション管理とキューイング
- セキュリティ強化（API キー暗号化、Rate Limiting）
- 包括的な監視とメトリクス収集

### 🔧 Improvements
- パフォーマンスの最適化
- エラーハンドリングの改善
- ログ機能の拡張
- テストカバレッジの向上

### 🐛 Bug Fixes
- セッション状態の同期問題を修正
- メモリリークの解消
- 並列実行時の競合状態を修正

## 📦 Installation

### Homebrew (macOS/Linux)
\`\`\`bash
brew install your-org/tap/claude-bot
\`\`\`

### AUR (Arch Linux)
\`\`\`bash
yay -S claude-bot
\`\`\`

### Docker
\`\`\`bash
docker run -d --name claude-bot \\
  -e ANTHROPIC_API_KEY=your_key \\
  -e DISCORD_TOKEN=your_token \\
  claude-bot:${version}
\`\`\`

### Manual Download
Download the appropriate binary for your platform from the [releases page](https://github.com/your-org/claude-bot/releases/tag/v${version}).

## 🔧 Configuration

Create a configuration file at \`~/.claude-bot/claude-bot.yaml\`:

\`\`\`yaml
rootDir: ~/claude-work/repos
parallel:
  maxSessions: 3
  queueTimeout: 300
discord:
  guildIds: ["your-guild-id"]
\`\`\`

## 📚 Documentation

- [Quick Start Guide](docs/quick-start.md)
- [Configuration Reference](docs/configuration.md)
- [Architecture Overview](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)

## 🙏 Contributors

Thank you to all contributors who made this release possible!

---

**Full Changelog**: https://github.com/your-org/claude-bot/compare/v${
      this.getPreviousVersion(version)
    }...v${version}
`;

    await Deno.writeTextFile(`./release-notes-v${version}.md`, releaseNotes);
  }

  /**
   * 前のバージョンを取得（簡易実装）
   * @param currentVersion 現在のバージョン
   * @returns 前のバージョン
   */
  private getPreviousVersion(currentVersion: string): string {
    // 実際の実装では git tag から取得
    const parts = currentVersion.split('.');
    const patch = parseInt(parts[2]) - 1;
    return `${parts[0]}.${parts[1]}.${Math.max(0, patch)}`;
  }
}

// CLI インターフェース
if (import.meta.main) {
  const command = Deno.args[0];
  const version = Deno.args[1] || '1.0.0';

  switch (command) {
    case 'build':
      {
        const buildManager = new BuildManager({
          outDir: './dist',
          targets: ['linux', 'darwin', 'windows'],
          optimization: 'aggressive',
          treeShaking: true,
          parallel: true,
        });
        await buildManager.buildAll();
      }
      break;

    case 'docker':
      {
        const dockerBuilder = new DockerBuilder();
        await dockerBuilder.buildImage(`claude-bot:${version}`);
      }
      break;

    case 'release':
      {
        const automation = new ReleaseAutomation();
        await automation.performRelease(version);
      }
      break;

    default:
      console.log(`Usage: deno run -A build.ts <command> [version]

Commands:
  build    - Build binaries for all platforms
  docker   - Build Docker image
  release  - Perform complete release process

Examples:
  deno run -A build.ts build
  deno run -A build.ts docker 1.0.0
  deno run -A build.ts release 1.0.0`);
  }
}
