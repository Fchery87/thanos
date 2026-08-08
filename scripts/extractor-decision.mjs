#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  decideExtractorFate,
  readExtractionLedgerRows,
  MIN_QUALIFYING_SAMPLE,
  ACCEPT_RATE_THRESHOLD,
} from "../src/spec/extractor-decision.ts";

function getGitRevision(dir) {
  try {
    return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    repository: process.cwd(),
    since: "2026-07-27T00:00:00.000Z",
    until: new Date().toISOString(),
    revision: undefined,
    digest: "contract-schema-v1",
    ledgers: [],
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repository" || arg === "-r") {
      options.repository = resolve(args[++i]);
    } else if (arg === "--since" || arg === "-s") {
      options.since = args[++i];
    } else if (arg === "--until" || arg === "-u") {
      options.until = args[++i];
    } else if (arg === "--revision" || arg === "-v") {
      options.revision = args[++i];
    } else if (arg === "--digest" || arg === "-d") {
      options.digest = args[++i];
    } else if (arg === "--ledger" || arg === "-l") {
      options.ledgers.push(resolve(args[++i]));
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun scripts/extractor-decision.mjs [options]

Options:
  -r, --repository <path>  Target repository path (default: current directory)
  -s, --since <iso>        Start of observation window (default: 2026-07-27T00:00:00.000Z)
  -u, --until <iso>        End of observation window (default: now)
  -v, --revision <sha>     Git revision (default: git rev-parse HEAD)
  -d, --digest <digest>    Contract schema digest (default: contract-schema-v1)
  -l, --ledger <path>      Explicit path to ledger events.jsonl (repeatable)
      --json               Output raw JSON ExtractorDecisionRecord
  -h, --help               Show this help message
`);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      options.ledgers.push(resolve(arg));
    }
  }

  if (!options.revision) {
    options.revision = getGitRevision(options.repository);
  }

  // Fail here rather than letting decideExtractorFate throw mid-run: a bad
  // --since/--until is a usage error and deserves a usage error's message.
  for (const [flag, value] of [["--since", options.since], ["--until", options.until]]) {
    if (Number.isNaN(Date.parse(value))) {
      console.error(`${flag} is not a parseable timestamp: ${JSON.stringify(value)}`);
      console.error("Use an ISO-8601 instant, e.g. 2026-07-27T00:00:00.000Z");
      process.exit(1);
    }
  }
  if (Date.parse(options.until) < Date.parse(options.since)) {
    console.error(`--until (${options.until}) precedes --since (${options.since}).`);
    process.exit(1);
  }

  return options;
}

function discoverLedgers(targetRepo, explicitLedgers) {
  if (explicitLedgers.length > 0) {
    return explicitLedgers.filter((p) => existsSync(p));
  }

  const candidates = new Set();
  const repoLedger = join(targetRepo, ".harness", "evolution", "events.jsonl");
  if (existsSync(repoLedger)) candidates.add(repoLedger);

  const home = process.env.HOME;
  if (home) {
    const homeLedger = join(home, ".pi", ".harness", "evolution", "events.jsonl");
    if (existsSync(homeLedger)) candidates.add(homeLedger);
  }

  return Array.from(candidates);
}

async function main() {
  const options = parseArgs();
  const ledgerFiles = discoverLedgers(options.repository, options.ledgers);

  if (ledgerFiles.length === 0) {
    console.error("No ledger files (.harness/evolution/events.jsonl) found.");
    process.exit(1);
  }

  const window = {
    id: `eval-${Date.now()}`,
    repository: options.repository,
    revision: options.revision,
    start: options.since,
    end: options.until,
    contractSchemaDigest: options.digest,
  };

  const { rows, truncated } = await readExtractionLedgerRows(ledgerFiles);
  const decision = decideExtractorFate({ window, rows });

  if (options.json) {
    console.log(JSON.stringify(decision, null, 2));
    return;
  }

  console.log("=== Extractor Decision Report ===");
  console.log(`Window ID:           ${decision.window.id}`);
  console.log(`Repository:          ${decision.window.repository}`);
  console.log(`Revision:            ${decision.window.revision} (declared; no row carries this field)`);
  console.log(`Time Range:          ${decision.window.start} → ${decision.window.end}`);
  console.log(`Schema Digest:       ${decision.window.contractSchemaDigest} (declared; no row carries this field)`);
  console.log(`Ledgers Read:        ${ledgerFiles.join(", ")}`);
  console.log(`Total Rows Parsed:   ${rows.length}${truncated ? " (truncated)" : ""}`);
  console.log(`Rows Admitted:       ${decision.acceptedRowCount}  (in-window; not the accept count)`);
  console.log(`Rows Rejected:       ${decision.rejectedRowCount}`);

  if (Object.keys(decision.rejectionReasons).length > 0) {
    console.log("\nRejection Reasons:");
    for (const [reason, count] of Object.entries(decision.rejectionReasons)) {
      console.log(`  - ${reason.padEnd(20)}: ${count}`);
    }
  }

  console.log("\nOutcome Counts:");
  for (const [outcome, count] of Object.entries(decision.outcomeCounts)) {
    console.log(`  - ${outcome.padEnd(20)}: ${count}`);
  }

  console.log("\n=== Fate Verdict ===");
  console.log(`Qualifying Total:    ${decision.qualifyingTotal} (min required: ${MIN_QUALIFYING_SAMPLE})`);
  console.log(`Accepted Count:      ${decision.acceptedCount} (of the qualifying total)`);
  console.log(`Accept Rate:         ${decision.acceptRate !== undefined ? (decision.acceptRate * 100).toFixed(1) + "%" : "N/A"} (threshold: ${ACCEPT_RATE_THRESHOLD * 100}%)`);
  console.log(`Verdict:             ${decision.verdict.toUpperCase()}`);

  const timeouts = decision.outcomeCounts.timeout ?? 0;
  const admitted = decision.acceptedRowCount;
  if (admitted > 0 && timeouts > 0) {
    const timeoutRate = ((timeouts / admitted) * 100).toFixed(1);
    console.log(`\nNote on Timeouts:    ${timeouts}/${admitted} (${timeoutRate}%) of admitted rows timed out.`);
    console.log(`                     Scoped to this window only — NOT the population rate.`);
    console.log(`                     ADR 0006 (2026-08-08) records the all-ledger figure.`);
    console.log(`                     Rows carry no "model" field, so this rate cannot be`);
    console.log(`                     attributed to any model yet.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
