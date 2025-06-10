import { assertEquals } from "https://deno.land/std@0.211.0/assert/mod.ts";
import { SessionLogger } from "./session-logger.ts";
import { WorkspaceManager } from "../workspace.ts";

Deno.test("SessionLogger - saveRawJsonlOutput - 正常系", async () => {
  // WorkspaceManagerのモック
  let savedData: { repo: string; session: string; output: string } | null =
    null;
  const mockWorkspaceManager = {
    saveRawSessionJsonl: async (
      repo: string,
      session: string,
      output: string,
    ) => {
      savedData = { repo, session, output };
    },
  } as unknown as WorkspaceManager;

  const logger = new SessionLogger(mockWorkspaceManager);

  await logger.saveRawJsonlOutput("org/repo", "session-123", "test output");

  assertEquals(savedData, {
    repo: "org/repo",
    session: "session-123",
    output: "test output",
  });
});

Deno.test("SessionLogger - saveRawJsonlOutput - リポジトリ名がない場合", async () => {
  // WorkspaceManagerのモック
  let called = false;
  const mockWorkspaceManager = {
    saveRawSessionJsonl: async () => {
      called = true;
    },
  } as unknown as WorkspaceManager;

  const logger = new SessionLogger(mockWorkspaceManager);

  await logger.saveRawJsonlOutput(undefined, "session-123", "test output");

  // 保存されていないことを確認
  assertEquals(called, false);
});

Deno.test("SessionLogger - saveRawJsonlOutput - セッションIDがない場合", async () => {
  // WorkspaceManagerのモック
  let called = false;
  const mockWorkspaceManager = {
    saveRawSessionJsonl: async () => {
      called = true;
    },
  } as unknown as WorkspaceManager;

  const logger = new SessionLogger(mockWorkspaceManager);

  await logger.saveRawJsonlOutput("org/repo", undefined, "test output");

  // 保存されていないことを確認
  assertEquals(called, false);
});

Deno.test("SessionLogger - saveRawJsonlOutput - エラー処理", async () => {
  // WorkspaceManagerのモック（エラーを投げる）
  const mockWorkspaceManager = {
    saveRawSessionJsonl: async () => {
      throw new Error("保存エラー");
    },
  } as unknown as WorkspaceManager;

  const logger = new SessionLogger(mockWorkspaceManager);

  // console.errorをモック
  const originalError = console.error;
  let errorLogged = false;
  console.error = () => {
    errorLogged = true;
  };

  try {
    await logger.saveRawJsonlOutput("org/repo", "session-123", "test output");

    // エラーがログに記録されていることを確認
    assertEquals(errorLogged, true);
  } finally {
    console.error = originalError;
  }
});
