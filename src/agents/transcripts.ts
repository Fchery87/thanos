import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentType } from "./registry";

export interface TranscriptMetadata {
  agentType: AgentType;
  status: "success" | "error" | "timeout";
  summary: string;
  startedAt: string;
  endedAt: string;
  metadata?: Record<string, unknown>;
}

export async function writeTranscriptMetadata(dir: string, meta: TranscriptMetadata): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "metadata.json"), JSON.stringify(meta, null, 2), "utf-8");
}
