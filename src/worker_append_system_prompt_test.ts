import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { Worker } from "./worker.ts";
import { WorkspaceManager } from "./workspace.ts";

class MockClaudeExecutor {
  capturedArgs: string[] = [];
  
  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    this.capturedArgs = args;
    
    // Mock response
    const mockResponse = JSON.stringify({
      type: "result",
      result: "テスト応答",
    }) + "\n";
    onData(new TextEncoder().encode(mockResponse));
    
    return { code: 0, stderr: new Uint8Array() };
  }
}

describe("Worker --append-system-prompt オプション", () => {
  it("appendSystemPromptが設定されている場合、コマンドに含まれる", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const workspaceManager = new WorkspaceManager(tempDir);
      await workspaceManager.initialize();
      
      const mockExecutor = new MockClaudeExecutor();
      const appendPrompt = "追加のシステムプロンプトです";
      
      const worker = new Worker(
        "test-worker",
        workspaceManager,
        mockExecutor,
        false,
        appendPrompt,
      );
      
      // worktreePathを設定
      const worktreePath = await Deno.makeTempDir();
      try {
        (worker as any).worktreePath = worktreePath;
        
        await worker.processMessage("テストメッセージ");
        
        // コマンドラインに --append-system-prompt が含まれることを確認
        const appendIndex = mockExecutor.capturedArgs.indexOf("--append-system-prompt");
        assertEquals(appendIndex !== -1, true);
        
        // 次の引数が追加プロンプトであることを確認
        if (appendIndex !== -1) {
          assertEquals(mockExecutor.capturedArgs[appendIndex + 1], appendPrompt);
        }
      } finally {
        await Deno.remove(worktreePath, { recursive: true });
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
  
  it("appendSystemPromptが未設定の場合、コマンドに含まれない", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const workspaceManager = new WorkspaceManager(tempDir);
      await workspaceManager.initialize();
      
      const mockExecutor = new MockClaudeExecutor();
      
      const worker = new Worker(
        "test-worker",
        workspaceManager,
        mockExecutor,
        false,
        undefined, // appendSystemPrompt未設定
      );
      
      // worktreePathを設定
      const worktreePath = await Deno.makeTempDir();
      try {
        (worker as any).worktreePath = worktreePath;
        
        await worker.processMessage("テストメッセージ");
        
        // コマンドラインに --append-system-prompt が含まれないことを確認
        const appendIndex = mockExecutor.capturedArgs.indexOf("--append-system-prompt");
        assertEquals(appendIndex, -1);
      } finally {
        await Deno.remove(worktreePath, { recursive: true });
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});