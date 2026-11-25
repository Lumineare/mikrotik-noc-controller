# MikroTik Controller

Dashboard manajemen armada Access Point MikroTik untuk NOC rumah sakit / kampus.
Semua komunikasi ke router lewat **native RouterOS API socket port 8728** — tanpa
REST API router, tanpa SSH, tanpa Telnet.

![stack](https://img.shields.io/badge/backend-FastAPI%20%2B%20Python%203.14-009688)
![stack](https://img.shields.io/badge/frontend-React%2019%20%2B%20TypeScript-3178c6)
![stack](https://img.shields.io/badge/ui-Tailwind%20%2B%20Vite-38bdf8)
![offline](https://img.shields.io/badge/asset-zero%20CDN-success)

---

## Fitur

### Monitoring, Telemetri & Manajemen Armada
- **Probe armada paralel** — 80+ AP diprobe serentak (30 worker, timeout 1.8 s) dan membaca data nyata dari `/system/resource` (`cpu-load`, `board-name`, `version`, `uptime`) sekaligus **jumlah klien Wi-Fi live** dari `/interface/wireless/registration-table` (dengan fallback `/interface/wifi/registration-table`).
- **Tampilan Grid & Tabel Padat** — kartu perangkat ringkas (klik kartu langsung buka dashboard router) atau mode tabel padat dengan preferensi tersimpan lokal.
- **Filter & Pengurutan Cepat** — filter **Semua / Online / High CPU / 0 Klien / Offline**, filter ruangan/grup, serta pengurutan **Bermasalah dulu**, **Klien terbanyak**, **Klien tersedikit (0 dulu)**, **CPU tertinggi**, **Nama A-Z**, dan **IP Address**.
- **Riwayat SQLite** — `noc_history.db` menyimpan `alert_history`, `fleet_telemetry`, dan `rf_samples` sehingga tren CPU, uptime, kualitas sinyal, dan riwayat alert tetap ada setelah restart.
- **Alert Telegram** — notifikasi down / recovery / CPU tinggi / RF conflict, dengan bot token yang **tidak pernah dikirim ke browser** (hanya versi masked).

### Fleet Wi-Fi Sync (Sinkronisasi SSID & Password Massal)
- **Scan SSID Armada** — memindai paralel seluruh SSID aktif di semua AP lengkap dengan jumlah AP, band, dan profil keamanan.
- **3 Mode Aksi Massal** — **Ganti Password Wi-Fi** (rotasi WPA2-PSK), **Tambah SSID Baru** (Virtual AP 2.4/5 GHz, Open/WPA2-PSK, Hide SSID, VLAN tagging, otomatis masuk bridge), dan **Ganti Nama SSID**.
- **Proteksi Shared Profile** — jika SSID memakai profil `default` atau berbagi profil dengan SSID lain, backend otomatis membuat profil khusus (`sec-<ssid>`) agar SSID lain tidak ikut berubah.
- **Mode Preview (Dry-Run)** — simulasi hasil per AP sebelum menulis ke router, dengan isolasi error per perangkat.

### AI NOC Chatbot & Asisten Troubleshooting
- **Chatbot NOC Berkonteks Telemetri Live** (`POST /api/ai/chat`) — terhubung ke **OmniRoute** / endpoint OpenAI-compatible dengan pilihan model langsung dari UI (`GET /api/ai/models`).
- **Konteks Router Real-Time** — setiap pertanyaan otomatis dilengkapi data live router terpilih: CPU load, free RAM, free flash NAND storage, konfigurasi radio wireless (SSID, band, frekuensi, channel width), jumlah klien & klien sinyal lemah (`< -75 dBm`), status service (`telnet`/`ftp`), dan status FastTrack firewall.
- **Rekomendasi Praktis + Sintaks CLI** — membantu analisis masalah jaringan rumah sakit secara cepat dalam bahasa Indonesia lengkap dengan perintah CLI MikroTik yang siap pakai.
- **AI Diagnose & ML Anomaly** — pemindaian masalah otomatis + aksi perbaikan cepat (`/api/ai/diagnose`, `/api/ai/apply`) serta deteksi anomali berbasis `scikit-learn` (`/api/ai/ml/anomaly`).

### AI Optimize & Auto-RRM (OmniRoute + DCA / TPC)
- **Optimasi Radio Lintas Armada** — menggabungkan perhitungan channel/power bersama (**DCA / TPC / Band Steering**) dengan perencanaan **OmniRoute AI** (endpoint OpenAI-compatible).
- **Validasi Regulatory Domain & Auto-Fallback** — setiap kandidat frekuensi diverifikasi terhadap `supported_freqs` per AP; jika router menolak frekuensi (`bad band or frequency`), sistem otomatis fallback ke channel valid terdekat dari router.
- **Safety Guard & Rollback** — push dilakukan sekuensial per AP; jika jumlah klien turun melebihi batas (`max_client_drop`), proses berhenti dan konfigurasi AP dikembalikan otomatis.
- **Detail Transparan** — modal **AI Optimize** menampilkan ringkasan hasil yang bisa dilipat, detail perubahan per radio, serta alasan mengapa AP tertentu tidak diubah.

### Diagnostik Wi-Fi Armada
- **Link Quality (`100 - CCQ`)** — mendukung mode **Semua AP (Armada)** maupun per-AP dengan filter band (`2.4 GHz`, `5 GHz`, `Semua`) dan daftar klien dengan tekanan link tertinggi.
- **AP Deployment Density** — visualisasi distribusi rata-rata sinyal klien (RSSI) seluruh AP lengkap dengan filter zona (**Baik ≥ -65 dBm**, **Sedang -65…-75 dBm**, **Lemah < -75 dBm**), pencarian AP, dan daftar 3 kolom.

### Pelacak Klien & Roaming
- Pencarian klien real-time lintas seluruh armada AP berdasarkan MAC, IP, vendor OUI, atau nama perangkat kustom (`client_hostnames.json`), lengkap dengan pelacakan perpindahan AP (*roaming*).

### Wireless, RF & Denah
- Kelola SSID & Virtual AP per router: tambah, edit, hapus, enable/disable, kick client, VLAN tagging, dan security profile.
- **Daftar channel real dari router** — dibaca via `/interface/wireless/info/country-info` sehingga dropdown hanya menampilkan frekuensi yang valid untuk regulatory domain perangkat (mis. `country=indonesia` → Ch 149/153/157/161/165 untuk 5 GHz).
- **Scan spektrum RF** dengan skor kualitas per channel, fallback otomatis ke `frequency-monitor`, serta **Deteksi Rogue AP / Evil Twin**.
- **Denah & heatmap interaktif** — penempatan AP per lantai, radius coverage, dan sinkronisasi channel langsung ke hardware dari popover marker.

### Utilitas NOC Lainnya
- Web terminal, ping diagnostik, firewall/NAT viewer, router logs, ARP/network, backup/export konfigurasi, dan **Batch Script** lintas perangkat terpilih.

---

## Stack

| Lapisan | Teknologi |
|---|---|
| Backend | Python 3.14, FastAPI, Uvicorn, `routeros-api`, `scikit-learn`, `numpy`, SQLite |
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

### 4. Verifikasi & Jalankan

```bash
python selfcheck.py
python app.py
# atau: start.bat  (Windows)
```

Buka `http://127.0.0.1:8090`

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
├── app.py                     # FastAPI: seluruh endpoint, RRM/OmniRoute, Fleet Wi-Fi Sync & RouterOS
├── mt_client.py               # Helper koneksi RouterOS API
├── selfcheck.py               # Verifikasi cepat integritas backend & modul
├── requirements.txt
├── .env.example               # template kredensial & profil NOC
├── devices.example.json       # template daftar perangkat
├── floors.example.json        # template denah & penempatan AP
├── templates/index.html       # UI legacy (single-file)
├── uploads/                   # blueprint denah (SVG)
└── frontend/
    └── src/
        ├── api/client.ts      # typed API client
        ├── components/        # FleetView, DeviceCard, FleetWifiSyncModal, WifiDiagnostics, tabs/, map/
        └── types/index.ts
```

### Endpoint Penting

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | Status backend & perangkat default |
| POST | `/api/auth/login` | Login dashboard (kredensial dari `.env`) |
| GET | `/api/fleet` | Status armada, CPU, uptime & jumlah klien Wi-Fi live |
| POST | `/api/fleet/probe` | Paksa probe ulang seluruh armada paralel |
| GET | `/api/fleet/wifi/ssids` | Pindai paralel seluruh SSID aktif lintas armada |
| POST | `/api/fleet/wifi/sync` | Rotasi password, tambah SSID, atau rename SSID massal (+ `dry_run`) |
| GET | `/api/wifi/diagnostics` | Link Quality (`100 - CCQ`) & AP Deployment Density (`device=all` atau per-AP) |
| POST | `/api/ai/chat` | Chatbot AI NOC dengan konteks telemetri live router |
| GET | `/api/ai/diagnose` | Diagnosa otomatis kesehatan & keamanan router |
| GET | `/api/ai/models` | Daftar model LLM tersedia dari OmniRoute |
| POST | `/api/optimize/fleet` | Jalankan AI Optimize / Auto-RRM lintas armada |
| GET | `/api/wireless/interfaces` | Daftar SSID / virtual AP per router |
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
