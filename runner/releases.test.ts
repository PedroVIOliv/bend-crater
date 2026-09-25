import { expect, test } from "bun:test";
import { assetName, listReleases } from "./releases";

test("asset name per platform", () => {
  expect(assetName("2.0.28", "linux", "x64")).toBe("bend-2.0.28-linux-x64.tar.gz");
  expect(assetName("2.0.28", "darwin", "arm64")).toBe("bend-2.0.28-darwin-arm64.tar.gz");
});

const rel = (tag: string, extra: object = {}) => ({
  tag_name: tag, published_at: `2026-09-2${tag.length % 10}T00:00:00Z`,
  draft: false, prerelease: false,
  assets: [{ name: `bend-${tag.slice(1)}-linux-x64.tar.gz`, browser_download_url: `https://dl/${tag}` }],
  ...extra,
});

test("keeps >= 2.0.8, newest first, skips drafts and prereleases, pages", async () => {
  const pages: Record<string, unknown[]> = {
    "1": [rel("v2.0.28"), rel("v2.0.29", { draft: true }), rel("v2.0.9")],
    "2": [rel("v2.0.8"), rel("v2.0.7"), rel("v2.0.10", { prerelease: true })],
  };
  const get = (async (url: string) =>
    new Response(JSON.stringify(pages[new URL(url).searchParams.get("page")!] ?? []))) as unknown as typeof fetch;
  const rs = await listReleases(get, "linux", "x64");
  expect(rs.map((r) => r.version)).toEqual(["2.0.28", "2.0.9", "2.0.8"]);
  expect(rs[0].asset_url).toBe("https://dl/v2.0.28");
});

test("a release without our platform's asset has asset_url null", async () => {
  const get = (async (url: string) => new Response(JSON.stringify(
    new URL(url).searchParams.get("page") === "1" ? [rel("v2.0.28", { assets: [] })] : []))) as unknown as typeof fetch;
  expect((await listReleases(get, "linux", "x64"))[0].asset_url).toBeNull();
});

test("GitHub down throws", async () => {
  const get = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
  await expect(listReleases(get, "linux", "x64")).rejects.toThrow(/503/);
});
