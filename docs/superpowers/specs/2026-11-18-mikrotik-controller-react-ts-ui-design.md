# Design Spec: Modern React + TypeScript NOC Controller for MikroTik Fleet

## 1. Intent & Context
RS Anwar Medika mengoperasikan armada 82+ perangkat MikroTik (access point cAP ac, router distribusi/core) yang tersebar di berbagai unit/ruangan (HRD, Melati, Sakura, ICU, IGD, Poli, Farmasi, dsb).
Mengelola 82 perangkat secara manual via Winbox satu per satu tidak efisien. Web controller berbasis FastAPI di port 8090 telah berhasil menjadi gateway terpusat port 8728. Namun, frontend monolithic `templates/index.html` (~2.400 baris vanilla JS) mulai mencapai batas skalabilitasnya untuk menangani 82 perangkat, filtering kompleks, visualisasi data real-time, dan manajemen batch script.

Pengguna meminta peningkatan UI/UX menggunakan stack modern (**React + TypeScript + Vite + Tailwind CSS**) dengan estetika dark NOC (Datadog/Grafana style) yang tetap **100% offline (zero-CDN)** untuk jaringan intranet rumah sakit.

## 2. Goals & Non-Goals

### Goals
- **Modern Stack:** React 18/19, TypeScript, Vite, Tailwind CSS, Lucide Icons (inlined SVG, zero external CDN).
- **Fleet Scalability (82+ Devices):**
  - Live summary KPI: Total Router (82), Online, Offline, High Load (>70% CPU), Total Traffic.
  - Quick Search & Filter: Filter instan berdasarkan nama, IP, grup lokasi (Melati, Sakura, Poli, dll.), atau status koneksi.
  - Command Palette (`Ctrl+K` / `/`): Modal pencarian cepat untuk berpindah antar 82 router dalam hitungan milidetik.
- **Deep Active Device Inspector:**
  - KPI Gauges: CPU load, Free RAM, Free Disk, Uptime, Hardware specs.
  - Throughput Oscilloscope: Dual glowing neon waveform (Cyan RX, Violet TX) dengan peak detection dan autoscale.
  - 8 Tab Monitor Lengkap:
    1. Ringkasan (Executive system overview)
    2. Wireless (Signal quality bar, MAC, IP, TX/RX bytes, uptime client)
    3. Interface (Port status, running state, MTU, live traffic counters)
    4. Jaringan & ARP (IP-to-MAC table, Dynamic/Complete flags, DNS cache)
    5. Firewall & NAT (Filter rules, NAT chains, packet/byte hit counters)
    6. Service & Akun (Port API, Winbox, SSH, Web status, daftar user & group)
    7. Hardware Ping Tool (Preset targets, sub-millisecond RTT min/avg/max latency analysis)
    8. Router Logs (Real-time system events, color-coded by topic/severity)
- **Batch Scripting & Automation:**
  - Kemampuan push konfigurasi / script RouterOS (misal rotasi password, update DNS, scheduler) ke 1 router terpilih atau seluruh 82 router secara serentak, dengan live progress output.
- **Self-Contained Deployment:**
  - Output build (`frontend/dist/`) langsung di-mount oleh FastAPI sebagai static files, single-port (8090), tanpa dependensi server Node.js terpisah saat produksi.

### Non-Goals
- Tidak mengganti backend FastAPI atau socket port 8728 (`routeros-api`) yang sudah terbukti andal.
- Tidak membutuhkan koneksi internet publik atau CDN eksternal (hospital isolated LAN).

### Anti-Goals
- Tidak boleh menyebabkan downtime berkepanjangan pada endpoint backend.
- Tidak boleh menghapus atau merusak data 82 perangkat yang sudah tersimpan di `devices.json`.

## 3. Architecture & Technical Strategy

### Fleet Polling & Traffic Architecture (Clarified)
- **Fleet Topbar KPI:**
  - Total Devices (82), Online Count, Offline Count, Fleet Avg CPU.
  - Active Router Throughput (RX/TX bps): diambil dari router yang sedang aktif dipilih (atau router default/gateway saat di Fleet View), bukan query serentak 82 router tiap detik agar CPU cAP ac tetap ringan dan hemat socket.
- **Fleet Polling Rate:** `/api/devices/fleet` di-poll setiap 10-15 detik (atau manual refresh), sedangkan router aktif di-poll sesuai selector (1s, 2s, 5s).

### Batch Scripting & Credential Safety Architecture (Clarified)
- **Target Selection:** Multi-select checkbox di Fleet Matrix, shortcut "Pilih Semua dalam Grup [Melati/Sakura/dll.]", dan "Pilih Seluruh Armada (82)".
- **Streaming Protocol:** Endpoint `POST /api/batch/execute` menggunakan streaming Response (NDJSON / SSE chunked) sehingga frontend menerima progress bar per-device secara real-time (`pending` -> `running` -> `ok` / `failed`) tanpa timeout.
- **Credential Rotation Safety:** Jika batch task adalah pergantian password user, backend secara atomik memverifikasi login baru via API sebelum memperbarui `devices.json`, mencegah hilangnya akses ke armada router.
- **Script Engine:** Backend mendukung:
  1. Perintah RouterOS API terstruktur (e.g. `/system/reboot`, `/ip/dns/set`, `/system/ntp/client/set`).
  2. Temporary script inject (`/system/script add` -> `run` -> `remove`) untuk custom ROS commands.

### Frontend (`frontend/`)
- **Framework:** Vite + React + TypeScript
- **Styling:** Tailwind CSS dengan palet khusus Dark NOC:
  - Base: `#05070a` (Deep Night Canvas)
  - Surface: `#0a0f18` (Dark Slate Glass)
  - Card: `#0e1626` (Muted Indigo Border `#1e293b`)
  - Accents: Neon Cyan (`#06b6d4`), Emerald (`#10b981`), Amber (`#f59e0b`), Rose (`#f43f5e`), Violet (`#8b5cf6`)
- **Icons:** `lucide-react` (semua icon ter-bundle lokal sebagai SVG).
- **State Management:** React hooks (`useState`, `useEffect`, `useCallback`, `useMemo`) dengan local caching per device untuk transisi instan tanpa refetch berulang.
- **Chart:** Canvas 2D HTML5 berperforma tinggi (zero heavy chart libraries seperti Chart.js/D3 yang lambat di low-spec terminal).

### Backend Integration (`app.py`)
- FastAPI menambahkan endpoint static mount:
  ```python
  if os.path.exists("frontend/dist"):
      app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
  ```
- Endpoint REST API `/api/*` tetap utuh 100% kompatibel.
- Endpoint baru jika diperlukan: `/api/batch/script` untuk push script RouterOS ke multiple device secara paralel.

## 4. UI/UX Component Hierarchy
```
App
├── Header / Topbar
│   ├── Logo & Brand (RSAM NOC Gateway)
│   ├── Fleet Summary Badges (82 Total | 80 Online | 2 Offline)
│   ├── Quick Device Switcher (Dropdown + Ctrl+K trigger)
│   ├── Polling Speed Selector (1s, 2s, 5s, Pause)
│   └── Action: + Tambah Router
├── CommandPaletteModal (Ctrl+K fast switcher with fuzzy search)
├── AddEditDeviceModal (Host, Port, User, Pass with live auto-identity test)
├── Main Workspace
│   ├── View: Fleet Matrix (Grid view semua 82 router + filter group + batch actions)
│   └── View: Device Detail (Active router inspection)
│       ├── Sub-Header (Identity, IP, ROS version, Board, Uptime, Actions)
│       ├── KPI Strip (CPU Load with alert bar, Memory, Disk, Temperature if any)
│       ├── Real-time Oscilloscope Banner (Dual neon RX/TX wave)
│       ├── Navigation Tabs (Wireless, Ringkasan, Interface, Network/ARP, Firewall, Service, Ping, Log, Script)
│       └── Active Tab Panel Content
```

## 5. Implementation Phases
1. **Scaffold Frontend:** Inisialisasi Vite + React + TypeScript + Tailwind di `frontend/`.
2. **Types & API Layer:** Definisikan TypeScript interfaces untuk Device, DashboardData, System, Wireless, Interface, Arp, Firewall, Ping, Log.
3. **Core Components:**
   - Dark NOC Layout & Header
   - Command Palette (`Ctrl+K`)
   - Fleet Matrix View (dukungan 82+ router dengan search & group pills)
   - Real-time Traffic Oscilloscope Canvas
   - Tab Inspector Components
   - Hardware Ping Tool & Modal Perangkat
4. **Build & FastAPI Mount:** Build frontend ke `frontend/dist/` dan hubungkan ke FastAPI.
5. **Verifikasi:** Uji via browser automation (`browser_exec`), navigasi 82 router, inspeksi data real-time, dan cek visual responsivitas.
