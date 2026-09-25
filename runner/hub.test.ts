import { expect, test } from "bun:test";
import { fetchPackages } from "./hub";

const page = (n: number) => Bun.file(`${import.meta.dir}/fixtures/packages_page${n}.json`).text();

function fakeFetch(pages: Record<string, () => Promise<Response>>) {
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(url);
    const after = new URL(url).searchParams.get("after")!;
    return pages[after] ? pages[after]() : new Response('{"total":3,"packages":[]}');
  }) as unknown as typeof fetch;
  return { f, seen };
}

test("pages until total is reached and keeps only the fields we use", async () => {
  const { f, seen } = fakeFetch({
    "0": async () => new Response(await page(1)),
    "2": async () => new Response(await page(2)),
  });
  const pkgs = await fetchPackages("https://hub.test", f, 2);
  expect(pkgs.map((p) => p.hash)).toEqual([
    "0x0bc665d2ca2b4a7f7df0c8b32cfaa356",
    "0x39cbd6b8923682f1e4deba6ee6056b43",
    "0x1f4d6c03caf955232d0b0dc6e6f36cf4",
  ]);
  expect(Object.keys(pkgs[0]).sort()).toEqual(
    ["dependents", "desc", "files", "hash", "name", "ts", "version"]);
  expect(seen[0]).toBe("https://hub.test/packages.json?sort=new&limit=2&after=0");
  expect(seen.length).toBe(2);
});

test("stops on an empty page even if total says more", async () => {
  const { f } = fakeFetch({ "0": async () => new Response(await page(1)) });
  expect((await fetchPackages("https://hub.test", f, 2)).length).toBe(2);
});

test("a non-OK response throws", async () => {
  const { f } = fakeFetch({ "0": async () => new Response("down", { status: 502 }) });
  await expect(fetchPackages("https://hub.test", f, 2)).rejects.toThrow(/502/);
});
