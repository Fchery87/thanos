#!/usr/bin/env bun
// Measure subagent/child-run frequency, duration, and error rate from
// agent/run-history.jsonl. Serves the W5.1 gate: is child cold-start still a
// felt cost AFTER inline-first (register-harness) cuts how often children spawn?
// Re-run over time — a falling runs/day after the inline-first change goes live
// means W5.1 (lazy child runtime) is unnecessary.
//
// Usage: bun scripts/measure-child-runs.mjs [--since YYYY-MM-DD] [--days N]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const sinceArg = args[args.indexOf("--since") + 1];
const daysArg = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : null;

const rows = readFileSync(join(root, "agent/run-history.jsonl"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && typeof r.ts === "number");

let cutoff = 0;
if (sinceArg) cutoff = Date.parse(sinceArg) / 1000;
else if (daysArg) cutoff = Date.now() / 1000 - daysArg * 86400;
const scoped = rows.filter((r) => r.ts >= cutoff);

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (v) => v >= 60000 ? `${(v / 60000).toFixed(1)}m` : `${(v / 1000).toFixed(1)}s`;
const durs = (rs) => rs.map((r) => r.duration).filter((d) => typeof d === "number");

const span = scoped.length ? (Math.max(...scoped.map((r) => r.ts)) - Math.min(...scoped.map((r) => r.ts))) / 86400 : 0;
const errRate = scoped.length ? (100 * scoped.filter((r) => r.status === "error").length / scoped.length) : 0;

console.log(`\nChild-run measurement  (${scoped.length} runs over ${span.toFixed(1)} days${cutoff ? `, since ${new Date(cutoff * 1000).toISOString().slice(0, 10)}` : ""})`);
console.log("=".repeat(64));
console.log(`runs/day        ${span > 0 ? (scoped.length / span).toFixed(1) : scoped.length}   ← the W5.1 signal (should fall after inline-first)`);
const d = durs(scoped);
console.log(`duration        median ${ms(pct(d, 50))}   p90 ${ms(pct(d, 90))}   max ${ms(Math.max(...d, 0))}`);
console.log(`error rate      ${errRate.toFixed(1)}%   (${scoped.filter((r) => r.status === "error").length}/${scoped.length})`);

// Weekly frequency trend — makes the inline-first effect visible on re-run.
console.log(`\nweekly frequency (runs/week, oldest→newest):`);
const byWeek = {};
for (const r of scoped) {
  const wk = new Date(r.ts * 1000).toISOString().slice(0, 10);
  const monday = new Date(Date.parse(wk));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const key = monday.toISOString().slice(0, 10);
  byWeek[key] = (byWeek[key] || 0) + 1;
}
for (const [wk, n] of Object.entries(byWeek).sort()) console.log(`  ${wk}  ${"█".repeat(Math.ceil(n / 5)).padEnd(20)} ${n}`);

// Per-role: which roles dominate child cost.
console.log(`\nby role (count · median · p90 · err%):`);
const roles = {};
for (const r of scoped) (roles[r.agent] ??= []).push(r);
for (const [role, rs] of Object.entries(roles).sort((a, b) => b[1].length - a[1].length)) {
  const rd = durs(rs);
  const e = 100 * rs.filter((x) => x.status === "error").length / rs.length;
  console.log(`  ${role.padEnd(28)} ${String(rs.length).padStart(3)} · ${ms(pct(rd, 50)).padStart(6)} · ${ms(pct(rd, 90)).padStart(6)} · ${e.toFixed(0)}%`);
}
console.log();
