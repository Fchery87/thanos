const GIT_STAGE_PATH_RE = /^:(\d+):(.+)$/;

function looksLikeGitRevPath(token: string): { path: string } | undefined {
  const trimmed = token.trim();
  if (trimmed.startsWith("-") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return undefined;
  }

  const stageMatch = GIT_STAGE_PATH_RE.exec(trimmed);
  if (stageMatch) {
    const path = (stageMatch[2] ?? "").trim();
    if (path.length === 0) return undefined;
    return { path };
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1 || lastColon === 0 || lastColon === trimmed.length - 1) {
    return undefined;
  }

  const revisionPart = trimmed.slice(0, lastColon);
  const pathPart = trimmed.slice(lastColon + 1);

  if (pathPart.length === 0) return undefined;
  if (revisionPart.length === 0) return undefined;

  const NAMES = new Set([
    "HEAD", "FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD",
  ]);
  if (NAMES.has(revisionPart)) return { path: pathPart };
  if (/^[0-9a-fA-F]{7,40}$/.test(revisionPart)) return { path: pathPart };
  if (/^@(?:~|\^)?\d*$/.test(revisionPart)) return { path: pathPart };
  if (/^[a-zA-Z][\w.\-\/~]*$/.test(revisionPart)) return { path: pathPart };

  return undefined;
}

export function extractGitFilePath(token: string): string | undefined {
  const result = looksLikeGitRevPath(token);
  return result?.path;
}
