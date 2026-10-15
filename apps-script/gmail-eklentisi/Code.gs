/**
 * FiS Mail Takip — Gmail Eklentisi ("📬 Takip ekle" butonu)
 *
 * Gmail'de yeni mail yazarken alttaki eklenti simgesine basınca açılır.
 *  - "Takip ekle": maile görünmez takip pikselini ekler ve maili
 *    Mail Takip Sheet'indeki "Gönderimler" sekmesine kaydeder.
 *  - "Takipli link ekle": imlecin olduğu yere tıklaması ölçülen bir link ekler.
 *
 * Gerekli Script Properties (Proje Ayarları > Script properties):
 *   SHEET_ID    Mail Takip Sheet'inin ID'si
 *   WORKER_URL  Cloudflare Worker adresiniz (örn. https://mail-takip.hesabiniz.workers.dev)
 *   SECRET      Sheet'e bağlı projedeki SECRET'ın AYNISI
 */

const SENT_SHEET = "Gönderimler";
const SENT_COLS = 13;
const METHOD_PENDING = "Eklenti — gönderilmedi";

/* ------------------------------------------------------------------ */
/* Kartlar                                                             */
/* ------------------------------------------------------------------ */

function onHomepage() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("📬 FiS Mail Takip"))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          "Yeni bir mail yazarken, yazma penceresinin altındaki bu eklentinin " +
            "simgesine basın ve <b>Takip ekle</b>'yi seçin.<br><br>" +
            "Açılma ve tıklamalar <b>Mail Takip</b> Sheet'indeki " +
            "<b>Gönderimler</b> sekmesine düşer."
        )
      )
    )
    .build();
}

function onCompose(e) {
  const cfg = config_();
  if (!cfg.ok) return [errorCard_(cfg.message)];

  const id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  const params = { id: id };

  const pixelSection = CardService.newCardSection()
    .setHeader("1. Açılma takibi")
    .addWidget(
      CardService.newTextParagraph().setText(
        "Önce alıcıyı ve konuyu yazın, sonra butona basın. " +
          "Mailin sonuna görünmez bir piksel eklenir."
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText("📬 Takip ekle")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setComposeAction(
          CardService.newAction().setFunctionName("insertPixel").setParameters(params),
          CardService.ComposedEmailType.STANDALONE_DRAFT
        )
    );

  const linkSection = CardService.newCardSection()
    .setHeader("2. Takipli link (isteğe bağlı)")
    .addWidget(
      CardService.newTextInput()
        .setFieldName("url")
        .setTitle("Adres")
        .setHint("https://ornek.com/...")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("label")
        .setTitle("Görünecek yazı")
        .setHint("Boş bırakılırsa adres görünür")
    )
    .addWidget(
      CardService.newTextButton()
        .setText("🔗 Takipli link ekle")
        .setComposeAction(
          CardService.newAction().setFunctionName("insertLink").setParameters(params),
          CardService.ComposedEmailType.STANDALONE_DRAFT
        )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        "<font color=\"#6b7280\">Link, imlecin bulunduğu yere eklenir.</font>"
      )
    );

  return [
    CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle("📬 Mail Takip"))
      .addSection(pixelSection)
      .addSection(linkSection)
      .build(),
  ];
}

/* ------------------------------------------------------------------ */
/* Ekleme işlemleri                                                    */
/* ------------------------------------------------------------------ */

function insertPixel(e) {
  const cfg = config_();
  if (!cfg.ok) return notify_(cfg.message);

  const meta = draftMeta_(e);
  if (!meta.to.length) return notify_("Önce alıcıyı (Kime) ekleyin, sonra tekrar basın.");

  const id = e.parameters.id;
  ensureRow_(cfg, id, meta);

  const pixel =
    '<img src="' + cfg.worker + "/o/" + id + '.gif" width="1" height="1" alt="" ' +
    'style="display:block;width:1px;height:1px;border:0;" />';

  return updateDraft_(pixel, CardService.UpdateDraftBodyType.INSERT_AT_END);
}

function insertLink(e) {
  const cfg = config_();
  if (!cfg.ok) return notify_(cfg.message);

  const meta = draftMeta_(e);
  if (!meta.to.length) return notify_("Önce alıcıyı (Kime) ekleyin, sonra tekrar basın.");

  const inputs = (e.commonEventObject && e.commonEventObject.formInputs) || {};
  const url = readInput_(inputs, "url").trim();
  const label = readInput_(inputs, "label").trim() || url;
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return notify_("Geçerli bir adres girin (https:// ile başlamalı).");
  }

  const id = e.parameters.id;
  ensureRow_(cfg, id, meta);

  const sig = hmacHex_(cfg.secret, id + "|" + url).slice(0, 16);
  const href = cfg.worker + "/c/" + id + "?u=" + encodeURIComponent(url) + "&amp;s=" + sig;
  const html = '<a href="' + href + '">' + escapeHtml_(label) + "</a>";

  return updateDraft_(html, CardService.UpdateDraftBodyType.IN_PLACE_INSERT);
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function ensureRow_(cfg, id, meta) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName(SENT_SHEET);
    if (!sheet) throw new Error("'" + SENT_SHEET + "' sekmesi bulunamadı.");
    const found = sheet.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();
    if (found) {
      // Alıcı veya konu sonradan değiştiyse güncelle
      sheet.getRange(found.getRow(), 2).setValue(meta.to.join(", "));
      if (meta.subject) sheet.getRange(found.getRow(), 4).setValue(meta.subject);
      return;
    }
    const row = new Array(SENT_COLS).fill("");
    row[0] = id;
    row[1] = meta.to.join(", ");
    row[3] = meta.subject;
    row[4] = METHOD_PENDING;
    row[5] = new Date();
    row[7] = 0;
    row[8] = 0;
    row[10] = 0;
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}

function draftMeta_(e) {
  const d = (e && e.draftMetadata) || (e && e.gmail && e.gmail.draftMetadata) || {};
  const to = [].concat(d.toRecipients || [], d.ccRecipients || [], d.bccRecipients || [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  return { to: to, subject: d.subject || "" };
}

function readInput_(inputs, name) {
  const field = inputs[name];
  if (!field || !field.stringInputs || !field.stringInputs.value) return "";
  return String(field.stringInputs.value[0] || "");
}

function updateDraft_(html, type) {
  return CardService.newUpdateDraftActionResponseBuilder()
    .setUpdateDraftBodyAction(
      CardService.newUpdateDraftBodyAction()
        .addUpdateContent(html, CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(type)
    )
    .build();
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function errorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("📬 Mail Takip — ayar eksik"))
    .addSection(
      CardService.newCardSection().addWidget(CardService.newTextParagraph().setText(message))
    )
    .build();
}

function config_() {
  const p = PropertiesService.getScriptProperties();
  const sheetId = p.getProperty("SHEET_ID");
  const worker = (p.getProperty("WORKER_URL") || "").replace(/\/+$/, "");
  const secret = p.getProperty("SECRET");
  if (!sheetId || !worker || !secret) {
    return {
      ok: false,
      message:
        "Eklentinin Script properties bölümüne SHEET_ID, WORKER_URL ve SECRET eklenmeli.",
    };
  }
  return { ok: true, sheetId: sheetId, worker: worker, secret: secret };
}

function hmacHex_(secret, message) {
  return Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
