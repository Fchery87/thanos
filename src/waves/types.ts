export type WaveSliceMode = "read" | "write";
export type WaveAgent = "explore" | "researcher" | "reviewer" | "oracle" | "build" | "worker" | "scout";

export interface WaveSlice {
  id: string;
  agent: WaveAgent;
  goal: string;
  paths: string[];
  mode: WaveSliceMode;
}

export interface WavePlan {
  width: number;
  maxDepth: number;
  slices: WaveSlice[];
}
