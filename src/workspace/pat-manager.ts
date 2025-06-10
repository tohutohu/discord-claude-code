import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { RepositoryPatInfo } from "../workspace.ts";

export class PatManager {
  private readonly patsDir: string;

  constructor(baseDir: string) {
    this.patsDir = join(baseDir, "pats");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.patsDir);
  }

  private getPatFilePath(repositoryFullName: string): string {
    const safeName = repositoryFullName.replace(/\//g, "_");
    return join(this.patsDir, `${safeName}.json`);
  }

  async saveRepositoryPat(patInfo: RepositoryPatInfo): Promise<void> {
    const filePath = this.getPatFilePath(patInfo.repositoryFullName);
    patInfo.updatedAt = new Date().toISOString();
    await Deno.writeTextFile(filePath, JSON.stringify(patInfo, null, 2));
  }

  async loadRepositoryPat(
    repositoryFullName: string,
  ): Promise<RepositoryPatInfo | null> {
    try {
      const filePath = this.getPatFilePath(repositoryFullName);
      const content = await Deno.readTextFile(filePath);
      return JSON.parse(content) as RepositoryPatInfo;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async deleteRepositoryPat(repositoryFullName: string): Promise<void> {
    const filePath = this.getPatFilePath(repositoryFullName);
    try {
      await Deno.remove(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async listRepositoryPats(): Promise<RepositoryPatInfo[]> {
    try {
      const pats: RepositoryPatInfo[] = [];

      for await (const entry of Deno.readDir(this.patsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const filePath = join(this.patsDir, entry.name);
          const content = await Deno.readTextFile(filePath);
          pats.push(JSON.parse(content) as RepositoryPatInfo);
        }
      }

      return pats.sort((a, b) =>
        a.repositoryFullName.localeCompare(b.repositoryFullName)
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async updatePatDescription(
    repositoryFullName: string,
    description: string,
  ): Promise<void> {
    const patInfo = await this.loadRepositoryPat(repositoryFullName);
    if (patInfo) {
      patInfo.description = description;
      await this.saveRepositoryPat(patInfo);
    }
  }

  async isPatExpired(
    repositoryFullName: string,
    expiryDays: number,
  ): Promise<boolean> {
    const patInfo = await this.loadRepositoryPat(repositoryFullName);
    if (!patInfo) {
      return true;
    }

    const createdDate = new Date(patInfo.createdAt);
    const expiryDate = new Date(createdDate);
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    return new Date() > expiryDate;
  }

  async cleanupExpiredPats(expiryDays: number): Promise<string[]> {
    const allPats = await this.listRepositoryPats();
    const deletedPats: string[] = [];

    for (const patInfo of allPats) {
      if (await this.isPatExpired(patInfo.repositoryFullName, expiryDays)) {
        await this.deleteRepositoryPat(patInfo.repositoryFullName);
        deletedPats.push(patInfo.repositoryFullName);
      }
    }

    return deletedPats;
  }
}
