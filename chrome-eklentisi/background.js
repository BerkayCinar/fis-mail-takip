/**
 * FiS Mail Takip — arka plan
 *  - İçerik betiğinden gelen "register" isteklerini Sheet'e (Apps Script) iletir.
 *  - Gmail'in yazma penceresinde pikselin senin tarayıcında yüklenmesini engeller
 *    (aksi halde mail daha gönderilmeden "açıldı" kaydı oluşurdu).
 */
importScripts("config.js");

const RULE_ID = 1;

async function getCfg() {
  return chrome.storage.local.get(FIS_DEFAULTS);
}

async function refreshBlockRule() {
  const cfg = await getCfg();
  let host = "";
  try {
    host = new URL(cfg.workerUrl).host;
  } catch (e) {}
  const addRules = host
    ? [
        {
          id: RULE_ID,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "||" + host + "/o/",
            initiatorDomains: ["mail.google.com"],
            resourceTypes: ["image"],
          },
        },
      ]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules,
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await refreshBlockRule();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(refreshBlockRule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.workerUrl) refreshBlockRule();
});

async function register(payload, storeKey) {
  storeKey = storeKey || "lastRegister";
  const cfg = await getCfg();
  if (!cfg.webhookUrl || !cfg.secret) return { ok: false, error: "Ayarlar eksik" };
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ secret: cfg.secret }, payload)),
      redirect: "follow",
    });
    const text = (await res.text()).trim();
    const ok = text === "ok";
    await chrome.storage.local.set({
      [storeKey]: { at: new Date().toISOString(), ok, text: text.slice(0, 120), to: payload.to },
    });
    return { ok, text };
  } catch (err) {
    await chrome.storage.local.set({
      [storeKey]: { at: new Date().toISOString(), ok: false, text: String(err), to: payload.to },
    });
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.kind === "register") {
    register(msg.payload).then(sendResponse);
    return true;
  }
  if (msg && msg.kind === "test") {
    register({
      type: "register",
      id: "eklentitesti",
      to: "test@ornek.com",
      subject: "Chrome eklentisi bağlantı testi",
      ts: new Date().toISOString(),
    }, "lastTest").then(sendResponse);
    return true;
  }
  return false;
});
