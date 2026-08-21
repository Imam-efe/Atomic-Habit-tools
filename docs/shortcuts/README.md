# Integrasi Notifikasi Fayolla → iOS Shortcuts

Fitur ini membuat aplikasi Shortcuts di iPhone dapat membaca notifikasi yang dikeluarkan sistem Fayolla (pengingat habit, alert stok kadaluarsa), lalu memicu aksi apa pun yang Anda atur sendiri di Shortcuts.

## Cara kerja

1. Setiap kali worker Fayolla mengirim push notification, event yang sama juga disimpan ke antrian `notification_events` di database.
2. Shortcut melakukan polling ke endpoint:

   ```
   GET https://fayolla-api.imamefe4.workers.dev/api/shortcut/notifications?token=<API_KEY>
   ```

3. Endpoint mengembalikan event yang belum dikonsumsi, lalu menandainya sebagai sudah dikonsumsi — sehingga setiap event hanya memicu Shortcut satu kali.

   Contoh respons:

   ```json
   {
     "count": 1,
     "notifications": [
       {
         "id": "abc123",
         "type": "habit_reminder",
         "title": "Pengingat Kebiasaan",
         "body": "Ayo lakukan kebiasaanmu: Olahraga! ✨",
         "payload": { "habitId": "...", "habitName": "Olahraga", "url": "/kebiasaan" },
         "createdAt": 1755772800
       }
     ]
   }
   ```

   Parameter opsional:
   - `?peek=1` — baca tanpa menandai dikonsumsi (untuk testing).
   - `?limit=50` — maksimum event per polling (default 20, maks 50).

   Autentikasi bisa lewat query `?token=` (paling mudah untuk Shortcuts) atau header `Authorization: Bearer <API_KEY>`.

## Instalasi di iPhone

### Opsi A — Impor file shortcut

1. Unduh `Fayolla-Notifikasi.shortcut` dari folder ini ke iPhone.
2. Buka file tersebut; Shortcuts akan menanyakan URL saat impor — ganti `TEMPEL_API_KEY_DISINI` dengan API Key dari menu **Lainnya → Integrasi Shortcut iPhone** di aplikasi Fayolla.

> Catatan: iOS menolak impor file shortcut yang tidak ditandatangani (unsigned) pada sebagian versi. Jika muncul pesan "tidak dapat mengimpor pintasan", gunakan Opsi B — hanya butuh 4 aksi.

### Opsi B — Buat manual (4 aksi, ±2 menit)

1. Buka **Shortcuts** → buat shortcut baru bernama `Fayolla Notifikasi`.
2. Tambahkan aksi **Get Contents of URL**, isi URL:
   `https://fayolla-api.imamefe4.workers.dev/api/shortcut/notifications?token=<API_KEY_ANDA>`
3. Tambahkan aksi **Get Dictionary Value**, key: `notifications`.
4. Tambahkan aksi **Repeat with Each**.
5. Di dalam repeat, tambahkan **Get Dictionary Value** key `body` (input: Repeat Item), lalu **Show Notification** dengan isi dari Dictionary Value tersebut.
6. Selesai. Ganti/tambah aksi di dalam repeat sesuka Anda (nyalakan lampu, jalankan shortcut lain, kirim pesan, dsb). Gunakan `Get Dictionary Value` key `type` + aksi **If** untuk membedakan `habit_reminder` vs `expiry_alert`.

## Menjalankan otomatis

Shortcuts tidak bisa dipicu langsung oleh web push, jadi gunakan Personal Automation sebagai polling:

1. Shortcuts → tab **Automation** → **+** → **Time of Day**.
2. Pilih waktu (mis. tiap jam bisa dibuat beberapa automation, atau pakai trigger lain: saat buka app tertentu, saat sampai lokasi, saat alarm berhenti, dsb).
3. Pilih **Run Immediately** (tanpa konfirmasi) → pilih shortcut `Fayolla Notifikasi`.

Setiap kali automation berjalan, semua notifikasi baru sejak polling terakhir akan diproses satu per satu.

## Jenis event saat ini

| type | Kapan terjadi | payload |
|---|---|---|
| `habit_reminder` | Waktu pengingat habit tercapai | `habitId`, `habitName`, `url` |
| `expiry_alert` | Item inventori mendekati kadaluarsa (jam 8 pagi WIB) | `items[]`, `url` |

Event yang sudah dikonsumsi dibersihkan otomatis setelah 7 hari.
