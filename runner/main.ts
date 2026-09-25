import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkCell } from "./check";
import { fetchPackages } from "./hub";
import { planCells } from "./plan";
import { runPool } from "./pool";
import { ensureRelease, listReleases } from "./releases";
import { appendResults, readResults, writeJSON } from "./store";
import type { Cell } from "./types";

const { values: a } = parseArgs({ options: {
  "budget-min": { type: "string", default: "45" },
  jobs: { type: "string", default: "4" },
  limit: { type: "string" },
  data: { type: "string", default: "data" },
  cache: { type: "string", default: "cache" },
} });
const data = resolve(a.data!), cache = resolve(a.cache!);
const deadline = Date.now() + Number(a["budget-min"]) * 60_000;
const resultsPath = join(data, "results.jsonl");

const [pkgs, releases] = await Promise.all([fetchPackages(), listReleases()]);
const results = await readResults(resultsPath);
let todos = planCells(pkgs, releases, results, new Date());
if (a.limit) todos = todos.slice(0, Number(a.limit));
console.log(`${pkgs.length} packages, ${releases.length} releases, ${todos.length} cells to check`);

const bins = new Map<string, string>();
for (const v of new Set(todos.map((t) => t.bend)))
  bins.set(v, await ensureRelease(releases.find((r) => r.version === v)!, cache));

await writeJSON(join(data, "packages.json"), Object.fromEntries(pkgs.map((p) => [p.hash, p])));
await writeJSON(join(data, "releases.json"),
  releases.map(({ version, published_at }) => ({ version, published_at })));

let batch: Cell[] = [], done = 0, dropped = 0;
const flush = async () => { const out = batch; batch = []; await appendResults(resultsPath, out); };
const started = await runPool(todos, Number(a.jobs), deadline,
  (t) => checkCell(t, { bin: bins.get(t.bend)!, libDir: join(cache, "lib"), timeoutMs: 60_000 }),
  (c) => {
    if (!c) { dropped++; return; }
    batch.push(c); done++;
    if (done % 25 === 0) console.log(`${done}/${todos.length}`);
    if (batch.length >= 50) void flush();
  });
await flush();
console.log(`checked ${done}, dropped ${dropped} on connection errors, ${todos.length - started} left for next run`);
