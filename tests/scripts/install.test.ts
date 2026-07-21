import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = new URL("../..", import.meta.url).pathname;
const installer = join(root, "scripts", "install.sh");
const shellExecutable = process.platform === "win32" ? "sh" : "/bin/sh";
const pathSeparator = process.platform === "win32" ? ";" : ":";

function withSystemPath(bin: string): string {
  const base = process.env.PATH ?? "";
  return base.length > 0 ? `${bin}${pathSeparator}${base}` : bin;
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [
    "-c", "user.email=test@thanos.test",
    "-c", "user.name=Thanos Test",
    "-C", cwd,
    ...args,
  ]);
  return stdout.trim();
}

/** Build an origin repo with release tags v0.1.0 and v0.2.0. */
async function makeOrigin(rootDir: string): Promise<string> {
  const origin = join(rootDir, "origin");
  await mkdir(join(origin, "scripts"), { recursive: true });
  await mkdir(join(origin, "agent"), { recursive: true });
  await execFileAsync("git", ["init", "-b", "master", origin]);

  await writeFile(join(origin, "package.json"), JSON.stringify({ name: "thanos", version: "0.1.0" }, null, 2), "utf-8");
  await writeFile(join(origin, "bun.lock"), "# mock lockfile\n", "utf-8");
  await writeFile(join(origin, "mcp.example.json"), "{}\n", "utf-8");
  await writeFile(join(origin, "agent", "models.example.json"), '{"catalog":"v1"}\n', "utf-8");
  await writeExecutable(join(origin, "scripts", "install.sh"), "#!/usr/bin/env sh\nexit 0\n");
  await writeExecutable(join(origin, "scripts", "patch-pi-subagents.mjs"), "// noop\n");
  await git(origin, "add", "-A");
  await git(origin, "commit", "-m", "release v0.1.0");
  await git(origin, "tag", "v0.1.0");

  await writeFile(join(origin, "package.json"), JSON.stringify({ name: "thanos", version: "0.2.0" }, null, 2), "utf-8");
  await git(origin, "add", "-A");
  await git(origin, "commit", "-m", "release v0.2.0");
  await git(origin, "tag", "v0.2.0");

  return origin;
}

/** Cut another release in the origin repo. */
async function cutRelease(origin: string, version: string): Promise<void> {
  await writeFile(join(origin, "package.json"), JSON.stringify({ name: "thanos", version: version.replace(/^v/, "") }, null, 2), "utf-8");
  await git(origin, "add", "-A");
  await git(origin, "commit", "-m", `release ${version}`);
  await git(origin, "tag", version);
}

async function makeFakeBin(dir: string, commandLog: string): Promise<string> {
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeExecutable(join(bin, "pi"), `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'pi 0.80.6'; exit 0; fi\necho "pi $*" >> '${commandLog}'\n`);
  await writeExecutable(join(bin, "bun"), `#!/bin/sh\necho "bun $*" >> '${commandLog}'\n`);
  await writeExecutable(join(bin, "npm"), `#!/bin/sh\necho "npm $*" >> '${commandLog}'\n`);
  await writeExecutable(join(bin, "node"), `#!/bin/sh\necho "node $*" >> '${commandLog}'\n`);
  return bin;
}

interface InstallEnv {
  HOME: string;
  THANOS_DIR: string;
  BIN_DIR: string;
  THANOS_REPO_URL: string;
  THANOS_REF?: string;
}

async function runInstaller(env: InstallEnv, pathPrefix: string, args: string[] = []) {
  return execFileAsync(shellExecutable, [installer, ...args], {
    env: {
      HOME: env.HOME,
      PATH: pathPrefix,
      THANOS_DIR: env.THANOS_DIR,
      BIN_DIR: env.BIN_DIR,
      THANOS_REPO_URL: env.THANOS_REPO_URL,
      ...(env.THANOS_REF ? { THANOS_REF: env.THANOS_REF } : {}),
    },
  });
}

describe("install.sh git bootstrap", () => {
  it("clones and checks out the latest release tag on fresh install", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-fresh-"));
    const origin = await makeOrigin(dir);
    const commandLog = join(dir, "commands.log");
    const bin = await makeFakeBin(dir, commandLog);
    const installDir = join(dir, ".pi");

    const result = await runInstaller(
      { HOME: dir, THANOS_DIR: installDir, BIN_DIR: join(dir, "bin-out"), THANOS_REPO_URL: origin },
      withSystemPath(bin),
    );

    expect(result.stdout).toContain("Resolved latest release: v0.2.0");
    const installedPackage = await readFile(join(installDir, "package.json"), "utf-8");
    expect(installedPackage).toContain('"version": "0.2.0"');

    // template copies created for user-owned config
    await expect(stat(join(installDir, "mcp.json"))).resolves.toBeTruthy();
    const models = await readFile(join(installDir, "agent", "models.json"), "utf-8");
    expect(models).toContain('"catalog":"v1"');

    // launcher installed
    const wrapper = await readFile(join(dir, "bin-out", "thanos"), "utf-8");
    expect(wrapper).toContain("exec pi");
    expect(wrapper).not.toContain("--ref");

    // `thanos version` reports the checked-out tag without launching pi
    const versionOut = await execFileAsync(shellExecutable, [join(dir, "bin-out", "thanos"), "version"], {
      env: { HOME: dir, THANOS_DIR: installDir, PATH: withSystemPath(bin) },
    });
    expect(versionOut.stdout).toContain("thanos v0.2.0");
    expect(versionOut.stdout).toContain("pi 0.80.6");

    const log = await readFile(commandLog, "utf-8");
    expect(log).toContain("bun install");
    expect(log).toContain("pi install .");
  });

  it("updates an existing checkout to a new release and preserves user config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-update-"));
    const origin = await makeOrigin(dir);
    const commandLog = join(dir, "commands.log");
    const bin = await makeFakeBin(dir, commandLog);
    const installDir = join(dir, ".pi");
    const env = { HOME: dir, THANOS_DIR: installDir, BIN_DIR: join(dir, "bin-out"), THANOS_REPO_URL: origin };

    await runInstaller(env, withSystemPath(bin));

    // user customizes gitignored config and adds credentials after install
    await writeFile(join(installDir, "agent", "models.json"), '{"catalog":"user-edited"}\n', "utf-8");
    await writeFile(join(installDir, "agent", "auth.json"), '{"secret":"keep-me"}\n', "utf-8");

    await cutRelease(origin, "v0.3.0");
    const result = await runInstaller(env, withSystemPath(bin));

    expect(result.stdout).toContain("Updating existing Thanos checkout");
    expect(result.stdout).toContain("Resolved latest release: v0.3.0");
    const installedPackage = await readFile(join(installDir, "package.json"), "utf-8");
    expect(installedPackage).toContain('"version": "0.3.0"');

    // user files survived the update untouched
    const models = await readFile(join(installDir, "agent", "models.json"), "utf-8");
    expect(models).toContain("user-edited");
    const auth = await readFile(join(installDir, "agent", "auth.json"), "utf-8");
    expect(auth).toContain("keep-me");
  });

  it("pins to an explicit ref when requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-pinned-"));
    const origin = await makeOrigin(dir);
    const bin = await makeFakeBin(dir, join(dir, "commands.log"));
    const installDir = join(dir, ".pi");

    const result = await runInstaller(
      { HOME: dir, THANOS_DIR: installDir, BIN_DIR: join(dir, "bin-out"), THANOS_REPO_URL: origin },
      withSystemPath(bin),
      ["--ref", "v0.1.0"],
    );

    expect(result.stdout).toContain("Using requested ref: v0.1.0");
    expect(result.stdout).not.toContain("Resolved latest release");
    const installedPackage = await readFile(join(installDir, "package.json"), "utf-8");
    expect(installedPackage).toContain('"version": "0.1.0"');
  });

  it("refuses to overwrite an existing non-Thanos directory without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-collision-"));
    const origin = await makeOrigin(dir);
    const bin = await makeFakeBin(dir, join(dir, "commands.log"));
    const installDir = join(dir, ".pi");
    await mkdir(installDir, { recursive: true });
    await writeFile(join(installDir, "precious.txt"), "not thanos\n", "utf-8");

    await expect(runInstaller(
      { HOME: dir, THANOS_DIR: installDir, BIN_DIR: join(dir, "bin-out"), THANOS_REPO_URL: origin },
      withSystemPath(bin),
    )).rejects.toMatchObject({
      stderr: expect.stringContaining("already exists and is not the Thanos repository"),
    });

    // the existing directory was left alone
    const precious = await readFile(join(installDir, "precious.txt"), "utf-8");
    expect(precious).toContain("not thanos");
  });

  it("uses an existing checkout when --skip-clone is requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-skip-clone-"));
    const commandLog = join(dir, "commands.log");
    const installDir = join(dir, ".pi");
    await mkdir(join(installDir, "scripts"), { recursive: true });
    await writeFile(join(installDir, "package.json"), JSON.stringify({ name: "local-thanos" }, null, 2), "utf-8");
    await writeFile(join(installDir, "bun.lock"), "# mock lockfile\n", "utf-8");
    await writeExecutable(join(installDir, "scripts", "install.sh"), "#!/usr/bin/env sh\nexit 0\n");
    await writeExecutable(join(installDir, "scripts", "patch-pi-subagents.mjs"), "// noop\n");
    const bin = await makeFakeBin(dir, commandLog);

    const result = await runInstaller(
      { HOME: dir, THANOS_DIR: installDir, BIN_DIR: join(dir, "bin-out"), THANOS_REPO_URL: join(dir, "nonexistent-origin") },
      withSystemPath(bin),
      ["--skip-clone"],
    );

    const installedPackage = await readFile(join(installDir, "package.json"), "utf-8");
    const log = await readFile(commandLog, "utf-8");

    expect(installedPackage).toContain("local-thanos");
    expect(log).toContain("pi install .");
    expect(result.stdout).toContain("Using existing Thanos checkout");
  });
});
