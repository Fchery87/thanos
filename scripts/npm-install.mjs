#!/usr/bin/env node
import { execSync } from "node:child_process";
import { platform } from "node:os";

const isWindows = platform() === "win32";

if (isWindows) {
  const url =
    "https://raw.githubusercontent.com/fchery87/thanos/master/scripts/install.ps1";
  execSync(
    `powershell -ExecutionPolicy Bypass -Command "irm ${url} | iex"`,
    { stdio: "inherit" }
  );
} else {
  const url =
    "https://raw.githubusercontent.com/fchery87/thanos/master/scripts/install.sh";
  execSync(`curl -fsSL ${url} | sh`, { stdio: "inherit" });
}
