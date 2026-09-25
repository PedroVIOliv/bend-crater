import { isOk, latestCells, pkgStatus, releaseNews, rowSummary } from "./summary.js";

const LABEL = { pass: "checks", unsafe: "checks, with unsafe annotations", fail: "does not check",
  timeout: "checker timed out (60 s)", dep_missing: "a dependency is not on the hub" };

const params = new URLSearchParams(location.search);
const base = params.get("data") ? `data/${params.get("data")}/` : "data/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const title = (p) => (p.name ? `${p.name}@${p.version}` : p.hash.slice(0, 12) + "…");

async function load() {
  const get = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r; });
  const [pkgs, releases, text] = await Promise.all([
    get("packages.json").then((r) => r.json()),
    get("releases.json").then((r) => r.json()),
    get("results.jsonl").then((r) => r.text()),
  ]);
  const cells = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { pkgs, releases, latest: latestCells(cells) };
}

function renderNews({ pkgs, releases, latest }) {
  const n = releaseNews(latest, pkgs, releases);
  if (!n) { $("news").textContent = ""; return; }
  const names = (hs) => hs.map((h) => esc(title(pkgs[h]))).join(", ");
  $("news").innerHTML = `<b>${esc(n.version)}</b> against ${esc(n.prev)}: ` +
    `${n.broke.length} package${n.broke.length === 1 ? "" : "s"} no longer check` +
    (n.broke.length ? ` (${names(n.broke)})` : "") +
    `, ${n.fixed.length} newly check` + (n.fixed.length ? ` (${names(n.fixed)})` : "") + ".";
}

function renderLegend() {
  $("legend").innerHTML = Object.entries(LABEL).map(([s, l]) => `<span class="s-${s}">${esc(l)}</span>`).join("") +
    `<span style="--c:var(--none)">not checked yet</span><span>faded: release is older than the package</span>`;
}

function renderGrid(d) {
  const { pkgs, releases, latest } = d;
  const q = $("q").value.trim().toLowerCase(), want = $("status").value, named = $("named").checked;
  const newest = releases[0]?.version;
  const asc = [...releases].reverse();
  const rows = Object.values(pkgs).sort((a, b) => b.dependents - a.dependents || b.ts - a.ts).filter((p) => {
    if (named && !p.name) return false;
    if (q && !`${p.name ?? ""} ${p.hash} ${p.desc}`.toLowerCase().includes(q)) return false;
    if (want) {
      const s = pkgStatus(latest, p, newest);
      if (s === null || (want === "ok") !== isOk(s)) return false;
    }
    return true;
  });
  const head = `<tr><th>Package</th>${releases.map((r) => `<th class="v">${esc(r.version)}</th>`).join("")}</tr>`;
  const body = rows.map((p) => {
    const hasBend = Object.keys(p.files).some((f) => f.endsWith(".bend"));
    const sum = hasBend ? rowSummary(asc.map((r) => pkgStatus(latest, p, r.version)), asc.map((r) => r.version))
                        : "no .bend files";
    const cells = releases.map((r) => {
      const s = pkgStatus(latest, p, r.version);
      const before = Date.parse(r.published_at) < p.ts ? " before" : "";
      return `<td class="c${s ? " s-" + s : ""}${before}" title="${esc(r.version)}: ${esc(s ? LABEL[s] : "not checked yet")}"><i></i></td>`;
    }).join("");
    return `<tr class="row" data-hash="${esc(p.hash)}"><td class="pkg"><div class="name">${esc(title(p))}</div>` +
      `<div class="desc">${esc(p.desc)}</div><div class="sum">${esc(sum)}</div></td>${cells}</tr>`;
  }).join("");
  $("grid").innerHTML = rows.length
    ? `<div class="scroll"><table>${head}${body}</table></div>`
    : "No package matches.";
  for (const tr of $("grid").querySelectorAll("tr.row")) tr.onclick = () => toggle(tr, d);
}

function toggle(tr, { pkgs, releases, latest }) {
  if (tr.nextElementSibling?.classList.contains("detail")) { tr.nextElementSibling.remove(); return; }
  const p = pkgs[tr.dataset.hash];
  const files = Object.keys(p.files).filter((f) => f.endsWith(".bend")).sort();
  const parts = files.map((f) => {
    const bad = releases.map((r) => latest.get(`${p.hash}|${f}|${r.version}`)).find((c) => c && !isOk(c.status));
    const tail = bad ? `: ${esc(LABEL[bad.status])} on ${esc(bad.bend)}` + (bad.error ? `<div class="err">${esc(bad.error)}</div>` : "")
                     : ": checks wherever it was checked";
    return `<div><code>${esc(f)}</code>${tail}</div>`;
  }).join("") || "This package has no .bend files, so there is nothing to check.";
  const row = document.createElement("tr");
  row.className = "detail";
  row.innerHTML = `<td colspan="${releases.length + 1}"><div class="hash">import ${esc(p.hash)}/…</div>${parts}</td>`;
  tr.after(row);
}

try {
  const d = await load();
  renderLegend(); renderNews(d); renderGrid(d);
  for (const id of ["q", "status", "named"]) $(id).oninput = () => renderGrid(d);
} catch (e) {
  $("grid").textContent = `Could not load the results (${e.message}).`;
}
