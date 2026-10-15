/**
 * FiS Mail Takip — Google Apps Script
 * Bir Google Sheet'e bağlı çalışır (Uzantılar > Apps Script).
 *
 * Sekmeler:
 *   Kuyruk       → gönderilecek mailler (E-posta, Ad, Konu, Mesaj)
 *   Gönderimler  → her mailin takip özeti (açılma, tıklama)
 *   Olaylar      → her açılma/tıklamanın ham kaydı
 *
 * Kayıt kaynakları: Kuyruk menüsü, Gmail eklentisi ("Takip ekle") ve
 * Chrome eklentisi (her gönderimde otomatik).
 *
 * Mesajda {{Ad}} ve {{Email}} yer tutucuları kullanılabilir.
 * Mesaj düz metinse linkler otomatik bulunur; HTML de yazabilirsiniz.
 */

const SH = { QUEUE: "Kuyruk", SENT: "Gönderimler", EVENTS: "Olaylar" };
const QUEUE_HEADERS = ["E-posta", "Ad", "Konu", "Mesaj", "Durum", "Takip ID"];
const SENT_HEADERS = [
  "Takip ID", "E-posta", "Ad", "Konu", "Yöntem", "Oluşturma / Gönderim",
  "İlk açılma", "Açılma", "Şüpheli açılma", "Son açılma",
  "Tıklama", "Son tıklama", "Taslak ID",
];
const EVENT_HEADERS = [
  "Zaman", "Takip ID", "E-posta", "Konu", "Tür", "URL", "Değerlendirme", "Ülke", "Ağ (ASN)", "User-Agent",
];
// Sütun sıraları (0 tabanlı) — Gönderimler
const C = {
  ID: 0, EMAIL: 1, NAME: 2, SUBJECT: 3, METHOD: 4, CREATED: 5,
  FIRST_OPEN: 6, OPENS: 7, SUSPICIOUS: 8, LAST_OPEN: 9,
  CLICKS: 10, LAST_CLICK: 11, DRAFT_ID: 12,
};
// Doğrudan gönderimden sonra bu kadar saniye içinde gelen olaylar
// büyük ihtimalle güvenlik tarayıcısıdır.
const SCANNER_WINDOW_SEC = 60;
// Chrome eklentisinin kayıt durumları
const METHOD_CHROME = "Chrome — gönderildi";
const METHOD_CHROME_PENDING = "Chrome — gönderilmedi";

/* ------------------------------------------------------------------ */
/* Menü ve kurulum                                                     */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📬 Mail Takip")
    .addItem("1) Kurulumu yap", "setup")
    .addItem("2) Ayarlar (Worker adresi)", "settings")
    .addItem("3) Bağlantıyı test et", "testConnection")
    .addSeparator()
    .addItem("Kuyruktakileri Gmail taslağı yap", "createDrafts")
    .addItem("Kuyruktakileri hemen gönder", "sendNow")
    .addSeparator()
    .addItem("Eksik alıcı/konu bilgilerini tamamla", "fillMissing")
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  [
    [SH.QUEUE, QUEUE_HEADERS],
    [SH.SENT, SENT_HEADERS],
    [SH.EVENTS, EVENT_HEADERS],
  ].forEach(([name, headers]) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight("bold")
      .setBackground("#1f2937")
      .setFontColor("#ffffff");
    sh.setFrozenRows(1);
  });

  const queue = ss.getSheetByName(SH.QUEUE);
  queue.setColumnWidth(4, 420);
  queue.getRange("D:D").setWrap(true);
  if (queue.getLastRow() < 2) {
    queue.getRange(2, 1, 1, 4).setValues([[
      "ornek@alanadi.com",
      "Ayşe",
      "{{Ad}} Hanım, siteniz için kısa bir öneri",
      "Merhaba {{Ad}} Hanım,\n\nSitenizi inceledim, birkaç küçük iyileştirme önerim var: https://ornek.com\n\nSevgiler",
    ]]);
  }

  const sheet1 = ss.getSheetByName("Sayfa1") || ss.getSheetByName("Sheet1");
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 3) {
    ss.deleteSheet(sheet1);
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty("SHEET_ID", ss.getId());
  if (!props.getProperty("SECRET")) {
    props.setProperty(
      "SECRET",
      (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "")
    );
  }

  SpreadsheetApp.getUi().alert(
    "Kurulum tamam ✅",
    "Gizli anahtarınız (Cloudflare'de SECRET olarak eklenecek):\n\n" +
      props.getProperty("SECRET") +
      "\n\nSonraki adım: Dağıt > Yeni dağıtım > Web uygulaması.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function settings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty("WORKER_URL") || "(henüz yok)";
  const res = ui.prompt(
    "Worker adresi",
    "Şu anki: " + current +
      "\n\nCloudflare Worker adresinizi girin (örn. https://mail-takip.hesabiniz.workers.dev):",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const url = res.getResponseText().trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(url)) {
    ui.alert("Adres https:// ile başlamalı.");
    return;
  }
  props.setProperty("WORKER_URL", url);
  ui.alert(
    "Kaydedildi ✅",
    "Worker: " + url + "\n\nGizli anahtar (SECRET):\n" + props.getProperty("SECRET"),
    ui.ButtonSet.OK
  );
}

function testConnection() {
  const cfg = getConfig_();
  if (!cfg) return;
  const ui = SpreadsheetApp.getUi();
  try {
    const res = UrlFetchApp.fetch(cfg.worker + "/o/baglantitesti.gif", {
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      ui.alert("Worker yanıt vermedi (kod " + res.getResponseCode() + "). Adresi kontrol edin.");
      return;
    }
    Utilities.sleep(4000);
    const ev = SpreadsheetApp.getActive().getSheetByName(SH.EVENTS);
    const last = ev.getLastRow();
    const found =
      last > 1 &&
      ev.getRange(Math.max(2, last - 5), 2, Math.min(6, last - 1), 1)
        .getValues()
        .some((r) => r[0] === "baglantitesti");
    ui.alert(
      found
        ? "Her şey çalışıyor ✅ Olaylar sekmesinde 'baglantitesti' satırını görebilirsiniz."
        : "Worker çalışıyor ama kayıt Sheet'e düşmedi ❌\n\nKontrol edin: Cloudflare'deki SHEET_WEBHOOK adresi ve SECRET doğru mu? Web uygulaması erişimi 'Herkes' mi?"
    );
  } catch (err) {
    ui.alert("Worker'a ulaşılamadı: " + err);
  }
}

/* ------------------------------------------------------------------ */
/* Taslak oluşturma ve gönderme                                        */
/* ------------------------------------------------------------------ */

function createDrafts() {
  processQueue_("draft");
}

function sendNow() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert(
    "Hemen gönderilsin mi?",
    "Kuyrukta 'Durum' sütunu boş olan bütün mailler şimdi gönderilecek. Bu geri alınamaz.",
    ui.ButtonSet.YES_NO
  );
  if (ok === ui.Button.YES) processQueue_("send");
}

function processQueue_(mode) {
  const cfg = getConfig_();
  if (!cfg) return;
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const queue = ss.getSheetByName(SH.QUEUE);
  const sent = ss.getSheetByName(SH.SENT);
  const lastRow = queue.getLastRow();
  if (lastRow < 2) {
    ui.alert("Kuyruk boş.");
    return;
  }

  const rows = queue.getRange(2, 1, lastRow - 1, QUEUE_HEADERS.length).getValues();
  let done = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const [email, name, subject, message, status] = rows[i];
    if (!email || status) continue;

    if (mode === "send" && MailApp.getRemainingDailyQuota() < 1) {
      errors.push("Günlük Gmail gönderim kotası doldu; kalanlar gönderilmedi.");
      break;
    }

    try {
      const id = newId_();
      const vars = { Ad: name || "", ad: name || "", Email: email, email: email };
      const subj = fill_(String(subject || ""), vars);
      const msg = fill_(String(message || ""), vars);
      const html = buildHtml_(msg, id, cfg);
      const plain = toPlain_(msg);
      const now = new Date();
      let draftId = "";

      if (mode === "send") {
        GmailApp.sendEmail(email, subj, plain, { htmlBody: html });
      } else {
        draftId = GmailApp.createDraft(email, subj, plain, { htmlBody: html }).getId();
      }

      queue.getRange(i + 2, 5, 1, 2).setValues([[
        mode === "send" ? "Gönderildi" : "Taslak oluşturuldu",
        id,
      ]]);
      sent.appendRow([
        id, email, name, subj, mode === "send" ? "Gönderildi" : "Taslak",
        now, "", 0, 0, "", 0, "", draftId,
      ]);
      done++;
    } catch (err) {
      errors.push(email + ": " + err.message);
      queue.getRange(i + 2, 5).setValue("Hata: " + err.message);
    }
  }

  ui.alert(
    (mode === "send" ? done + " mail gönderildi." : done + " taslak Gmail'e eklendi.") +
      (errors.length ? "\n\nSorunlar:\n" + errors.join("\n") : "")
  );
}

function buildHtml_(msg, id, cfg) {
  let html = /<[a-z][\s\S]*>/i.test(msg) ? msg : plainToHtml_(msg);

  html = html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (m, href) => {
    const target = href.replace(/&amp;/g, "&");
    return 'href="' + trackedLink_(id, target, cfg) + '"';
  });

  const pixel =
    '<img src="' + cfg.worker + "/o/" + id + '.gif" width="1" height="1" alt="" ' +
    'style="display:block;width:1px;height:1px;border:0;" />';

  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">' +
    html +
    "</div>" +
    pixel
  );
}

function plainToHtml_(text) {
  const esc = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/https?:\/\/[^\s<]+/g, (raw) => {
      const m = raw.match(/^(.*?)([.,!?;:)]*)$/);
      const url = m[1];
      return '<a href="' + url + '">' + url + "</a>" + m[2];
    })
    .replace(/\r?\n/g, "<br>");
}

function toPlain_(msg) {
  if (!/<[a-z][\s\S]*>/i.test(msg)) return msg;
  return msg
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function trackedLink_(id, target, cfg) {
  const sig = hmacHex_(cfg.secret, id + "|" + target).slice(0, 16);
  return cfg.worker + "/c/" + id + "?u=" + encodeURIComponent(target) + "&amp;s=" + sig;
}

function hmacHex_(secret, message) {
  return Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}

function fill_(text, vars) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    vars[key] !== undefined ? vars[key] : ""
  );
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const worker = props.getProperty("WORKER_URL");
  const secret = props.getProperty("SECRET");
  if (!worker || !secret) {
    SpreadsheetApp.getUi().alert(
      "Önce menüden '1) Kurulumu yap' ve '2) Ayarlar' adımlarını tamamlayın."
    );
    return null;
  }
  return { worker, secret };
}

/* ------------------------------------------------------------------ */
/* Worker'dan gelen olayları kaydetme (web uygulaması)                  */
/* ------------------------------------------------------------------ */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
    if (!secret || data.secret !== secret) return text_("unauthorized");

    // Chrome eklentisinin bağlantı testi: sadece doğrula, kayıt açma
    if (data.type === "register" && data.id === "eklentitesti") return text_("ok");

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (data.type === "register" || data.type === "unregister") registerSend_(data);
      else record_(data);
    } finally {
      lock.releaseLock();
    }
    return text_("ok");
  } catch (err) {
    return text_("error: " + err);
  }
}

/**
 * Chrome eklentisi takibi mail yazılırken hazırlar ve buraya kaydeder.
 * Satır "Chrome — gönderilmedi" olarak açılır; mail gönderilince ilk açılma
 * veya tıklamada Gönderilmiş klasöründen bulunup "Chrome — gönderildi" olur.
 * "unregister": kullanıcı o mailde takibi kapattıysa bekleyen satırı siler.
 */
function registerSend_(d) {
  const id = String(d.id || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return;
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("SHEET_ID")
  );
  const sent = ss.getSheetByName(SH.SENT);
  const cell = sent.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();

  if (d.type === "unregister") {
    if (cell && sent.getRange(cell.getRow(), C.METHOD + 1).getValue() === METHOD_CHROME_PENDING) {
      sent.deleteRow(cell.getRow());
    }
    return;
  }

  const to = String(d.to || "").slice(0, 500);
  const subject = String(d.subject || "").slice(0, 300);
  const ts = d.ts ? new Date(d.ts) : new Date();
  if (cell) {
    const method = sent.getRange(cell.getRow(), C.METHOD + 1).getValue();
    if (String(method).indexOf("gönderilmedi") === -1) return; // gönderilmiş maile dokunma
    sent.getRange(cell.getRow(), C.EMAIL + 1).setValue(to);
    sent.getRange(cell.getRow(), C.SUBJECT + 1).setValue(subject);
    sent.getRange(cell.getRow(), C.CREATED + 1).setValue(ts);
    return;
  }
  const row = new Array(SENT_HEADERS.length).fill("");
  row[C.ID] = id;
  row[C.EMAIL] = to;
  row[C.SUBJECT] = subject;
  row[C.METHOD] = METHOD_CHROME_PENDING;
  row[C.CREATED] = ts;
  row[C.OPENS] = 0;
  row[C.SUSPICIOUS] = 0;
  row[C.CLICKS] = 0;
  sent.appendRow(row);
}

function doGet() {
  return text_("FiS Mail Takip kayıt servisi çalışıyor.");
}

function text_(s) {
  return ContentService.createTextOutput(s);
}

function record_(d) {
  const id = String(d.id || "");
  if (!id) return;
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("SHEET_ID")
  );
  const sent = ss.getSheetByName(SH.SENT);
  const events = ss.getSheetByName(SH.EVENTS);
  const ts = d.ts ? new Date(d.ts) : new Date();

  const cell = sent
    .getRange("A:A")
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  let range = cell ? sent.getRange(cell.getRow(), 1, 1, SENT_HEADERS.length) : null;
  let row = range ? range.getValues()[0] : null;

  // Eklentinin kaydı Sheet'e hiç ulaşmadıysa (ör. eklenti güncellendikten sonra
  // Gmail sekmesi yenilenmedi) maili Gönderilmiş klasöründe takip kimliğinden
  // bul ve satırı şimdi aç.
  if (!row) {
    const m = findSentById_(id, 30);
    if (m) {
      sent.appendRow(sentRowFromMessage_(id, m));
      range = sent.getRange(sent.getLastRow(), 1, 1, SENT_HEADERS.length);
      row = range.getValues()[0];
    }
  }

  if (row) refreshDraftStatus_(row);
  const verdict = classify_(d, row, ts);

  events.appendRow([
    ts,
    id,
    row ? row[C.EMAIL] : "",
    row ? row[C.SUBJECT] : "",
    d.type === "click" ? "Tıklama" : "Açılma",
    d.url || "",
    verdict.label,
    d.country || "",
    [d.asn, d.org].filter(String).join(" "),
    d.ua || "",
  ]);

  if (!row) return;
  applyEvent_(row, d, ts, verdict);
  range.setValues([row]);
}

/** Olayı Gönderimler satırındaki sayaçlara işler. */
function applyEvent_(row, d, ts, verdict) {
  if (verdict.ignore) {
    // sayılmaz (ör. taslağı kendiniz önizlediniz)
  } else if (d.type === "click") {
    if (!verdict.suspicious) {
      row[C.CLICKS] = (Number(row[C.CLICKS]) || 0) + 1;
      row[C.LAST_CLICK] = ts;
      if (!row[C.FIRST_OPEN]) row[C.FIRST_OPEN] = ts; // tıkladıysa açmıştır
    }
  } else if (verdict.suspicious) {
    row[C.SUSPICIOUS] = (Number(row[C.SUSPICIOUS]) || 0) + 1;
  } else {
    row[C.OPENS] = (Number(row[C.OPENS]) || 0) + 1;
    if (!row[C.FIRST_OPEN]) row[C.FIRST_OPEN] = ts;
    row[C.LAST_OPEN] = ts;
  }
}

/**
 * Gönderilmiş klasöründe, gövdesinde bu takip kimliğinin pikseli geçen maili
 * arar (son `days` gün, en yeni 50 konuşma). Bulamazsa null döner.
 */
function findSentById_(id, days) {
  if (!/^[0-9a-f]{12}$/.test(id)) return null; // test ve sahte kimlikler için arama yapma
  const marker = "/o/" + id + ".gif";
  try {
    const threads = GmailApp.search("in:sent newer_than:" + (days || 30) + "d", 0, 50);
    for (const thread of threads) {
      for (const m of thread.getMessages()) {
        if (!m.isDraft() && m.getBody().indexOf(marker) !== -1) return m;
      }
    }
  } catch (err) {
    console.log("Gmail araması başarısız: " + err);
  }
  return null;
}

function recipientsOf_(m) {
  const found = [m.getTo(), m.getCc(), m.getBcc()]
    .join(",")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!found) return "";
  const list = found.map((e) => e.toLowerCase());
  return list.filter((e, i) => list.indexOf(e) === i).join(", ");
}

function sentRowFromMessage_(id, m) {
  const row = new Array(SENT_HEADERS.length).fill("");
  row[C.ID] = id;
  row[C.EMAIL] = recipientsOf_(m);
  row[C.SUBJECT] = m.getSubject() || "";
  row[C.METHOD] = METHOD_CHROME;
  row[C.CREATED] = m.getDate();
  row[C.OPENS] = 0;
  row[C.SUSPICIOUS] = 0;
  row[C.CLICKS] = 0;
  return row;
}

/**
 * Menü: Olaylar'da olup Gönderimler'de satırı olmayan takip kimliklerini
 * Gönderilmiş klasöründe bulur; satırı açar, sayaçları olaylardan yeniden
 * hesaplar ve Olaylar'daki boş E-posta / Konu hücrelerini doldurur.
 */
function fillMissing() {
  const ss = SpreadsheetApp.getActive();
  const sent = ss.getSheetByName(SH.SENT);
  const events = ss.getSheetByName(SH.EVENTS);
  const known = sent.getLastRow() > 1
    ? sent.getRange(2, 1, sent.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
    : [];
  const ev = events.getLastRow() > 1
    ? events.getRange(2, 1, events.getLastRow() - 1, EVENT_HEADERS.length).getValues()
    : [];
  const ids = ev
    .map((r) => String(r[1]))
    .filter((id, i, a) => /^[0-9a-f]{12}$/.test(id) && known.indexOf(id) === -1 && a.indexOf(id) === i);

  let fixed = 0;
  const missing = [];
  ids.forEach((id) => {
    const m = findSentById_(id, 90);
    if (!m) {
      missing.push(id);
      return;
    }
    const row = sentRowFromMessage_(id, m);
    ev.forEach((r, i) => {
      if (String(r[1]) !== id) return;
      const ts = r[0] instanceof Date ? r[0] : new Date(r[0]);
      const net = String(r[8] || "").split(" ");
      const d = {
        type: r[4] === "Tıklama" ? "click" : "open",
        url: r[5],
        country: r[7],
        asn: net[0],
        org: net.slice(1).join(" "),
        ua: r[9],
      };
      const verdict = classify_(d, row, ts);
      applyEvent_(row, d, ts, verdict);
      events.getRange(i + 2, 3, 1, 2).setValues([[row[C.EMAIL], row[C.SUBJECT]]]);
      events.getRange(i + 2, 7).setValue(verdict.label);
    });
    sent.appendRow(row);
    fixed++;
  });

  SpreadsheetApp.getUi().alert(
    fixed + " mail tamamlandı." +
      (missing.length ? "\nGönderilmiş klasöründe bulunamayanlar: " + missing.join(", ") : "")
  );
}

/** Taslak hâlâ duruyorsa olay sizin önizlemenizdir; silinmişse gönderilmiştir. */
function refreshDraftStatus_(row) {
  if (row[C.METHOD] === "Eklenti — gönderilmedi") return refreshAddonStatus_(row, "Eklenti — gönderildi");
  if (row[C.METHOD] === METHOD_CHROME_PENDING) return refreshAddonStatus_(row, METHOD_CHROME);
  if (row[C.METHOD] !== "Taslak" || !row[C.DRAFT_ID]) return;
  try {
    GmailApp.getDraft(String(row[C.DRAFT_ID]));
    row._draftStillExists = true;
  } catch (err) {
    row[C.METHOD] = "Gönderildi (taslaktan)";
  }
}

/**
 * Eklentiyle takip eklenen mail: Gönderilmiş klasöründe, takip eklendikten
 * sonra gönderilen ve içinde bu takip kimliği geçen maili arar. Alıcı veya
 * konu sonradan değiştirilmiş olsa da doğru maili bulur ve satırı günceller.
 * Bulamazsa mail hâlâ yazılıyordur (olay sizin önizlemenizdir).
 */
function refreshAddonStatus_(row, sentLabel) {
  const created = row[C.CREATED] instanceof Date ? row[C.CREATED] : new Date(row[C.CREATED]);
  const id = String(row[C.ID] || "");
  if (!id || isNaN(created)) {
    row._draftStillExists = true;
    return;
  }
  const since = created.getTime() - 60 * 1000;
  const query = "in:sent after:" + Math.floor(since / 1000);
  const marker = "/o/" + id + ".gif";
  let sent = null;
  try {
    GmailApp.search(query, 0, 25).forEach((thread) => {
      thread.getMessages().forEach((m) => {
        if (m.isDraft()) return;
        const t = m.getDate().getTime();
        if (t < since) return;
        if (sent && t >= sent.getDate().getTime()) return;
        if (m.getBody().indexOf(marker) !== -1) sent = m;
      });
    });
  } catch (err) {
    console.log("Gmail araması başarısız: " + err);
  }
  if (!sent) {
    row._draftStillExists = true;
    return;
  }
  row[C.METHOD] = sentLabel || "Eklenti — gönderildi";
  row[C.CREATED] = sent.getDate();
  const to = recipientsOf_(sent);
  if (to) row[C.EMAIL] = to;
  row[C.SUBJECT] = sent.getSubject() || row[C.SUBJECT];
}

function classify_(d, row, ts) {
  const isClick = d.type === "click";
  const ua = String(d.ua || "");
  const asn = Number(d.asn) || 0;

  if (row && row._draftStillExists) {
    return { label: "Taslak önizlemesi (sayılmadı)", ignore: true };
  }
  const sentMethods = ["Gönderildi", "Eklenti — gönderildi", METHOD_CHROME];
  const windowSec =
    SCANNER_WINDOW_SEC;
  if (
    row &&
    sentMethods.indexOf(row[C.METHOD]) !== -1 &&
    row[C.CREATED] &&
    !isNaN(new Date(row[C.CREATED])) &&
    (ts - new Date(row[C.CREATED])) / 1000 < windowSec
  ) {
    return { label: "Gönderimden hemen sonra — güvenlik tarayıcısı olabilir", suspicious: true };
  }
  // Yandex Mail resimleri alıcı maili açınca kendi sunucusundan yükler
  if (/YandexImageResizer/i.test(ua)) {
    return isClick
      ? { label: "Tıklama", suspicious: false }
      : { label: "Yandex Mail", suspicious: false };
  }
  if (/bot|crawler|spider|scanner|safelinks|barracuda|mimecast|proofpoint/i.test(ua)) {
    return { label: "Otomatik tarayıcı (şüpheli)", suspicious: true };
  }
  if (isClick) return { label: "Tıklama", suspicious: false };

  if (asn === 714 || asn === 6185 || ua === "Mozilla/5.0") {
    return { label: "Apple Gizlilik Koruması (şüpheli)", suspicious: true };
  }
  if (/GoogleImageProxy/i.test(ua)) return { label: "Gmail", suspicious: false };
  if (/Outlook|Microsoft Office/i.test(ua)) return { label: "Outlook", suspicious: false };
  return { label: "Normal", suspicious: false };
}
