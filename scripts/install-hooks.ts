#!/usr/bin/env -S deno run -A

/**
 * Git Hooksのインストールスクリプト
 * .git/hooks/ に必要なフックスクリプトをインストールする
 */

import { ensureDir } from '@std/fs';
import { join } from '@std/path';

const HOOKS_DIR = '.git/hooks';

// pre-commitフックの内容
const preCommitHook = `#!/bin/sh
# pre-commit hook: フォーマットとリントのチェック

echo "🔍 Running format check..."
deno fmt --check
if [ $? -ne 0 ]; then
  echo "❌ Format check failed. Please run 'deno task fmt' to fix."
  exit 1
fi

echo "🔍 Running lint..."
deno lint
if [ $? -ne 0 ]; then
  echo "❌ Lint check failed. Please fix the errors above."
  exit 1
fi

echo "✅ Pre-commit checks passed!"
`;

// commit-msgフックの内容
const commitMsgHook = `#!/bin/sh
# commit-msg hook: Conventional Commitsの検証

commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,100}$'
error_msg="❌ Commit message does not follow Conventional Commits format!

Expected format: <type>(<scope>): <subject>

Examples:
  feat: add new feature
  fix(auth): resolve login issue
  docs: update README
  chore(deps): update dependencies

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert
"

if ! grep -qE "$commit_regex" "$1"; then
  echo "$error_msg" >&2
  exit 1
fi

echo "✅ Commit message validation passed!"
`;

// prepare-commit-msgフックの内容
const prepareCommitMsgHook = `#!/bin/sh
# prepare-commit-msg hook: ブランチ名からプレフィックスを自動追加

COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

# コミットソースが message (-m) の場合はスキップ
if [ "$COMMIT_SOURCE" = "message" ]; then
  exit 0
fi

# 現在のブランチ名を取得
BRANCH_NAME=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ -z "$BRANCH_NAME" ]; then
  exit 0
fi

# ブランチ名からプレフィックスを抽出
case "$BRANCH_NAME" in
  feat/*) PREFIX="feat: " ;;
  fix/*) PREFIX="fix: " ;;
  docs/*) PREFIX="docs: " ;;
  refactor/*) PREFIX="refactor: " ;;
  test/*) PREFIX="test: " ;;
  chore/*) PREFIX="chore: " ;;
  *) PREFIX="" ;;
esac

# プレフィックスがある場合、コミットメッセージに追加
if [ -n "$PREFIX" ]; then
  # 既存のメッセージを取得
  EXISTING_MSG=$(cat "$COMMIT_MSG_FILE")
  
  # プレフィックスがまだない場合のみ追加
  if ! echo "$EXISTING_MSG" | grep -q "^$PREFIX"; then
    echo "$PREFIX$EXISTING_MSG" > "$COMMIT_MSG_FILE"
  fi
fi
`;

async function installHook(name: string, content: string) {
  const hookPath = join(HOOKS_DIR, name);

  try {
    await Deno.writeTextFile(hookPath, content);
    // 実行権限を付与
    await Deno.chmod(hookPath, 0o755);
    console.log(`✅ Installed ${name} hook`);
  } catch (error) {
    console.error(`❌ Failed to install ${name} hook:`, error);
    throw error;
  }
}

async function main() {
  console.log('🔧 Installing Git hooks...\n');

  // .git/hooksディレクトリの存在を確認
  try {
    await ensureDir(HOOKS_DIR);
  } catch (error) {
    console.error('❌ Error: Not a git repository (or any of the parent directories)');
    Deno.exit(1);
  }

  try {
    // 各フックをインストール
    await installHook('pre-commit', preCommitHook);
    await installHook('commit-msg', commitMsgHook);
    await installHook('prepare-commit-msg', prepareCommitMsgHook);

    console.log('\n✨ All Git hooks installed successfully!');
    console.log("📝 Run 'deno task install-hooks' to reinstall hooks after cloning.");
  } catch (error) {
    console.error('\n❌ Hook installation failed:', error);
    Deno.exit(1);
  }
}

// Denoテスト
if (import.meta.main) {
  await main();
}
