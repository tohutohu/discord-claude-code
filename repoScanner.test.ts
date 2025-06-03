// リポジトリスキャナーのテスト

import { assertEquals, assertExists, assertStringIncludes } from './deps.ts';
import { RepoScanner } from './repoScanner.ts';
import { join } from './deps.ts';

// テスト用の一時ディレクトリを作成するヘルパー
async function createTestRepo(basePath: string, repoName: string): Promise<string> {
  const repoPath = join(basePath, repoName);

  // ディレクトリ作成
  await Deno.mkdir(repoPath, { recursive: true });

  // git init
  const initCmd = new Deno.Command('git', {
    args: ['init'],
    cwd: repoPath,
    stdout: 'null',
    stderr: 'null',
  });
  await initCmd.output();

  // 初期コミット作成
  const configUserCmd = new Deno.Command('git', {
    args: ['config', 'user.email', 'test@example.com'],
    cwd: repoPath,
    stdout: 'null',
    stderr: 'null',
  });
  await configUserCmd.output();

  const configNameCmd = new Deno.Command('git', {
    args: ['config', 'user.name', 'Test User'],
    cwd: repoPath,
    stdout: 'null',
    stderr: 'null',
  });
  await configNameCmd.output();

  // テストファイル作成
  await Deno.writeTextFile(join(repoPath, 'README.md'), '# Test Repository\n');

  const addCmd = new Deno.Command('git', {
    args: ['add', '.'],
    cwd: repoPath,
    stdout: 'null',
    stderr: 'null',
  });
  await addCmd.output();

  const commitCmd = new Deno.Command('git', {
    args: ['commit', '-m', 'Initial commit'],
    cwd: repoPath,
    stdout: 'null',
    stderr: 'null',
  });
  await commitCmd.output();

  return repoPath;
}

// テスト用ディレクトリのクリーンアップ
async function cleanupTestDir(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // エラーは無視（ディレクトリが存在しない場合など）
  }
}

Deno.test('RepoScannerの基本的なスキャンテスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-test-' });

  try {
    // テストリポジトリを作成
    const repo1 = await createTestRepo(tempDir, 'test-repo-1');
    const repo2 = await createTestRepo(tempDir, 'test-repo-2');

    // スキャン実行
    const scanner = new RepoScanner();
    const result = await scanner.scanRepos(tempDir, {
      maxDepth: 1,
      concurrency: 2,
    });

    // 結果検証
    assertEquals(result.repositories.length, 2);
    assertEquals(result.errorDirs, 0);
    assertExists(result.scanTime);

    // リポジトリ名が正しく取得されていることを確認
    const repoNames = result.repositories.map((r) => r.name).sort();
    assertEquals(repoNames, ['test-repo-1', 'test-repo-2']);

    // パスが正しく設定されていることを確認
    const expectedPaths = [repo1, repo2].sort();
    const actualPaths = result.repositories.map((r) => r.path).sort();
    assertEquals(actualPaths, expectedPaths);
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('深度制限のテスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-depth-' });

  try {
    // 深い階層にリポジトリを作成
    const deepDir = join(tempDir, 'level1', 'level2', 'level3');
    await Deno.mkdir(deepDir, { recursive: true });
    await createTestRepo(deepDir, 'deep-repo');

    // 浅いスキャン（depth=2）
    const scanner = new RepoScanner();
    const shallowResult = await scanner.scanRepos(tempDir, {
      maxDepth: 2,
    });

    // 深いリポジトリは検出されない
    assertEquals(shallowResult.repositories.length, 0);

    // 深いスキャン（depth=4）
    const deepResult = await scanner.scanRepos(tempDir, {
      maxDepth: 4,
    });

    // 深いリポジトリが検出される
    assertEquals(deepResult.repositories.length, 1);
    assertEquals(deepResult.repositories[0]!.name, 'deep-repo');
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('スキップパターンのテスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-skip-' });

  try {
    // 通常のリポジトリ
    await createTestRepo(tempDir, 'normal-repo');

    // スキップ対象のリポジトリ
    await createTestRepo(tempDir, 'node_modules');
    await createTestRepo(tempDir, 'target');

    const scanner = new RepoScanner();
    const result = await scanner.scanRepos(tempDir, {
      maxDepth: 1,
      skipPatterns: ['node_modules', 'target'],
    });

    // スキップパターンにマッチするディレクトリは除外される
    assertEquals(result.repositories.length, 1);
    assertEquals(result.repositories[0]!.name, 'normal-repo');
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('リポジトリメタ情報の取得テスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-meta-' });

  try {
    const repoPath = await createTestRepo(tempDir, 'meta-test-repo');

    const scanner = new RepoScanner();
    const result = await scanner.scanRepos(tempDir);

    assertEquals(result.repositories.length, 1);
    const repo = result.repositories[0]!;

    // 基本情報
    assertEquals(repo.name, 'meta-test-repo');
    assertEquals(repo.path, repoPath);
    // ブランチ名は環境によって異なるため、存在確認のみ
    assertExists(repo.branch);

    // 日付情報
    assertExists(repo.lastModified);
    assertEquals(repo.lastModified instanceof Date, true);

    // コミットハッシュ
    assertExists(repo.lastCommit);
    assertEquals(repo.lastCommit!.length, 40); // GitのSHA-1ハッシュは40文字
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('並列実行の制御テスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-parallel-' });

  try {
    // 複数のリポジトリを作成
    const repoPromises = [];
    for (let i = 0; i < 5; i++) {
      repoPromises.push(createTestRepo(tempDir, `repo-${i}`));
    }
    await Promise.all(repoPromises);

    const scanner = new RepoScanner();
    const startTime = Date.now();

    const result = await scanner.scanRepos(tempDir, {
      maxDepth: 1,
      concurrency: 2, // 並列実行数を制限
    });

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    // 結果検証
    assertEquals(result.repositories.length, 5);
    assertEquals(result.scanTime, executionTime);

    // パフォーマンス確認（並列実行により高速化されている）
    assertEquals(executionTime < 10000, true); // 10秒以内
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('エラーハンドリングのテスト', async () => {
  const scanner = new RepoScanner();

  // 存在しないディレクトリのスキャン
  try {
    await scanner.scanRepos('/non/existent/directory');
    assertEquals(false, true, 'エラーがスローされるべき');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    assertStringIncludes(errorMessage, 'ルートディレクトリが存在しません');
  }
});

Deno.test('空ディレクトリのスキャンテスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-empty-' });

  try {
    const scanner = new RepoScanner();
    const result = await scanner.scanRepos(tempDir);

    assertEquals(result.repositories.length, 0);
    assertEquals(result.errorDirs, 0);
    assertEquals(result.skippedDirs, 0);
    assertExists(result.scanTime);
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('無効なGitリポジトリのテスト', async () => {
  const tempDir = await Deno.makeTempDir({ prefix: 'repo-scanner-invalid-' });

  try {
    // 通常のディレクトリを作成
    const normalDir = join(tempDir, 'normal-dir');
    await Deno.mkdir(normalDir);

    // 空の.gitディレクトリを作成（無効なリポジトリ）
    const invalidRepoDir = join(tempDir, 'invalid-repo');
    await Deno.mkdir(invalidRepoDir);
    await Deno.mkdir(join(invalidRepoDir, '.git')); // 空の.gitディレクトリ

    const scanner = new RepoScanner();
    const result = await scanner.scanRepos(tempDir);

    // 無効なリポジトリはエラーとして処理される
    assertEquals(result.repositories.length, 0);
    assertEquals(result.errorDirs, 1);
    assertEquals(result.errors.length, 1);
    assertStringIncludes(result.errors[0]!.error, 'リポジトリ解析エラー');
  } finally {
    await cleanupTestDir(tempDir);
  }
});

Deno.test('ディレクトリスキップ判定のテスト', () => {
  const scanner = new RepoScanner();

  // プライベートメソッドを直接テストするためのキャスト
  // deno-lint-ignore no-explicit-any
  const scannerAny = scanner as any;

  // 基本的なスキップパターン
  assertEquals(scannerAny.shouldSkipDirectory('node_modules', ['node_modules']), true);
  assertEquals(scannerAny.shouldSkipDirectory('target', ['target']), true);
  assertEquals(scannerAny.shouldSkipDirectory('normal-dir', ['node_modules', 'target']), false);

  // ワイルドカードパターン
  assertEquals(scannerAny.shouldSkipDirectory('test.tmp', ['*.tmp']), true);
  assertEquals(scannerAny.shouldSkipDirectory('backup.bak', ['*.tmp']), false);
});
