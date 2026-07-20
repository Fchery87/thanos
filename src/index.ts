import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHarness } from "./runtime/register-harness";

export default function register(pi: ExtensionAPI, deps?: { initialYolo?: boolean }) {
  return registerHarness(pi, deps);
}
