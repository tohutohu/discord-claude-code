import { IWorker, Worker } from "./worker.ts";
import { generateWorkerName } from "./worker-name-generator.ts";

export interface IAdmin {
  createWorker(threadId: string): Promise<IWorker>;
  getWorker(threadId: string): IWorker | null;
  routeMessage(threadId: string, message: string): Promise<string>;
}

export class Admin implements IAdmin {
  private workers: Map<string, IWorker>;

  constructor() {
    this.workers = new Map();
  }

  createWorker(threadId: string): Promise<IWorker> {
    // 既にWorkerが存在する場合はそれを返す
    const existingWorker = this.workers.get(threadId);
    if (existingWorker) {
      return Promise.resolve(existingWorker);
    }

    // 新しいWorkerを作成
    const workerName = generateWorkerName();
    const worker = new Worker(workerName);
    this.workers.set(threadId, worker);

    return Promise.resolve(worker);
  }

  getWorker(threadId: string): IWorker | null {
    return this.workers.get(threadId) || null;
  }

  routeMessage(threadId: string, message: string): Promise<string> {
    const worker = this.workers.get(threadId);
    if (!worker) {
      return Promise.reject(
        new Error(`Worker not found for thread: ${threadId}`),
      );
    }

    return worker.processMessage(message);
  }
}
