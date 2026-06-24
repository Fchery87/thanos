export function yoloDisabledByEnv(): boolean {
  return process.env.THANOS_YOLO_DISABLED?.trim() === "1";
}
