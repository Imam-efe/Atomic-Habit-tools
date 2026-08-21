# Setup Personal Automation untuk Auto-Polling

Shortcut yang Anda buat sudah benar, tapi perlu **Personal Automation** untuk menjalankannya otomatis.

## Langkah Setup di iPhone

### 1. Buka Shortcuts App
- Tap tab **Automation** (ikon jam di bawah)
- Tap **+** untuk automation baru

### 2. Pilih Trigger Type
**Rekomendasi: "Time of Day"** (polling setiap jam tertentu)

Alternatif trigger:
- **Time of Day** - Setiap jam 9:00 pagi, 12:00 siang, 15:00, dll (buat beberapa untuk polling setiap 2-3 jam)
- **When App Opened** - Setiap kali buka app tertentu (misal Mail, Reminders)
- **Alarm Stops** - Saat alarm pagi bunyinya selesai

### 3. Konfigurasi Automation
1. Pilih waktu (misal: setiap hari jam 9:00, 12:00, 15:00, 18:00)
2. Jangan centang "Ask Before Running" — gunakan "Run Immediately"
3. Pilih shortcut: `Fayolla Notifikasi` (atau nama Shortcut Anda)
4. Tap **Done**

### 4. Test
- Buka terminal/Warp
- Trigger notification:
  ```bash
  curl -X POST https://fayolla-api.imamefe4.workers.dev/api/habits/daily-reminder \
    -H "Authorization: Bearer YOUR_JWT_TOKEN" \
    -H "Content-Type: application/json"
  ```
- Tunggu automation trigger pada waktu yang dijadwalkan
- Atau: Manual test dengan membuka Shortcuts app → tap **Fayolla Notifikasi** → biar jalan

### Troubleshoot

❌ **Notifikasi tidak muncul saat automation trigger**
- Pastikan iPhone **tidak dalam mode Silent**
- Buka Settings → Notifications → Shortcuts → Allow Notifications ON

❌ **"Go to Home Screen" tidak jalan**
- Automation tidak perlu ini — fokus ke notification showing saja
- Atau: Tambahkan delay 2 detik sebelum "Go to Home Screen" agar Shortcut sempat show notification

❌ **Automation tidak pernah jalan**
- Buka Shortcuts → tab Automation → pastikan automation ter-list
- Cek iPhone **tidak dalam Low Power Mode** (bisa block automation)
- Restart iPhone dan coba lagi

## Advanced: Polling Lebih Sering

Jika ingin polling setiap 5 menit:
1. Buat 12 automations (setiap jam 00, 05, 10, 15, ... 55 menit)
2. Atau: Buat automation **When App Opened** + background mode

**Buat automation setiap 5 menit:**
- Automation → Time of Day → Advanced → Repeat: "Every 5 minutes"
- Set durasi (misal: 6:00 AM - 10:00 PM agar hemat battery)

## Checking API Response

Test apakah API mengembalikan notifikasi:

```bash
curl "https://fayolla-api.imamefe4.workers.dev/api/shortcut/notifications?token=YOUR_API_KEY&peek=1"
```

Harusnya keluar:
```json
{
  "count": 1,
  "notifications": [
    {
      "id": "abc123",
      "type": "habit_reminder",
      "title": "Pengingat Kebiasaan",
      "body": "Ayo lakukan kebiasaanmu!",
      "payload": {...},
      "createdAt": 1755772800
    }
  ]
}
```

Jika `count: 0`, maka tidak ada notifikasi dalam queue (semua sudah dikonsumsi atau belum ada).
