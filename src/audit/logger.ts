import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEvent } from "./types";

export class AuditLogger {
  constructor(private path: string) {}

  async record(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(event) + "\n", "utf-8");
  }
}
