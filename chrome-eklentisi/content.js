/**
 * Fener Mail Takip — Gmail içerik betiği (1.1)
 *
 * Gönder tıklamasına bağlı DEĞİL: Gmail'deki başka eklentiler (InboxSDK
 * tabanlı araçlar gibi) tıklamayı yakalayıp durdurabildiği için takip, mail
 * yazılırken önceden eklenir. Alıcı ve mesaj gövdesi hazır olduğunda:
 *   1. Maile görünmez takip pikseli eklenir
 *   2. Maildeki tüm linkler (Gmail imzası dahil) o maile özel takip linkine çevrilir
 *   3. Alıcı ve konu Sheet'e "Chrome — gönderilmedi" olarak kaydedilir
 * Mail gönderildiğinde Sheet tarafı bunu Gönderilmiş klasöründen kendisi anlar
 * ve satırı "Chrome — gönderildi" yapar. Gönderilmeyen taslaklar sayılmaz.
 *
 * Yazma penceresindeki "📬 Takip" etiketine tıklayarak tek bir mailde takip
 * kapatılabilir; o zaman eklenen piksel ve linkler geri alınır.
 *
 * Ayrıca Gmail'de kendi gönderdiğin maili açtığında takip pikselini sayfadan
 * kaldırır; böylece kendi görüntülemen "açıldı" olarak sayılmaz.
 */
(function () {
  "use strict";

  let cfg = Object.assign({}, FENER_DEFAULTS);
  let cfgLoaded = false;

  const EDITOR_SEL =
    'div[contenteditable="true"][role="textbox"], div[contenteditable="true"].editable';
  const BODY_SEL =
    'div.editable[contenteditable="true"], div[g_editable="true"][contenteditable="true"]';
  const SEND_SEL =
    '.aoO[role="button"], div[role="button"][data-tooltip*="⌘Enter"], div[role="button"][data-tooltip*="Ctrl-Enter"], div[role="button"][data-tooltip*="Ctrl+Enter"]';
  const COMPOSE_SEL = ".M9, .ip, .aoI";
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const ARM_INTERVAL_MS = 1200;

  const ready = () => Boolean(cfg.enabled && cfg.workerUrl && cfg.secret && cfg.webhookUrl);
  const base = () => String(cfg.workerUrl || "").replace(/\/+$/, "");
  const host = () => {
    try {
      return new URL(cfg.workerUrl).host;
    } catch (e) {
      return "";
    }
  };

  // Takip linkine çevrilen linklerin asıl adresleri (takip kapatılırsa geri yüklemek için)
  const originalHref = new WeakMap();

  /* ---------------------------------------------------------------- */
  /* Yazma penceresini bulma                                           */
  /* ---------------------------------------------------------------- */

  function composeRootFrom(el) {
    let n = el;
    let minimal = null;
    while (n && n !== document.body && n !== document.documentElement) {
      if (n.querySelector && n.querySelector(EDITOR_SEL) && n.querySelector(SEND_SEL)) {
        minimal = n;
        break;
      }
      n = n.parentElement;
    }
    if (!minimal) return null;

    const known = minimal.closest(COMPOSE_SEL);
    if (known && known.querySelectorAll(BODY_SEL).length <= 1) return known;

    let r = minimal;
    for (let i = 0; i < 25; i++) {
      if (r.querySelector('input[name="subjectbox"]')) break;
      const p = r.parentElement;
      if (!p || p === document.body || p.querySelectorAll(BODY_SEL).length > 1) break;
      r = p;
    }
    return r;
  }

  function editorOf(root) {
    return root.querySelector(BODY_SEL) || root.querySelector(EDITOR_SEL);
  }

  function ownEmail() {
    const m = (document.title || "").match(EMAIL_RE);
    return m ? m[m.length - 1].toLowerCase() : "";
  }

  function collectRecipients(root) {
    const set = new Set();
    const add = (s) => (String(s || "").match(EMAIL_RE) || []).forEach((e) => set.add(e.toLowerCase()));
    const ok = (el) => !el.closest('[name="from"]') && !el.closest('[contenteditable="true"]');

    root.querySelectorAll("[email]").forEach((el) => ok(el) && add(el.getAttribute("email")));
    root.querySelectorAll("[data-hovercard-id]").forEach(
      (el) => ok(el) && add(el.getAttribute("data-hovercard-id"))
    );
    root
      .querySelectorAll(
        'input[name="to"], input[name="cc"], input[name="bcc"], textarea[name="to"], textarea[name="cc"], textarea[name="bcc"]'
      )
      .forEach((el) => add(el.value));
    root.querySelectorAll('input[type="text"], input:not([type])').forEach((el) => {
      if (el.name === "subjectbox" || !ok(el)) return;
      if (/@/.test(el.value)) add(el.value);
    });
    return [...set];
  }

  function recipientsOf(root) {
    let list = collectRecipients(root);
    if (!list.length) {
      const wider = root.closest('[role="dialog"], .M9, .nH.Hd, .ip');
      if (wider && wider !== root && wider.querySelectorAll(BODY_SEL).length <= 1) {
        list = collectRecipients(wider);
      }
    }
    const me = ownEmail();
    if (me && list.length > 1) list = list.filter((e) => e !== me);
    return list;
  }

  function subjectOf(root) {
    const s = root.querySelector('input[name="subjectbox"]');
    if (s && s.value) return s.value;
    const h = document.querySelector("h2.hP, h2[data-thread-perm-id]");
    return h ? "Re: " + h.textContent.trim() : "";
  }

  function newId() {
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  function send(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) {
      return false; // eklenti yeniden yüklendiyse bu sekme yenilenmeli
    }
  }

  function note(text) {
    try {
      chrome.storage.local.set({ lastAttempt: { at: new Date().toISOString(), ok: true, text: text } });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- */
  /* Takibi hazırlama (Gönder'den önce)                                */
  /* ---------------------------------------------------------------- */

  function existingPixel(body) {
    const w = base();
    return (
      body.querySelector("img[data-fener-pixel]") ||
      Array.from(body.querySelectorAll("img")).find(
        (i) => (i.getAttribute("src") || "").indexOf(w + "/o/") === 0
      )
    );
  }

  function arm(root) {
    if (!root || !ready() || root.dataset.fenerSkip === "1") return;
    const body = editorOf(root);
    if (!body) return;
    const to = recipientsOf(root);
    if (!to.length) return;

    const w = base();
    const px = existingPixel(body);
    const pxId = px
      ? px.dataset.fenerPixel ||
        ((px.getAttribute("src") || "").match(/\/o\/([A-Za-z0-9_-]+)\.gif/) || [])[1]
      : "";
    const id = root.dataset.fenerId || pxId || newId();
    root.dataset.fenerId = id;

    // Linkleri takip linkine çevir (alıntılanan eski mesajlar hariç)
    body.querySelectorAll("a[href]").forEach((a) => {
      if (a.closest(".gmail_quote, blockquote")) return;
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) || href.indexOf(w + "/") === 0) return;
      const sig = fenerHmacHex(cfg.secret, id + "|" + href).slice(0, 16);
      originalHref.set(a, href);
      a.setAttribute("href", w + "/c/" + id + "?u=" + encodeURIComponent(href) + "&s=" + sig);
    });

    // Görünmez piksel
    if (!px) {
      const img = document.createElement("img");
      img.src = w + "/o/" + id + ".gif";
      img.width = 1;
      img.height = 1;
      img.alt = "";
      img.setAttribute("style", "display:block;width:1px;height:1px;border:0;");
      img.dataset.fenerPixel = id;
      body.appendChild(img);
    }

    // Sheet kaydı: alıcı veya konu değiştikçe güncellenir
    const subject = subjectOf(root);
    const sig = id + "|" + to.join(",") + "|" + subject;
    if (root.dataset.fenerReg !== sig) {
      const sent = send({
        kind: "register",
        payload: {
          type: "register",
          id: id,
          to: to.join(", "),
          subject: subject,
          ts: new Date().toISOString(),
        },
      });
      if (sent) {
        root.dataset.fenerReg = sig;
        note("Takip hazır: " + to.join(", "));
      }
    }
    const chip = root.querySelector(".fener-chip");
    if (chip) updateChip(chip);
  }

  function disarm(root) {
    const body = editorOf(root);
    const id = root.dataset.fenerId;
    if (body) {
      body.querySelectorAll("img[data-fener-pixel]").forEach((img) => img.remove());
      body.querySelectorAll("a[href]").forEach((a) => {
        const orig = originalHref.get(a);
        if (orig) a.setAttribute("href", orig);
      });
    }
    if (id && root.dataset.fenerReg) send({ kind: "register", payload: { type: "unregister", id: id } });
    delete root.dataset.fenerReg;
    delete root.dataset.fenerId;
  }

  function armAll() {
    if (!cfgLoaded) return;
    document.querySelectorAll(BODY_SEL).forEach((body) => {
      const root = composeRootFrom(body);
      if (root) arm(root);
    });
  }
  setInterval(armAll, ARM_INTERVAL_MS);

  // Gönder tıklaması görülürse son bir kez daha hazırla (alıcı son anda
  // eklendiyse). Gmail'deki başka eklentiler bu olayı durdurabilir; sorun
  // değil, takip zaten önceden eklenmiş olur.
  const onPress = (e) => {
    const btn = e.target && e.target.closest && e.target.closest(SEND_SEL);
    if (btn) arm(composeRootFrom(btn));
  };
  ["pointerdown", "mousedown", "click"].forEach((t) => window.addEventListener(t, onPress, true));
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || ((e.key === "Enter" || e.key === " ") && t.closest(SEND_SEL))) {
        arm(composeRootFrom(t));
      }
    },
    true
  );

  /* ---------------------------------------------------------------- */
  /* Yazma penceresindeki "Takip" etiketi                              */
  /* ---------------------------------------------------------------- */

  function updateChip(chip) {
    const root = composeRootFrom(chip);
    const skip = root && root.dataset.fenerSkip === "1";
    const armed = root && root.dataset.fenerReg;
    let text, title, dim;
    if (!ready()) {
      text = "📬 Takip: ayar eksik";
      title = "Eklentinin Ayarlar sayfasını doldurun";
      dim = true;
    } else if (skip) {
      text = "📭 Takip kapalı";
      title = "Bu mail takipsiz gidecek. Açmak için tıklayın.";
      dim = true;
    } else if (armed) {
      text = "📬 Takip hazır";
      title = "Takip eklendi. Bu mailde kapatmak için tıklayın.";
      dim = false;
    } else {
      text = "📬 Takip açık";
      title = "Alıcı eklenince takip hazırlanır. Bu mailde kapatmak için tıklayın.";
      dim = false;
    }
    if (chip.textContent !== text) chip.textContent = text;
    chip.style.opacity = dim ? "0.55" : "1";
    chip.title = title;
  }

  function addChip(sendBtn) {
    const anchor = sendBtn.closest(".dC") || sendBtn;
    if (!anchor.parentElement || anchor.parentElement.querySelector(".fener-chip")) return;
    const chip = document.createElement("span");
    chip.className = "fener-chip";
    chip.setAttribute(
      "style",
      "display:inline-flex;align-items:center;margin-left:8px;padding:2px 8px;border-radius:12px;" +
        "font:500 12px/18px Arial,sans-serif;background:#e8f0fe;color:#174ea6;cursor:pointer;" +
        "user-select:none;white-space:nowrap;vertical-align:middle;"
    );
    ["pointerdown", "mousedown"].forEach((t) => chip.addEventListener(t, (e) => e.stopPropagation(), true));
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const root = composeRootFrom(chip);
      if (!root) return;
      if (root.dataset.fenerSkip === "1") {
        root.dataset.fenerSkip = "0";
        arm(root);
      } else {
        root.dataset.fenerSkip = "1";
        disarm(root);
      }
      updateChip(chip);
    });
    anchor.insertAdjacentElement("afterend", chip);
    updateChip(chip);
  }

  /* ---------------------------------------------------------------- */
  /* Kendi görüntülemelerini engelleme                                 */
  /* ---------------------------------------------------------------- */

  function isOwnPixel(img) {
    const h = host();
    if (!h || img.dataset.fenerPixel || img.closest('[contenteditable="true"]')) return false;
    const src = img.getAttribute("src") || "";
    return src.indexOf(h + "/o/") !== -1;
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    const imgs = node.tagName === "IMG" ? [node] : node.querySelectorAll("img");
    imgs.forEach((img) => {
      if (isOwnPixel(img)) {
        img.removeAttribute("src");
        img.remove();
      }
    });
    const sends = node.matches && node.matches(SEND_SEL) ? [node] : node.querySelectorAll(SEND_SEL);
    sends.forEach(addChip);
  }

  new MutationObserver((mutations) => {
    if (!cfgLoaded) return;
    for (const m of mutations) {
      if (m.type === "attributes") scan(m.target);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  /* ---------------------------------------------------------------- */
  /* Ayarlar                                                           */
  /* ---------------------------------------------------------------- */

  chrome.storage.local.get(FENER_DEFAULTS, (v) => {
    cfg = v;
    cfgLoaded = true;
    if (document.documentElement) scan(document.documentElement);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k in changes) {
      if (k in FENER_DEFAULTS) cfg[k] = changes[k].newValue;
    }
    document.querySelectorAll(".fener-chip").forEach(updateChip);
  });
})();
