# Kurulum

Bu rehber sistemi sıfırdan kurmayı anlatır. Kurulum yaklaşık 20 dakika sürer. İhtiyacın olanlar:

- Bir Google hesabı (Gmail veya Google Workspace)
- Ücretsiz bir Cloudflare hesabı
- Google Chrome

Kurulum sırasında birbirine bağlanacak üç değer oluşacak. Bunları bir kenara not et:

| Değer | Nereden gelir | Örnek |
|---|---|---|
| **SECRET** | Apps Script kurulumu üretir | 64 karakter, 0–9 ve a–f |
| **Web uygulaması adresi** | Apps Script yayınlama | `https://script.google.com/macros/s/…/exec` |
| **Worker adresi** | Cloudflare | `https://mail-takip.hesabin.workers.dev` |

---

## 1. Google Sheet ve Apps Script

1. [sheets.new](https://sheets.new) ile yeni bir Google Sheet oluştur ve adını örneğin **Mail Takip** koy.
2. **Uzantılar → Apps Script**'i aç.
3. `Code.gs` dosyasının içeriğini sil ve [`apps-script/sheet/Code.gs`](../apps-script/sheet/Code.gs) dosyasının içeriğini yapıştır. **Kaydet**'e bas.
4. Sheet'e dön ve sayfayı yenile. Üst menüde **📬 Mail Takip** belirecek.
5. **📬 Mail Takip → 1) Kurulumu yap**'ı çalıştır.
   - Google izin isteyecek. "Google bu uygulamayı doğrulamadı" uyarısı çıkarsa **Gelişmiş → … sayfasına git (güvenli değil)** yolunu izle. Bu uyarı, kod senin hesabında çalıştığı için çıkar.
   - İzin verdikten sonra pencere açılmazsa menüyü bir kez daha çalıştır.
   - Açılan pencerede **SECRET** görünür. Bu değere sonra Apps Script'te **⚙️ Proje Ayarları → Script properties** bölümünden de ulaşabilirsin.

Kurulum; **Kuyruk**, **Gönderimler** ve **Olaylar** sekmelerini oluşturur.

## 2. Apps Script'i web uygulaması olarak yayınla

1. Apps Script editöründe **Dağıt → Yeni dağıtım**'a tıkla.
2. Dişli simgesinden türü **Web uygulaması** seç.
3. **Yürüten: Ben** ve **Erişimi olanlar: Herkes** olarak ayarla.
4. **Dağıt**'a bas ve `/exec` ile biten **web uygulaması adresini** kopyala.

> "Herkes" ayarı güvenlidir: SECRET'ı bilmeyen istekler reddedilir.

## 3. Cloudflare Worker

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Start with Hello World** yolunu izle. Bir ad ver (ör. `mail-takip`) ve **Deploy**'a bas.
2. **Edit code**'a tıkla, içeriği sil, [`worker/worker.js`](../worker/worker.js) dosyasının içeriğini yapıştır ve **Deploy**'a bas.
3. Worker'ın **Settings → Variables and Secrets** bölümünde iki değişken ekle:
   - `SHEET_WEBHOOK` (Text): web uygulaması adresi
   - `SECRET` (**Secret** olarak işaretle): 1. adımdaki SECRET
4. Tekrar **Deploy**'a bas ve **Worker adresini** kopyala.

Komut satırını tercih edersen [`worker/wrangler.toml.example`](../worker/wrangler.toml.example) dosyasını kullanabilirsin.

## 4. Bağlantıyı test et

1. Sheet'te **📬 Mail Takip → 2) Ayarlar (Worker adresi)**'nı aç ve Worker adresini gir.
2. **3) Bağlantıyı test et**'i çalıştır. "Her şey çalışıyor ✅" mesajını görmelisin; **Olaylar** sekmesine bir `baglantitesti` satırı düşer.

## 5. Chrome eklentisi

1. Bu depoyu indir (**Code → Download ZIP**) ve aç. `chrome-eklentisi` klasörünü silinmeyeceği bir yere koy.
2. Chrome'da `chrome://extensions` adresine git ve sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle**'ye tıkla ve `chrome-eklentisi` klasörünü seç.
4. Açılan **Ayarlar** sayfasına Worker adresini, web uygulaması adresini ve SECRET'ı gir. **Bağlantıyı test et**'e bas.
5. Gmail sekmesini kapatıp yeniden aç.

**Kullanım:** Gmail'de yeni mail yaz ve alıcıyı ekle. Bir iki saniye içinde **Send** butonunun yanındaki etiket **📬 Takip hazır** olur. Maili normal şekilde gönder.

- Tek bir mailde takip istemiyorsan göndermeden önce etikete tıkla. Etiket **📭 Takip kapalı** olur, piksel ve linkler geri alınır.
- Takibi tamamen kapatmak için araç çubuğundaki eklenti simgesinden **Takip açık** kutusunun işaretini kaldır.
- Eklenti simgesi; sürümü, son işlemi ve son Sheet kaydını gösterir.

> **Göndermeye başlamadan önce:** Alıcılarını takip ettiğin konusunda bilgilendirmen gerekir (KVKK m.10). Gmail imzana kısa bir bilgilendirme notu ekle. Örnek metin ve diğer yükümlülükler için README'deki [Aydınlatma yükümlülüğü](../README.md#aydınlatma-yükümlülüğü) bölümüne bak.

## 6. *(İsteğe bağlı)* Gmail eklentisi: "Takip ekle" butonu

Chrome eklentisinin olmadığı yerlerde, örneğin başka bir bilgisayarda, yazma penceresine elle takip eklemek için kullanılır.

1. [script.google.com](https://script.google.com) → **Yeni proje**'ye tıkla ve adını örneğin **Mail Takip Eklentisi** koy.
2. `Code.gs` dosyasına [`apps-script/gmail-eklentisi/Code.gs`](../apps-script/gmail-eklentisi/Code.gs) dosyasının içeriğini yapıştır.
3. **⚙️ Proje Ayarları**'nda **"appsscript.json" manifest dosyasını düzenleyicide göster** seçeneğini işaretle. `appsscript.json` dosyasının içeriğini [`apps-script/gmail-eklentisi/appsscript.json`](../apps-script/gmail-eklentisi/appsscript.json) ile değiştir.
4. **Script properties** bölümüne şu üç değeri ekle:
   - `SHEET_ID`: Sheet adresindeki `/d/` ile `/edit` arasındaki kimlik
   - `WORKER_URL`: Worker adresi
   - `SECRET`: aynı SECRET
5. **Dağıt → Test dağıtımları → Yükle**'ye bas ve Gmail'i yenile.

**Kullanım:** Yeni mail yaz ve önce alıcıyı ekle. Yazma penceresinin alt çubuğundaki eklenti simgesinden **📬 Takip ekle**'ye bas. İstersen **Takipli link ekle** ile imlecin bulunduğu yere takipli bir link de ekleyebilirsin.

> Aynı mailde hem bu butonu hem Chrome eklentisini kullanmak sorun yaratmaz. Chrome eklentisi mevcut takip kimliğini tanır ve ikinci bir piksel eklemez.

## 7. *(İsteğe bağlı)* Kuyruk ile toplu gönderim

**Kuyruk** sekmesine her alıcı için bir satır ekle: **E-posta**, **Ad**, **Konu** ve **Mesaj**. Mesajda `{{Ad}}` ve `{{Email}}` kullanılabilir; linkler otomatik olarak takip linkine çevrilir.

- **📬 Mail Takip → Kuyruktakileri Gmail taslağı yap**: Mailler Taslaklar'a düşer, kontrol edip kendin gönderirsin.
- **📬 Mail Takip → Kuyruktakileri hemen gönder**: Onay aldıktan sonra doğrudan gönderir.

Script ile gönderim kotası normal Gmail hesabında günde yaklaşık 100, Google Workspace hesabında yaklaşık 1.500 alıcıdır.

---

## Kodu güncellerken

- **Apps Script (Sheet):** Kodu değiştirdikten sonra **Dağıt → Dağıtımları yönet → ✏️ → Sürüm: Yeni sürüm → Dağıt** yolunu izle. Bunu yapmazsan web uygulaması eski kodla çalışmaya devam eder. Adres değişmez.
- **Worker:** Cloudflare'de **Edit code** ekranına yeni kodu yapıştır ve **Deploy**'a bas.
- **Chrome eklentisi:** Dosyaları klasörün üzerine kopyala, `chrome://extensions` sayfasında **↻**'ye bas ve **açık bütün Gmail sekmelerini kapatıp yeniden aç**. Yenilenmeyen sekmede eski kod çalışmaya devam eder ve Sheet'e kayıt gönderemez. Ayarlar silinmez.

## Sorun giderme

| Belirti | Olası neden |
|---|---|
| Bağlantı testi "kayıt Sheet'e düşmedi" diyor | Cloudflare'deki `SHEET_WEBHOOK` veya `SECRET` yanlış ya da web uygulaması erişimi "Herkes" değil |
| Etiket "📬 Takip: ayar eksik" diyor | Chrome eklentisinin Ayarlar sayfası eksik |
| Etiket "Takip hazır" olmuyor | Alıcı eklenmemiş ya da Gmail sekmesi eklenti güncellendikten sonra yenilenmemiş |
| Satır "Chrome — gönderilmedi" olarak kalıyor | Mail henüz açılmamış. Durum ilk açılma veya tıklamada güncellenir. Mail hiç gönderilmediyse satır öyle kalır, silebilirsin |
| Açılmalar "Taslak önizlemesi" olarak görünüyor | Mail hâlâ Taslaklar'da, ya da Gönderilmiş klasöründe takip kimliği bulunamadı |
| Çok sayıda "Şüpheli açılma" | Alıcı Apple Mail kullanıyor ya da kurumsal güvenlik tarayıcısı maili tarıyor. Tıklama verisine bak |
| Linke tıklanınca "Geçersiz bağlantı" | Chrome eklentisindeki SECRET ile Worker'daki SECRET farklı |
| Olaylar'da E-posta ve Konu boş | Mail, eklenti güncellendikten sonra yenilenmemiş bir Gmail sekmesinden gönderilmiş. Yeni sürümde ilk açılmada Gönderilmiş klasöründen otomatik tamamlanır. Eski kayıtlar için **📬 Mail Takip → Eksik alıcı/konu bilgilerini tamamla** |
