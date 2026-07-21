import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  event: string;
  details: Record<string, unknown>;
}

interface QueueItem {
  entry: AuditEntry;
  resolve: () => void;
  reject: (err: Error) => void;
}

const MAX_QUEUE_SIZE = 1000;
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_DEADLINE_MS = 5000;

export class AuditQueue {
  private queue: QueueItem[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  private closed = false;

  constructor(
    private path: string,
    private mandatory = false,
  ) {}

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  async enqueue(entry: AuditEntry): Promise<void> {
    if (this.closed) return;

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      if (this.mandatory) {
        throw new Error("audit queue overflow — audit is mandatory");
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ entry, resolve, reject });
    });
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    const batch = this.queue.splice(0, this.queue.length);

    try {
      await mkdir(dirname(this.path), { recursive: true });
      const lines = batch.map((item) => JSON.stringify(item.entry)).join("\n") + "\n";
      await appendFile(this.path, lines, "utf-8");
      for (const item of batch) item.resolve();
    } catch (err) {
      for (const item of batch) item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.flushing = false;
    }
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);

    const deadline = Date.now() + FLUSH_DEADLINE_MS;
    while (this.queue.length > 0 && Date.now() < deadline) {
      await this.flush();
    }

    if (this.queue.length > 0 && this.mandatory) {
      console.error(`[harness][audit] ${this.queue.length} audit entries lost on shutdown`);
    }
  }
}
