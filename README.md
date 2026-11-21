# MikroTik NOC Fleet Controller

Dashboard manajemen armada Access Point MikroTik untuk NOC rumah sakit / kampus.
Semua komunikasi ke router lewat **native RouterOS API socket port 8728** — tanpa
REST API router, tanpa SSH, tanpa Telnet.

![stack](https://img.shields.io/badge/backend-FastAPI%20%2B%20Python%203.14-009688)
![stack](https://img.shields.io/badge/frontend-React%2019%20%2B%20TypeScript-3178c6)
![stack](https://img.shields.io/badge/ui-Tailwind%20%2B%20Vite-38bdf8)
![offline](https://img.shields.io/badge/asset-zero%20CDN-success)

---

## Fitur

### Monitoring & Telemetri
- **Probe armada paralel** — 80+ AP diprobe serentak (30 worker, timeout 1.2 s) dan
  membaca data nyata dari `/system/resource`: `cpu-load`, `board-name`, `version`, `uptime`.
- **Riwayat SQLite** — `noc_history.db` menyimpan `alert_history` dan `fleet_telemetry`
  sehingga tren CPU/uptime dan riwayat alert tetap ada setelah restart.
- **Alert Telegram** — notifikasi down / recovery / CPU tinggi / RF conflict, dengan
  bot token yang **tidak pernah dikirim ke browser** (hanya versi masked).

### Wireless
- Kelola SSID & Virtual AP: tambah, edit, hapus, enable/disable.
- **Daftar channel real dari router** — dibaca via
  `/interface/wireless/info/country-info` sehingga dropdown hanya menampilkan
  frekuensi yang benar-benar diterima regulatory domain perangkat
  (contoh `country=indonesia` → Ch 149/153/157/161/165 untuk 5 GHz).
- Validasi frekuensi sebelum menulis ke router, dengan pesan error yang menyebut
  channel mana saja yang tersedia — bukan `internal error`.
- Security profile management (WPA2-PSK), kick client, VLAN tagging per SSID.

### RF & Denah
- **Scan spektrum RF** dengan skor kualitas per channel, rekomendasi channel
  terbaik, dan daftar BSSID tetangga.
- Fallback otomatis ke `frequency-monitor` (data identik dengan "Freq. Usage"
  Winbox) saat radio sedang dipakai tool lain.
- **Deteksi Rogue AP / Evil Twin** — BSSID hasil scan dicocokkan dengan cache
  seluruh MAC radio resmi armada; SSID yang menyerupai jaringan internal tapi
  BSSID-nya asing akan ditandai dan dicatat sebagai alert.
- **Denah & heatmap interaktif** — penempatan AP per lantai, radius coverage,
  sinkronisasi channel langsung ke hardware dari popover marker.

### Lainnya
- Web terminal, ping diagnostik, firewall/NAT viewer, router logs, ARP/network.
- AI Optimizer dengan endpoint OpenAI-compatible (model bisa dipilih).
- Backup, export konfigurasi, batch script lintas perangkat.

---

## Stack

| Lapisan | Teknologi |
|---|---|
| Backend | Python 3.14, FastAPI, Uvicorn, `routeros-api`, SQLite |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 3, lucide-react |
| Aset | Font Inter & JetBrains Mono + ikon di-bundle lokal — **nol CDN**, aman untuk jaringan tertutup |

---

## Instalasi

### 1. Backend

```bash
git clone https://github.com/Lumineare/mikrotik-noc-controller.git
cd mikrotik-noc-controller

python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Konfigurasi

Salin file contoh lalu sesuaikan:

```bash
cp .env.example .env
cp devices.example.json devices.json
cp floors.example.json floors.json
```

`.env`

```ini
MT_HOST=192.168.88.1
MT_USER=API
MT_PASS=
MT_PORT=8728
NOC_ADMIN_USER=admin
NOC_ADMIN_PASS=admin123
OMNIROUTE_BASE_URL=https://api.example.com/v1
OMNIROUTE_API_KEY=
```

`devices.json` — daftar AP yang dikelola:

```json
[
  {
    "id": "ap-lobby",
    "name": "AP-LOBBY (cAP ac)",
    "host": "192.168.88.11",
    "port": 8728,
    "user": "API",
    "pass": "your-router-api-password",
    "group": "Lantai 1",
    "is_default": true
  }
]
```

### 3. Frontend

```bash
cd frontend
npm install
npm run build      # hasil ke frontend/dist, disajikan otomatis oleh FastAPI
```

### 4. Jalankan

```bash
python app.py
# atau: start.bat  (Windows)
```

Buka http://127.0.0.1:8090

---

## Persiapan di sisi RouterOS

Aktifkan service API dan buat user khusus (jangan pakai `admin`):

```routeros
/ip service enable api
/user group add name=noc policy=api,read,write,policy,test,winbox
/user add name=API group=noc password=KataSandiKuat
```

Pastikan radio memakai regulatory domain yang benar agar daftar channel sesuai
izin frekuensi setempat:

```routeros
/interface wireless set wlan2 country=indonesia frequency-mode=regulatory-domain
```

Cek channel yang didukung:

```routeros
/interface wireless info country-info country=indonesia
```

---

## Struktur Proyek

```
.
├── app.py                     # FastAPI: seluruh endpoint + logika RouterOS
├── mt_client.py               # Helper koneksi RouterOS API
├── requirements.txt
├── .env.example               # template kredensial
├── devices.example.json       # template daftar perangkat
├── floors.example.json        # template denah & penempatan AP
├── templates/index.html       # UI legacy (single-file)
├── uploads/                   # blueprint denah (SVG)
└── frontend/
    └── src/
        ├── api/client.ts      # typed API client
        ├── components/        # FleetView, DeviceWorkspace, tabs/, map/
        └── types/index.ts
```

### Endpoint penting

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | Status backend & perangkat default |
| POST | `/api/auth/login` | Login dashboard |
| POST | `/api/fleet/probe` | Probe seluruh armada paralel |
| GET | `/api/wireless/interfaces` | Daftar SSID / virtual AP |
| GET | `/api/wireless/supported-channels` | Channel valid menurut regulatory domain router |
| POST | `/api/wireless/interfaces/update` | Simpan konfigurasi wireless |
| GET | `/api/rf/scan` | Scan spektrum + skor channel + deteksi rogue |
| GET | `/api/map/floors` | Denah & penempatan AP |
| POST | `/api/map/sync-hardware` | Push channel dari denah ke router |
| GET | `/api/telegram/history` | Riwayat alert (SQLite) |

---

## Keamanan

- `.env`, `devices.json`, `floors.json`, `telegram_config.json`, `ai_config.json`,
  dan `noc_history.db` **tidak** ikut di-commit (lihat `.gitignore`).
- Bot token Telegram disimpan hanya di server; API mengembalikan versi masked
  (`bot_token: ""`, `bot_token_masked`, `has_token`) sehingga tidak pernah masuk
  ke DOM browser.
- Sandi router disimpan di `devices.json` lokal — jangan commit file tersebut.
- Repo ini memakai IP & nama contoh (`192.168.88.x`); ganti dengan topologi Anda.

---

## Lisensi

MIT
