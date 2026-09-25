const ORDER = ["pass", "unsafe", "timeout", "dep_missing", "fail"];

export const isOk = (s) => s === "pass" || s === "unsafe";

export function latestCells(cells) {
  const m = new Map();
  for (const c of cells) m.set(`${c.pkg}|${c.file}|${c.bend}`, c);
  return m;
}

export function pkgStatus(latest, pkg, bend) {
  let worst = null;
  for (const f of Object.keys(pkg.files)) {
    if (!f.endsWith(".bend")) continue;
    const c = latest.get(`${pkg.hash}|${f}|${bend}`);
    if (c && (worst === null || ORDER.indexOf(c.status) > ORDER.indexOf(worst))) worst = c.status;
  }
  return worst;
}

export function rowSummary(statuses, versions) {
  const xs = statuses.map((s, i) => [s, versions[i]]).filter(([s]) => s !== null);
  if (xs.length === 0) return "not checked yet";
  if (xs.every(([s]) => isOk(s))) return "checks on every release";
  if (xs.every(([s]) => !isOk(s))) return "does not check on any release";
  let i = xs.length - 1;
  const lastOk = isOk(xs[i][0]);
  while (i > 0 && isOk(xs[i - 1][0]) === lastOk) i--;
  if (lastOk) return `checks since ${xs[i][1]}`;
  let j = i - 1;
  while (j > 0 && isOk(xs[j - 1][0])) j--;
  const range = j === i - 1 ? xs[j][1] : `${xs[j][1]}–${xs[i - 1][1]}`;
  return `checks on ${range}, not since ${xs[i][1]}`;
}

export function releaseNews(latest, pkgs, releases) {
  if (releases.length < 2) return null;
  const [now, prev] = releases;
  const broke = [], fixed = [];
  for (const p of Object.values(pkgs)) {
    const a = pkgStatus(latest, p, prev.version), b = pkgStatus(latest, p, now.version);
    if (a === null || b === null) continue;
    if (isOk(a) && !isOk(b)) broke.push(p.hash);
    if (!isOk(a) && isOk(b)) fixed.push(p.hash);
  }
  return { version: now.version, prev: prev.version, broke, fixed };
}
