import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  getChangedFiles,
  getCurrentCommitHash,
  performGitUpdate,
} from "./git-update.ts";
import { exec } from "./utils/exec.ts";

// Gitリポジトリのセットアップ用ヘルパー関数
async function setupTestRepo(dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });

  // テスト用のGitリポジトリを初期化
  await exec(`cd ${dir} && git init`);
  await exec(`cd ${dir} && git config user.email "test@example.com"`);
  await exec(`cd ${dir} && git config user.name "Test User"`);

  // 初期コミットを作成
  await Deno.writeTextFile(`${dir}/README.md`, "# Test Repository\n");
  await exec(`cd ${dir} && git add README.md`);
  await exec(`cd ${dir} && git commit -m "Initial commit"`);

  // リモートリポジトリをシミュレート（ベアリポジトリ）
  const remoteDir = `${dir}_remote`;
  await exec(`git init --bare ${remoteDir}`);
  await exec(`cd ${dir} && git remote add origin ${remoteDir}`);
  await exec(`cd ${dir} && git push -u origin main`);
}

// テスト用のリモート更新をシミュレート
async function simulateRemoteUpdate(dir: string): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  const remoteDir = `${dir}_remote`;

  try {
    // リモートをクローン
    await exec(`git clone ${remoteDir} ${tempDir}/temp_repo`);
    await exec(
      `cd ${tempDir}/temp_repo && git config user.email "remote@example.com"`,
    );
    await exec(`cd ${tempDir}/temp_repo && git config user.name "Remote User"`);

    // 新しいファイルを追加
    await Deno.writeTextFile(
      `${tempDir}/temp_repo/new-file.txt`,
      "New content from remote\n",
    );
    await exec(`cd ${tempDir}/temp_repo && git add new-file.txt`);
    await exec(
      `cd ${tempDir}/temp_repo && git commit -m "Add new file from remote"`,
    );
    await exec(`cd ${tempDir}/temp_repo && git push`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("performGitUpdate - リポジトリが最新の場合", async () => {
  const testDir = await Deno.makeTempDir();
  const repoDir = `${testDir}/test-repo`;
  const originalCwd = Deno.cwd();

  try {
    await setupTestRepo(repoDir);

    // 作業ディレクトリに移動
    Deno.chdir(repoDir);

    const result = await performGitUpdate();

    assertEquals(result.success, true);
    assertEquals(result.hasChanges, false);
    assertEquals(result.message.includes("すでに最新の状態です"), true);

    Deno.chdir(originalCwd);
  } catch (error) {
    // エラーが発生した場合も元のディレクトリに戻る
    try {
      Deno.chdir(originalCwd);
    } catch {
      // 無視
    }
    throw error;
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("performGitUpdate - 新しいコミットがある場合", async () => {
  const testDir = await Deno.makeTempDir();
  const repoDir = `${testDir}/test-repo`;
  const originalCwd = Deno.cwd();

  try {
    await setupTestRepo(repoDir);
    await simulateRemoteUpdate(repoDir);

    // 作業ディレクトリに移動
    Deno.chdir(repoDir);

    const result = await performGitUpdate();

    assertEquals(result.success, true);
    assertEquals(result.hasChanges, true);
    assertEquals(
      result.message.includes("1件の新しいコミットが見つかりました"),
      true,
    );
    assertEquals(result.message.includes("マージが成功しました"), true);

    // 新しいファイルが存在することを確認
    const fileExists = await Deno.stat(`new-file.txt`).then(() => true).catch(
      () => false,
    );
    assertEquals(fileExists, true);

    Deno.chdir(originalCwd);
  } catch (error) {
    // エラーが発生した場合も元のディレクトリに戻る
    try {
      Deno.chdir(Deno.cwd());
    } catch {
      // 無視
    }
    throw error;
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("performGitUpdate - ローカル変更がある場合", async () => {
  const testDir = await Deno.makeTempDir();
  const repoDir = `${testDir}/test-repo`;
  const originalCwd = Deno.cwd();

  try {
    await setupTestRepo(repoDir);

    // 作業ディレクトリに移動
    Deno.chdir(repoDir);

    // ローカル変更を作成
    await Deno.writeTextFile(`local-changes.txt`, "Local changes\n");

    const result = await performGitUpdate();

    assertEquals(result.success, true);
    assertEquals(result.stashed, true);
    assertEquals(
      result.message.includes("ローカル変更を一時保存しました"),
      true,
    );
    assertEquals(result.message.includes("ローカル変更を復元しました"), true);

    // ローカル変更が復元されていることを確認
    const fileExists = await Deno.stat(`local-changes.txt`).then(
      () => true,
    ).catch(() => false);
    assertEquals(fileExists, true);

    Deno.chdir(originalCwd);
  } catch (error) {
    // エラーが発生した場合も元のディレクトリに戻る
    try {
      Deno.chdir(originalCwd);
    } catch {
      // 無視
    }
    throw error;
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("getCurrentCommitHash - 現在のコミットハッシュを取得", async () => {
  const testDir = await Deno.makeTempDir();
  const repoDir = `${testDir}/test-repo`;
  const originalCwd = Deno.cwd();

  try {
    await setupTestRepo(repoDir);

    // 作業ディレクトリに移動
    Deno.chdir(repoDir);

    const hash = await getCurrentCommitHash();

    assertExists(hash);
    assertEquals(hash.length, 40); // Git SHA-1ハッシュは40文字

    Deno.chdir(originalCwd);
  } catch (error) {
    // エラーが発生した場合も元のディレクトリに戻る
    try {
      Deno.chdir(originalCwd);
    } catch {
      // 無視
    }
    throw error;
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("getChangedFiles - 変更ファイルリストを取得", async () => {
  const testDir = await Deno.makeTempDir();
  const repoDir = `${testDir}/test-repo`;
  const originalCwd = Deno.cwd();

  try {
    await setupTestRepo(repoDir);

    // 作業ディレクトリに移動
    Deno.chdir(repoDir);

    // 最初のコミットハッシュを取得
    const firstCommit = await getCurrentCommitHash();

    // 新しいファイルを追加してコミット
    await Deno.writeTextFile(`test-file.txt`, "Test content\n");
    await exec("git add test-file.txt");
    await exec('git commit -m "Add test file"');

    // 変更ファイルを取得
    const changedFiles = await getChangedFiles(firstCommit);

    assertEquals(changedFiles.length, 1);
    assertEquals(changedFiles[0], "test-file.txt");

    Deno.chdir(originalCwd);
  } catch (error) {
    // エラーが発生した場合も元のディレクトリに戻る
    try {
      Deno.chdir(originalCwd);
    } catch {
      // 無視
    }
    throw error;
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
