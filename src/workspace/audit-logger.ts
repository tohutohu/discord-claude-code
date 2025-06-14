import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { AuditEntry } from "./workspace.ts";
import { err, ok, Result } from "neverthrow";
import type { WorkspaceError } from "./types.ts";
import { validateAuditEntrySafe } from "./schemas/audit-schema.ts";

export class AuditLogger {
  private readonly auditDir: string;

  constructor(baseDir: string) {
    this.auditDir = join(baseDir, "audit");
  }

  async initialize(): Promise<Result<void, WorkspaceError>> {
    try {
      await ensureDir(this.auditDir);
      return ok(undefined);
    } catch (error) {
      return err({
        type: "DIRECTORY_CREATE_FAILED",
        path: this.auditDir,
        error: `AuditLoggerの初期化に失敗しました: ${error}`,
      });
    }
  }

  private getAuditFilePath(date: string): string {
    return join(this.auditDir, date, "activity.jsonl");
  }

  async appendAuditLog(
    auditEntry: AuditEntry,
  ): Promise<Result<void, WorkspaceError>> {
    const date = new Date().toISOString().split("T")[0];
    const auditDateDir = join(this.auditDir, date);

    try {
      await ensureDir(auditDateDir);
    } catch (error) {
      // 監査ログの記録失敗は運用に影響を与えないため、エラーログのみ出力
      console.error(`監査ログディレクトリの作成に失敗しました: ${error}`);
      return ok(undefined);
    }

    const filePath = this.getAuditFilePath(date);
    const logLine = `${JSON.stringify(auditEntry)}\n`;

    try {
      await Deno.writeTextFile(filePath, logLine, { append: true });
      return ok(undefined);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        try {
          await Deno.writeTextFile(filePath, logLine);
          return ok(undefined);
        } catch (writeError) {
          // 監査ログの記録失敗は運用に影響を与えないため、エラーログのみ出力
          console.error(`監査ログの書き込みに失敗しました: ${writeError}`);
          return ok(undefined);
        }
      } else {
        // 監査ログの記録失敗は運用に影響を与えないため、エラーログのみ出力
        console.error(`監査ログの追記に失敗しました: ${error}`);
        return ok(undefined);
      }
    }
  }

  async getAuditLogs(
    date: string,
  ): Promise<Result<AuditEntry[], WorkspaceError>> {
    const filePath = this.getAuditFilePath(date);

    try {
      const content = await Deno.readTextFile(filePath);
      const lines = content.trim().split("\n").filter((line) =>
        line.length > 0
      );

      const entries: AuditEntry[] = [];
      for (const line of lines) {
        try {
          const result = validateAuditEntrySafe(JSON.parse(line));
          if (result.success) {
            entries.push(result.data);
          } else {
            console.error(`Invalid audit entry:`, result.error);
          }
        } catch (parseError) {
          console.error(`Failed to parse audit log line:`, parseError);
        }
      }
      return ok(entries);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok([]);
      }
      return err({
        type: "FILE_READ_FAILED",
        path: filePath,
        error: `監査ログの読み込みに失敗しました: ${error}`,
      });
    }
  }

  async getAuditLogDates(): Promise<Result<string[], WorkspaceError>> {
    try {
      const dates: string[] = [];

      for await (const entry of Deno.readDir(this.auditDir)) {
        if (entry.isDirectory) {
          // ディレクトリ名が日付形式（YYYY-MM-DD）かチェック
          if (/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
            dates.push(entry.name);
          }
        }
      }

      return ok(dates.sort().reverse()); // 新しい日付順
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok([]);
      }
      return err({
        type: "REPOSITORY_READ_FAILED",
        error: `監査ログディレクトリの読み込みに失敗しました: ${error}`,
      });
    }
  }

  async getAuditLogsByThread(
    threadId: string,
    date?: string,
  ): Promise<Result<AuditEntry[], WorkspaceError>> {
    const datesResult = date ? ok([date]) : await this.getAuditLogDates();
    if (datesResult.isErr()) {
      return err(datesResult.error);
    }

    const dates = datesResult.value;
    const allLogs: AuditEntry[] = [];

    for (const d of dates) {
      const logsResult = await this.getAuditLogs(d);
      if (logsResult.isErr()) {
        // 個別の読み込みエラーはスキップしてログのみ出力
        console.error(
          `監査ログの読み込みに失敗しました (${d}):`,
          logsResult.error,
        );
        continue;
      }
      const threadLogs = logsResult.value.filter((log) =>
        log.threadId === threadId
      );
      allLogs.push(...threadLogs);
    }

    return ok(allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
  }

  async getAuditLogsByAction(
    action: string,
    date?: string,
  ): Promise<Result<AuditEntry[], WorkspaceError>> {
    const datesResult = date ? ok([date]) : await this.getAuditLogDates();
    if (datesResult.isErr()) {
      return err(datesResult.error);
    }

    const dates = datesResult.value;
    const allLogs: AuditEntry[] = [];

    for (const d of dates) {
      const logsResult = await this.getAuditLogs(d);
      if (logsResult.isErr()) {
        // 個別の読み込みエラーはスキップしてログのみ出力
        console.error(
          `監査ログの読み込みに失敗しました (${d}):`,
          logsResult.error,
        );
        continue;
      }
      const actionLogs = logsResult.value.filter((log) =>
        log.action === action
      );
      allLogs.push(...actionLogs);
    }

    return ok(allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
  }

  async cleanupOldAuditLogs(
    daysToKeep: number,
  ): Promise<Result<void, WorkspaceError>> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    try {
      for await (const entry of Deno.readDir(this.auditDir)) {
        if (entry.isDirectory && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
          if (entry.name < cutoffDateStr) {
            const dirPath = join(this.auditDir, entry.name);
            try {
              await Deno.remove(dirPath, { recursive: true });
            } catch (removeError) {
              // 削除エラーは運用に影響を与えないため、エラーログのみ出力
              console.error(
                `古い監査ログディレクトリの削除に失敗しました (${dirPath}): ${removeError}`,
              );
            }
          }
        }
      }
      return ok(undefined);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok(undefined);
      }
      // クリーンアップエラーは運用に影響を与えないため、エラーログのみ出力
      console.error(`監査ログのクリーンアップに失敗しました: ${error}`);
      return ok(undefined);
    }
  }
}
