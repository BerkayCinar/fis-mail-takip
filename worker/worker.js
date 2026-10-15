/**
 * FiS Mail Takip — Cloudflare Worker
 *
 * Rotalar:
 *   GET /o/<id>.gif                 → açılma kaydı + 1x1 şeffaf GIF
 *   GET /c/<id>?u=<url>&s=<imza>    → tıklama kaydı + hedef adrese yönlendirme
 *
 * Ortam değişkenleri (Cloudflare > Worker > Settings > Variables and Secrets):
 *   SHEET_WEBHOOK  Apps Script web uygulaması adresi (…/exec)
 *   SECRET         Apps Script'in ürettiği gizli anahtar (Secret olarak ekleyin)
 *
 * Tıklama linkleri imzalıdır; böylece Worker, başkalarının kullanabileceği
 * açık bir yönlendirme servisine dönüşmez.
 */

const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0)
);

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Açılma pikseli
    if (parts[0] === "o" && parts[1]) {
      const id = parts[1].replace(/\.gif$/i, "");
      if (ID_RE.test(id)) {
        ctx.waitUntil(log(env, request, { type: "open", id }));
      }
      return new Response(GIF, {
        headers: { "Content-Type": "image/gif", ...NO_CACHE },
      });
    }

    // Tıklama yönlendirmesi
    if (parts[0] === "c" && parts[1]) {
      const id = parts[1];
      const target = url.searchParams.get("u") || "";
      const sig = url.searchParams.get("s") || "";
      const valid =
        ID_RE.test(id) &&
        /^https?:\/\//i.test(target) &&
        (await verify(env.SECRET, `${id}|${target}`, sig));

      if (!valid) {
        return new Response("Geçersiz veya bozulmuş bağlantı.", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      // Türkçe karakterli adresleri (ğ, ş, ı…) başlığa uygun hale getir
      let location;
      try {
        location = new URL(target).href;
      } catch (err) {
        return new Response("Geçersiz adres.", { status: 400 });
      }
      ctx.waitUntil(log(env, request, { type: "click", id, url: target }));
      return new Response(null, {
        status: 302,
        headers: { Location: location, ...NO_CACHE },
      });
    }

    return new Response("FiS Mail Takip çalışıyor.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verify(secret, message, sig) {
  if (!secret || !sig) return false;
  const expected = (await hmacHex(secret, message)).slice(0, 16);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

async function log(env, request, event) {
  if (!env.SHEET_WEBHOOK) return;
  const cf = request.cf || {};
  const payload = {
    secret: env.SECRET,
    ...event,
    ts: new Date().toISOString(),
    ua: request.headers.get("User-Agent") || "",
    country: cf.country || "",
    asn: cf.asn || "",
    org: cf.asOrganization || "",
  };
  try {
    await fetch(env.SHEET_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
  } catch (err) {
    console.log("Sheet'e yazılamadı:", err);
  }
}
