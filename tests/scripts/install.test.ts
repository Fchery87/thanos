import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = new URL("../..", import.meta.url).pathname;
const installer = join(root, "scripts", "install.sh");

async function writeExecutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
}

async function makeRelease(rootDir: string, version: string): Promise<{ tarball: string; sums: string; checksum: string }> {
  const source = join(rootDir, `thanos-${version}`);
  await mkdir(join(source, "scripts"), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "thanos-release", version }, null, 2), "utf-8");
  await writeFile(join(source, "mcp.example.json"), "{}\n", "utf-8");
  await writeFile(join(source, "scripts", "install.sh"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });

  const tarball = join(rootDir, `thanos-${version}.tar.gz`);
  await execFileAsync("tar", ["-czf", tarball, "-C", rootDir, `thanos-${version}`]);
  const { stdout } = await execFileAsync("sha256sum", [tarball]);
  const checksum = stdout.split(/\s+/)[0];
  const sums = join(rootDir, "SHA256SUMS");
  await writeFile(sums, `${checksum}  thanos-${version}.tar.gz\n`, "utf-8");
  return { tarball, sums, checksum };
}

async function makeFakeBin(dir: string, files: Record<string, string>): Promise<string> {
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeExecutable(join(bin, name), content);
  }
  return bin;
}

async function runInstaller(env: Record<string, string>, pathPrefix: string) {
  return execFileAsync("/bin/sh", [installer], {
    env: {
      HOME: env.HOME,
      PATH: pathPrefix,
      THANOS_DIR: env.THANOS_DIR,
      BIN_DIR: env.BIN_DIR,
      THANOS_VERSION: env.THANOS_VERSION,
      THANOS_RELEASE_BASE_URL: env.THANOS_RELEASE_BASE_URL,
      THANOS_LATEST_RELEASE_API_URL: env.THANOS_LATEST_RELEASE_API_URL,
    },
  });
}

describe("install.sh release bootstrap", () => {
  it("fails closed when no checksum command is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-no-checksum-"));
    const bin = await makeFakeBin(dir, {
      env: "#!/bin/sh\nexec /usr/bin/env \"$@\"\n",
      sh: "#!/bin/sh\nexec /bin/sh \"$@\"\n",
      mktemp: "#!/bin/sh\n/usr/bin/mktemp \"$@\"\n",
      pi: "#!/bin/sh\necho 'pi 0.74.0'\n",
    });

    await expect(runInstaller({
      HOME: dir,
      THANOS_DIR: join(dir, ".pi"),
      BIN_DIR: join(dir, "bin-out"),
      THANOS_VERSION: "v0.1.0",
      THANOS_RELEASE_BASE_URL: "https://example.test/releases",
      THANOS_LATEST_RELEASE_API_URL: "https://example.test/latest",
    }, bin)).rejects.toMatchObject({
      stderr: expect.stringContaining("Neither sha256sum nor shasum -a 256 found"),
    });
  });

  it("rejects release tarballs whose checksum does not match SHA256SUMS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-bad-checksum-"));
    const release = await makeRelease(dir, "v0.2.0");
    await writeFile(release.sums, `0000000000000000000000000000000000000000000000000000000000000000  thanos-v0.2.0.tar.gz\n`, "utf-8");
    const bin = await makeFakeBin(dir, {
      mktemp: "#!/bin/sh\n/usr/bin/mktemp \"$@\"\n",
      pi: "#!/bin/sh\necho 'pi 0.74.0'\n",
      curl: `#!/bin/sh\nout=''\nurl=''\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -o) out="$2"; shift 2 ;;\n    -*) shift ;;\n    *) url="$1"; shift ;;\n  esac\ndone\ncase "$url" in\n  */thanos-v0.2.0.tar.gz) cp '${release.tarball}' "$out" ;;\n  */SHA256SUMS) cp '${release.sums}' "$out" ;;\n  https://example.test/latest) printf '{"tag_name":"v0.2.0","prerelease":false}\n' > "$out" ;;\n  *) echo 'unexpected url' >&2; exit 2 ;;\nesac\n`,
      sha256sum: "#!/bin/sh\n/usr/bin/sha256sum \"$@\"\n",
      bun: "#!/bin/sh\nexit 0\n",
      npm: "#!/bin/sh\nexit 0\n",
    });

    await expect(runInstaller({
      HOME: dir,
      THANOS_DIR: join(dir, ".pi"),
      BIN_DIR: join(dir, "bin-out"),
      THANOS_VERSION: "v0.2.0",
      THANOS_RELEASE_BASE_URL: "https://example.test/releases",
      THANOS_LATEST_RELEASE_API_URL: "https://example.test/latest",
    }, `${bin}:/usr/bin:/bin`)).rejects.toMatchObject({
      stderr: expect.stringContaining("Checksum mismatch for thanos-v0.2.0.tar.gz"),
    });
  });

  it("installs the latest stable release from a verified source tarball", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-success-"));
    const release = await makeRelease(dir, "v0.3.0");
    const commandLog = join(dir, "commands.log");
    const bin = await makeFakeBin(dir, {
      mktemp: "#!/bin/sh\n/usr/bin/mktemp \"$@\"\n",
      pi: `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'pi 0.74.0'; exit 0; fi\necho "pi $*" >> '${commandLog}'\n`,
      curl: `#!/bin/sh\nout=''\nurl=''\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -o) out="$2"; shift 2 ;;\n    -*) shift ;;\n    *) url="$1"; shift ;;\n  esac\ndone\ncase "$url" in\n  https://example.test/latest) printf '{"tag_name":"v0.3.0","prerelease":false}\n' > "$out" ;;\n  */thanos-v0.3.0.tar.gz) cp '${release.tarball}' "$out" ;;\n  */SHA256SUMS) cp '${release.sums}' "$out" ;;\n  *) echo "unexpected url: $url" >&2; exit 2 ;;\nesac\n`,
      sha256sum: "#!/bin/sh\n/usr/bin/sha256sum \"$@\"\n",
      bun: `#!/bin/sh\necho "bun $*" >> '${commandLog}'\n`,
      npm: `#!/bin/sh\necho "npm $*" >> '${commandLog}'\n`,
    });

    const result = await runInstaller({
      HOME: dir,
      THANOS_DIR: join(dir, ".pi"),
      BIN_DIR: join(dir, "bin-out"),
      THANOS_VERSION: "",
      THANOS_RELEASE_BASE_URL: "https://example.test/releases",
      THANOS_LATEST_RELEASE_API_URL: "https://example.test/latest",
    }, `${bin}:/usr/bin:/bin`);

    await expect(stat(join(dir, ".pi", "package.json"))).resolves.toBeTruthy();
    await expect(stat(join(dir, ".pi", "scripts", "install.sh"))).resolves.toBeTruthy();
    await expect(stat(join(dir, "bin-out", "thanos"))).resolves.toBeTruthy();
    const installedPackage = await readFile(join(dir, ".pi", "package.json"), "utf-8");
    const log = await readFile(commandLog, "utf-8");

    expect(installedPackage).toContain('"version": "v0.3.0"');
    expect(log).toContain("bun install");
    expect(log).toContain("pi install .");
    expect(result.stdout).toContain("Resolved Thanos version: v0.3.0");
    expect(result.stdout).toContain(`Computed checksum: ${release.checksum}`);
    expect(result.stdout).toContain(`Install directory: ${join(dir, ".pi")}`);
    expect(result.stdout).toContain("Pi version: pi 0.74.0");
  });

  it("pins installs to an explicit version when requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-pinned-"));
    const release = await makeRelease(dir, "v1.2.3");
    const bin = await makeFakeBin(dir, {
      mktemp: "#!/bin/sh\n/usr/bin/mktemp \"$@\"\n",
      pi: "#!/bin/sh\necho 'pi 0.74.0'\n",
      curl: `#!/bin/sh\nout=''\nurl=''\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -o) out="$2"; shift 2 ;;\n    -*) shift ;;\n    *) url="$1"; shift ;;\n  esac\ndone\ncase "$url" in\n  */thanos-v1.2.3.tar.gz) cp '${release.tarball}' "$out" ;;\n  */SHA256SUMS) cp '${release.sums}' "$out" ;;\n  https://example.test/latest) printf '{"tag_name":"v9.9.9","prerelease":false}\n' > "$out" ;;\n  *) echo "unexpected url: $url" >&2; exit 2 ;;\nesac\n`,
      sha256sum: "#!/bin/sh\n/usr/bin/sha256sum \"$@\"\n",
      npm: "#!/bin/sh\nexit 0\n",
    });

    const result = await runInstaller({
      HOME: dir,
      THANOS_DIR: join(dir, ".pi"),
      BIN_DIR: join(dir, "bin-out"),
      THANOS_VERSION: "v1.2.3",
      THANOS_RELEASE_BASE_URL: "https://example.test/releases",
      THANOS_LATEST_RELEASE_API_URL: "https://example.test/latest",
    }, `${bin}:/usr/bin:/bin`);

    expect(result.stdout).toContain("Using requested Thanos version: v1.2.3");
    expect(result.stdout).not.toContain("Resolved Thanos version: v9.9.9");
    expect(result.stdout).toContain(`Computed checksum: ${release.checksum}`);
  });

  it("uses an existing checkout when --skip-clone is requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-install-skip-clone-"));
    const installDir = join(dir, ".pi");
    const commandLog = join(dir, "commands.log");
    await mkdir(join(installDir, "scripts"), { recursive: true });
    await writeFile(join(installDir, "package.json"), JSON.stringify({ name: "local-thanos" }, null, 2), "utf-8");
    await writeFile(join(installDir, "scripts", "install.sh"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });

    const bin = await makeFakeBin(dir, {
      pi: `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'pi 0.74.0'; exit 0; fi\necho "pi $*" >> '${commandLog}'\n`,
      curl: "#!/bin/sh\necho 'curl should not run for --skip-clone' >&2\nexit 2\n",
      npm: `#!/bin/sh\necho "npm $*" >> '${commandLog}'\n`,
    });

    const result = await execFileAsync("/bin/sh", [installer, "--skip-clone"], {
      env: {
        HOME: dir,
        PATH: `${bin}:/usr/bin:/bin`,
        THANOS_DIR: installDir,
        BIN_DIR: join(dir, "bin-out"),
        THANOS_VERSION: "v9.9.9",
        THANOS_RELEASE_BASE_URL: "https://example.test/releases",
        THANOS_LATEST_RELEASE_API_URL: "https://example.test/latest",
      },
    });

    const installedPackage = await readFile(join(installDir, "package.json"), "utf-8");
    const log = await readFile(commandLog, "utf-8");

    expect(installedPackage).toContain("local-thanos");
    expect(log).toContain("npm install");
    expect(log).toContain("pi install .");
    expect(result.stdout).toContain("Using existing Thanos checkout");
    expect(result.stdout).not.toContain("Artifact URL:");
  });
});
