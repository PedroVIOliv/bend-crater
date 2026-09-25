import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Release } from "./types";
import { cmpVersion } from "./versions";

const API = "https://api.github.com/repos/bendlang/bend/releases";
const FIRST = "2.0.8";

export function assetName(version: string, platform: string = process.platform, arch: string = process.arch): string {
  const os = platform === "darwin" ? "darwin" : "linux";
  return `bend-${version}-${os}-${arch === "arm64" ? "arm64" : "x64"}.tar.gz`;
}

interface GhRelease {
  tag_name: string; published_at: string; draft: boolean; prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export async function listReleases(
  get: typeof fetch = fetch, platform: string = process.platform, arch: string = process.arch,
): Promise<Release[]> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out: Release[] = [];
  for (let page = 1; ; page++) {
    const res = await get(`${API}?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`${API} answered ${res.status}`);
    const list = (await res.json()) as GhRelease[];
    if (list.length === 0) break;
    for (const r of list) {
      const version = r.tag_name.replace(/^v/, "");
      if (r.draft || r.prerelease || !/^\d+\.\d+\.\d+$/.test(version) || cmpVersion(version, FIRST) < 0) continue;
      const asset = r.assets.find((a) => a.name === assetName(version, platform, arch));
      out.push({ version, published_at: r.published_at, asset_url: asset?.browser_download_url ?? null });
    }
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version));
}

export async function ensureRelease(r: Release, cacheDir: string, get: typeof fetch = fetch): Promise<string> {
  const dir = join(cacheDir, "bend", r.version);
  const bin = join(dir, "bend", "bin", "bend");
  if (await Bun.file(bin).exists()) return bin;
  if (!r.asset_url) throw new Error(`bend ${r.version} has no ${assetName(r.version)}`);
  const res = await get(r.asset_url);
  if (!res.ok) throw new Error(`${r.asset_url} answered ${res.status}`);
  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const tgz = join(tmp, "bend.tar.gz");
  await Bun.write(tgz, res);
  const tar = Bun.spawnSync(["tar", "xzf", tgz, "-C", tmp]);
  if (tar.exitCode !== 0) throw new Error(`tar failed for ${r.version}: ${tar.stderr}`);
  await rm(tgz);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  return bin;
}
