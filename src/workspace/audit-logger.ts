import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { AuditEntry } from "../workspace.ts";
import { validateAuditEntrySafe } from "./schemas/audit-schema.ts";

export class AuditLogger {
  private readonly auditDir: string;

  constructor(baseDir: string) {
    this.auditDir = join(baseDir, "audit");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.auditDir);
  }

  private getAuditFilePath(date: string): string {
    return join(this.auditDir, date, "activity.jsonl");
  }

  async appendAuditLog(auditEntry: AuditEntry): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    const auditDateDir = join(this.auditDir, date);
    await ensureDir(auditDateDir);

    const filePath = this.getAuditFilePath(date);
    const logLine = `${JSON.stringify(auditEntry)}\n`;

    try {
      await Deno.writeTextFile(filePath, logLine, { append: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.writeTextFile(filePath, logLine);
      } else {
        throw error;
      }
    }
  }

  async getAuditLogs(date: string): Promise<AuditEntry[]> {
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
      return entries;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async getAuditLogDates(): Promise<string[]> {
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

      return dates.sort().reverse(); // 新しい日付順
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async getAuditLogsByThread(
    threadId: string,
    date?: string,
  ): Promise<AuditEntry[]> {
    const dates = date ? [date] : await this.getAuditLogDates();
    const allLogs: AuditEntry[] = [];

    for (const d of dates) {
      const logs = await this.getAuditLogs(d);
      const threadLogs = logs.filter((log) => log.threadId === threadId);
      allLogs.push(...threadLogs);
    }

    return allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async getAuditLogsByAction(
    action: string,
    date?: string,
  ): Promise<AuditEntry[]> {
    const dates = date ? [date] : await this.getAuditLogDates();
    const allLogs: AuditEntry[] = [];

    for (const d of dates) {
      const logs = await this.getAuditLogs(d);
      const actionLogs = logs.filter((log) => log.action === action);
      allLogs.push(...actionLogs);
    }

    return allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async cleanupOldAuditLogs(daysToKeep: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    try {
      for await (const entry of Deno.readDir(this.auditDir)) {
        if (entry.isDirectory && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
          if (entry.name < cutoffDateStr) {
            const dirPath = join(this.auditDir, entry.name);
            await Deno.remove(dirPath, { recursive: true });
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}
