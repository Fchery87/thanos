#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const isWindows = platform() === "win32";
const here = dirname(fileURLToPath(import.meta.url));

if (isWindows) {
  execFileSync("powershell", [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(here, "install.ps1"),
    ...process.argv.slice(2),
  ], { stdio: "inherit" });
} else {
  execFileSync("sh", [join(here, "install.sh"), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
}
