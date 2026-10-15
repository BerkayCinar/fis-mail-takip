const $ = (id) => document.getElementById(id);
const status = (text, cls) => {
  $("status").textContent = text;
  $("status").className = cls || "";
};

async function load() {
  const v = await chrome.storage.local.get(Object.assign({ lastRegister: null, lastTest: null }, FIS_DEFAULTS));
  $("enabled").checked = v.enabled;
  $("workerUrl").value = v.workerUrl;
  $("webhookUrl").value = v.webhookUrl;
  $("secret").value = v.secret;
  if (v.lastRegister) {
    $("lastCard").hidden = false;
    const d = new Date(v.lastRegister.at);
    $("last").textContent =
      d.toLocaleString("tr-TR") + " · " + (v.lastRegister.to || "") + " · " +
      (v.lastRegister.ok ? "✅ Sheet'e kaydedildi" : "❌ " + v.lastRegister.text);
  }
}

async function save() {
  const workerUrl = $("workerUrl").value.trim().replace(/\/+$/, "");
  const webhookUrl = $("webhookUrl").value.trim();
  const secret = $("secret").value.trim();
  if (!/^https:\/\/[^\s/]+$/.test(workerUrl)) return status("Worker adresi https:// ile başlamalı.", "bad"), false;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec$/.test(webhookUrl))
    return status("Web uygulaması adresi https://script.google.com/macros/s/…/exec biçiminde olmalı.", "bad"), false;
  if (!/^[0-9a-f]{32,}$/i.test(secret)) return status("Gizli anahtar 0-9 ve a-f karakterlerinden oluşmalı.", "bad"), false;
  await chrome.storage.local.set({ enabled: $("enabled").checked, workerUrl, webhookUrl, secret });
  status("Kaydedildi ✅", "ok");
  return true;
}

$("save").addEventListener("click", save);
$("enabled").addEventListener("change", () => chrome.storage.local.set({ enabled: $("enabled").checked }));

$("test").addEventListener("click", async () => {
  if (!(await save())) return;
  status("Test ediliyor…");
  try {
    const w = await fetch($("workerUrl").value.trim().replace(/\/+$/, "") + "/");
    const wt = await w.text();
    if (!/Mail Takip çalışıyor/.test(wt)) return status("Worker'a ulaşıldı ama beklenen yanıt gelmedi. Adresi kontrol et.", "bad");
  } catch (e) {
    return status("Worker'a ulaşılamadı: " + e, "bad");
  }
  const res = await chrome.runtime.sendMessage({ kind: "test" });
  if (res && res.ok) status("Her şey çalışıyor ✅ Worker ve Sheet bağlantısı tamam.", "ok");
  else if (res && res.text === "unauthorized") status("Sheet bağlantısı reddetti: gizli anahtar yanlış.", "bad");
  else status("Sheet'e ulaşılamadı: " + ((res && (res.text || res.error)) || "bilinmeyen hata"), "bad");
});

load();
