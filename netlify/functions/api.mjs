import { getStore } from "@netlify/blobs";
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export const config = { path: "/api/*" };

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });
const users = () => getStore("users"), scores = () => getStore("scores"), meta = () => getStore("meta");

async function secret() {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  let s = await meta().get("secret");
  if (!s) { s = randomBytes(32).toString("hex"); await meta().set("secret", s); }
  return s;
}
async function sign(key) {
  const b = Buffer.from(key + "|" + (Date.now() + 30 * 864e5)).toString("base64url");
  return b + "." + createHmac("sha256", await secret()).update(b).digest("base64url");
}
async function auth(req) {
  const [b, sg] = (req.headers.get("authorization") || "").slice(7).split(".");
  if (!b || !sg) return null;
  const ok = createHmac("sha256", await secret()).update(b).digest("base64url");
  if (sg.length !== ok.length || !timingSafeEqual(Buffer.from(sg), Buffer.from(ok))) return null;
  const [key, exp] = Buffer.from(b, "base64url").toString().split("|");
  return +exp > Date.now() ? key : null;
}
const MIN = 100;
const n = (v, m) => Math.max(0, Math.min(m, Math.floor(+v) || 0));
const clean = (d = {}) => ({
  coins: n(d.coins, 1e7), hi: n(d.hi, 2e5), skin: n(d.skin, 50),
  own: [...new Set((Array.isArray(d.own) ? d.own : [0]).map((x) => n(x, 50)))].slice(0, 50),
  up: { jet: n(d.up?.jet, 3), life: n(d.up?.life, 3), mag: n(d.up?.mag, 3) },
});
const hash = (pw, salt) => scryptSync(pw, salt, 32).toString("hex");

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const p = new URL(req.url).pathname.replace(/^\/api\//, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (p === "top") {
    const s = scores();
    const { blobs } = await s.list();
    const rows = (await Promise.all(blobs.slice(0, 500).map((b) => s.get(b.key, { type: "json" }))))
      .filter(Boolean).sort((a, b) => b.score - a.score);
    const key = await auth(req), i = key ? rows.findIndex((r) => r.name.toLowerCase() === key) : -1;
    return J({ top: rows.slice(0, 50), total: rows.length, min: MIN, cut: rows.length >= 50 ? rows[49].score + 1 : MIN, me: i >= 0 ? { rank: i + 1, score: rows[i].score } : null });
  }

  if (p === "register" || p === "login") {
    const name = String(body.name || "").trim(), pw = String(body.pw || "");
    if (!/^[A-Za-z0-9_\-äöüÄÖÜß]{3,16}$/.test(name)) return J({ error: "Name: 3–16 Zeichen (Buchstaben, Zahlen, _ -)" }, 400);
    if (pw.length < 6 || pw.length > 72) return J({ error: "Passwort: mind. 6 Zeichen" }, 400);
    const key = name.toLowerCase(), st = users(), u = await st.get(key, { type: "json" });
    if (p === "register") {
      if (u) return J({ error: "Name ist schon vergeben" }, 409);
      const salt = randomBytes(16).toString("hex");
      const nu = { name, salt, h: hash(pw, salt), data: clean(body.data) };
      await st.setJSON(key, nu);
      return J({ name, token: await sign(key), data: nu.data });
    }
    if (!u || !timingSafeEqual(Buffer.from(hash(pw, u.salt)), Buffer.from(u.h))) return J({ error: "Name oder Passwort falsch" }, 401);
    return J({ name: u.name, token: await sign(key), data: u.data });
  }

  const key = await auth(req);
  if (!key) return J({ error: "Bitte neu anmelden" }, 401);
  const u = await users().get(key, { type: "json" });
  if (!u) return J({ error: "Account nicht gefunden" }, 401);

  if (p === "me") return J({ name: u.name, data: u.data });
  if (p === "save") { u.data = clean(body.data); await users().setJSON(key, u); return J({ ok: 1 }); }
  if (p === "score") {
    const sc = n(body.score, 2e5), prev = await scores().get(key, { type: "json" });
    if (sc >= MIN && (!prev || sc > prev.score)) await scores().setJSON(key, { name: u.name, score: sc, skin: n(body.skin, 50) });
    const best = Math.max(sc >= MIN ? sc : 0, prev ? prev.score : 0);
    let rank = null;
    if (best >= MIN) {
      const s = scores(), { blobs } = await s.list();
      const all = (await Promise.all(blobs.slice(0, 500).map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
      rank = all.filter((r) => r.score > best && r.name.toLowerCase() !== key).length + 1;
    }
    return J({ ok: 1, rank, best });
  }
  return J({ error: "Nicht gefunden" }, 404);
};
