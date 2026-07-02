export function yoloDisabledByEnv(): boolean {
  return process.env.THANOS_YOLO_DISABLED?.trim() === "1";
}

export function gateDisabledByEnv(): boolean {
  return process.env.THANOS_VERIFY_GATE?.trim().toLowerCase() === "off";
}
