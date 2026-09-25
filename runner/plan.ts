import { type Cell, type Pkg, type Release, RUNNER, type Todo } from "./types";
import { cmpVersion } from "./versions";

const DAY = 24 * 3600 * 1000;

export function bendFiles(p: Pkg): string[] {
  return Object.keys(p.files).filter((f) => f.endsWith(".bend")).sort();
}

export function planCells(pkgs: Pkg[], releases: Release[], results: Cell[], now: Date, runner = RUNNER): Todo[] {
  const latest = new Map<string, Cell>();
  for (const c of results) latest.set(`${c.pkg}|${c.file}|${c.bend}`, c);
  const stale = (c: Cell | undefined) =>
    !c || c.runner < runner ||
    (c.status === "dep_missing" && now.getTime() - Date.parse(c.checked_at) >= DAY);

  const rels = releases.filter((r) => r.asset_url).sort((a, b) => cmpVersion(b.version, a.version));
  const ps = [...pkgs].sort((a, b) => b.ts - a.ts);
  const out: Todo[] = [];
  for (const r of rels)
    for (const p of ps)
      for (const file of bendFiles(p))
        if (stale(latest.get(`${p.hash}|${file}|${r.version}`)))
          out.push({ pkg: p.hash, file, bend: r.version });
  return out;
}
