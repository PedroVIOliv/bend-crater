const root = import.meta.dir;
Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.includes("..")) return new Response("no", { status: 400 });
    if (p === "/") p = "/index.html";
    const f = Bun.file(p.startsWith("/data/") ? root + p : `${root}/site${p}`);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log("http://localhost:" + (process.env.PORT ?? 8080) + "/?data=fixtures");
