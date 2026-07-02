export interface HarnessChangeManifest {
  id: string;
  createdAt: string;
  failureEvidence: string[];
  rootCause: string;
  targetedFix: string;
  predictedImpact: string;
  regressionRisk: string;
  followUpCheck: string;
}

function requireText(value: string, field: keyof HarnessChangeManifest): void {
  if (value.trim().length === 0) {
    throw new Error(`Harness change manifest requires ${field}`);
  }
}

export function validateHarnessChange(manifest: HarnessChangeManifest): HarnessChangeManifest {
  requireText(manifest.id, "id");
  requireText(manifest.createdAt, "createdAt");
  if (manifest.failureEvidence.length === 0 || manifest.failureEvidence.every((item) => item.trim().length === 0)) {
    throw new Error("Harness change manifest requires failure evidence");
  }
  requireText(manifest.rootCause, "rootCause");
  requireText(manifest.targetedFix, "targetedFix");
  requireText(manifest.predictedImpact, "predictedImpact");
  requireText(manifest.regressionRisk, "regressionRisk");
  requireText(manifest.followUpCheck, "followUpCheck");
  return manifest;
}

export function serializeHarnessChange(manifest: HarnessChangeManifest): string {
  return `${JSON.stringify(validateHarnessChange(manifest))}\n`;
}
