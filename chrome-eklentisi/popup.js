(async () => {
  const v = await chrome.storage.local.get(
    Object.assign({ lastRegister: null, lastAttempt: null }, FENER_DEFAULTS)
  );
  const el = (id) => document.getElementById(id);
  const configured = v.workerUrl && v.webhookUrl && v.secret;
  const fmt = (iso) => new Date(iso).toLocaleString("tr-TR");
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  el("enabled").checked = v.enabled;
  el("enabled").addEventListener("change", () => chrome.storage.local.set({ enabled: el("enabled").checked }));
  el("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

  el("state").innerHTML = configured
    ? "Gmail'den gönderdiğin mailler otomatik takip edilir."
    : '<span class="bad">Ayarlar eksik. Ayarlar sayfasını doldur.</span>';

  const lines = [];
  if (v.lastAttempt) {
    lines.push(
      "Son Gönder: " + fmt(v.lastAttempt.at) + "<br>" +
        '<span class="' + (v.lastAttempt.ok ? "ok" : "bad") + '">' + (v.lastAttempt.ok ? "✅ " : "⚠️ ") + esc(v.lastAttempt.text) + "</span>"
    );
  } else {
    lines.push("Henüz Gönder'e basılması algılanmadı.");
  }
  if (v.lastRegister) {
    lines.push(
      "Son Sheet kaydı: " + fmt(v.lastRegister.at) + "<br>" +
        (v.lastRegister.ok ? '<span class="ok">✅ ' + esc(v.lastRegister.to) + "</span>" : '<span class="bad">❌ ' + esc(v.lastRegister.text) + "</span>")
    );
  }
  el("last").innerHTML = lines.join("<br><br>");
  el("ver").textContent = "Sürüm " + chrome.runtime.getManifest().version;
})();
