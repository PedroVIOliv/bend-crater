import type { Pkg } from "./types";

export const HUB = "https://hub.bend-lang.com";

export async function fetchPackages(hub = HUB, get: typeof fetch = fetch, limit = 100): Promise<Pkg[]> {
  const out: Pkg[] = [];
  for (;;) {
    const url = `${hub}/packages.json?sort=new&limit=${limit}&after=${out.length}`;
    const res = await get(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = (await res.json()) as { total: number; packages: Pkg[] };
    for (const p of body.packages)
      out.push({ hash: p.hash, files: p.files, name: p.name, version: p.version,
                 desc: p.desc, ts: p.ts, dependents: p.dependents });
    if (body.packages.length === 0 || out.length >= body.total) return out;
  }
}
