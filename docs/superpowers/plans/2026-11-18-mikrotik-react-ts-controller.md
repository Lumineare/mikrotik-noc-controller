# Modern React + TypeScript NOC Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti frontend monolithic `templates/index.html` dengan modern React 19 + TypeScript + Vite + Tailwind CSS NOC dashboard yang dioptimalkan untuk memonitor dan mengontrol 82+ perangkat MikroTik RS Anwar Medika secara 100% offline (zero-CDN), dilengkapi Command Palette (`Ctrl+K`), real-time traffic oscilloscope, 8 workspace inspeksi router, dan batch script automation.

**Architecture:** Frontend React/TypeScript dibangun di folder `frontend/` menggunakan Vite, di-bundle ke `frontend/dist/` (zero external CDN, inlined SVG icons), dan di-mount langsung oleh backend FastAPI di port 8090 sebagai static web app. Backend FastAPI tetap menyediakan REST API socket RouterOS port 8728 dan ditambahkan streaming endpoint untuk eksekusi batch script.

**Tech Stack:** React 18/19, TypeScript, Vite, Tailwind CSS, Lucide React (inlined SVG), Python 3.14, FastAPI, RouterOS API (`routeros-api`).

**Spec:** `C:\Users\admin\mikrotik-controller\docs\superpowers\specs\2026-11-18-mikrotik-controller-react-ts-ui-design.md`

## Global Constraints
- Harus 100% offline (zero CDN eksternal), semua asset, icon, dan font dibundel lokal ke dalam `dist/`.
- Tidak boleh memutus atau merusak data 82 router yang sudah ada di `devices.json`.
- Port server tetap 8090, melayani UI dan API di satu port yang sama.
- Komunikasi ke router tetap menggunakan Python RouterOS API native socket port 8728.
- Default username `admin` dan password `Mikrotik@rsam.33` tetap terpasang otomatis di form.

## Review Focus
- Fleet grid rendering 82+ perangkat tidak boleh membuat browser lag atau freeze.
- Polling throughput hanya aktif untuk router yang sedang dibuka (bukan 82 router sekaligus).
- Command Palette (`Ctrl+K`) harus responsif instan dengan fuzzy matching nama, IP, dan grup.
- Form penambahan router harus tetap mengizinkan field nama kosong agar auto-identity dari RouterOS berfungsi.
- Operasi batch script tidak boleh menggantung jika salah satu router offline (timeout per device terisolasi).

---

### Task 1: Scaffolding Vite + React + TypeScript + Tailwind CSS Project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/index.css`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `frontend/dist/` bundle via `npm run build`

- [ ] **Step 1: Inisialisasi package.json dan pasang dependensi**
  Pasang `react`, `react-dom`, `lucide-react`, serta devDependencies `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `tailwindcss`, `postcss`, `autoprefixer`.
- [ ] **Step 2: Konfigurasi Tailwind CSS dan Vite**
  Atur `tailwind.config.js` dengan palet Dark NOC (`bg-base: #05070a`, `bg-surface: #0a0f18`, `bg-card: #0e1626`, `border-dark: #1e293b`, `accent-cyan: #06b6d4`, dll.). Atur `vite.config.ts` dengan base `./` agar kompatibel static path.
- [ ] **Step 3: Uji build verifikasi awal**
  Jalankan `cd frontend && npm run build` dan pastikan menghasilkan `frontend/dist/index.html` tanpa error.

---

### Task 2: Domain Types & API Client Layer

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/api/client.ts`

**Interfaces:**
- Produces:
  - Interfaces: `Device`, `FleetDevice`, `DashboardData`, `SystemInfo`, `WirelessClient`, `InterfaceItem`, `ArpItem`, `FirewallRule`, `PingResult`, `LogItem`, `BatchResult`.
  - API functions: `api.getDevices()`, `api.getFleet()`, `api.getDashboard(deviceId)`, `api.testDevice(req)`, `api.createDevice(data)`, `api.updateDevice(id, data)`, `api.deleteDevice(id)`, `api.ping(deviceId, host, count)`, `api.executeBatch(payload, onProgress)`.

- [ ] **Step 1: Tulis definisi TypeScript interfaces di `src/types/index.ts`**
  Model data lengkap mencakup router spec, fleet health, wireless clients (MAC, signal, SSID), interfaces (bytes RX/TX), firewall rules, arp table, dan hardware ping latency.
- [ ] **Step 2: Implementasi API client wrapper di `src/api/client.ts`**
  Fetch wrapper typed dengan error handling dan fallback untuk lingkungan LAN.
- [ ] **Step 3: Verifikasi tipe dengan `npx tsc --noEmit`**
  Pastikan tidak ada kesalahan kompilasi tipe data.

---

### Task 3: Header, Topbar Fleet KPI & Command Palette (`Ctrl+K`)

**Files:**
- Create: `frontend/src/components/Header.tsx`
- Create: `frontend/src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `Device`, `FleetDevice`, `api.getDevices`
- Produces: Top navigation bar, fleet summary counts, device selector dropdown, quick search palette.

- [ ] **Step 1: Implementasi `Header.tsx`**
  Branding RSAM NOC Gateway, fleet badge KPI (Total 82, Online, Offline, Avg CPU), Device switcher select, polling interval selector (1s, 2s, 5s, Pause), tombol shortcut `Ctrl+K`, dan tombol `+ Tambah Router`.
- [ ] **Step 2: Implementasi `CommandPalette.tsx`**
  Modal fuzzy search dengan listener keyboard shortcut `Ctrl+K` atau `/`, navigasi panah atas/bawah, filter instan berdasarkan nama router, IP, dan grup lokasi (Melati, Sakura, Poli, dll.), serta tombol Escape untuk menutup.
- [ ] **Step 3: Verifikasi interaksi komponen**
  Uji render dan pastikan event listener keyboard berfungsi mulus.

---

### Task 4: Fleet Matrix View & Multi-Select Filter

**Files:**
- Create: `frontend/src/components/FleetView.tsx`
- Create: `frontend/src/components/DeviceCard.tsx`

**Interfaces:**
- Consumes: `FleetDevice[]`, `activeDeviceId`, callbacks: `onSelectDevice`, `onEditDevice`, `onDeleteDevice`, `onOpenBatch`
- Produces: Tampilan armada router responsif dengan filter grup dan multi-selection.

- [ ] **Step 1: Implementasi `DeviceCard.tsx`**
  Kartu status individual untuk router: badge status online/offline, nama identity, IP host, model board, versi RouterOS, bar CPU load dinamis (hijau/kuning/merah), uptime, checkbox seleksi, dan tombol "Buka Dashboard" & "Tes API".
- [ ] **Step 2: Implementasi `FleetView.tsx`**
  Toolbar pencarian cepat, pills filter kategori lokasi (Semua, Melati, Sakura, HRD, Poli, dll.), filter status (Semua, Online, High CPU, Offline), tombol "Pilih Semua", dan floating action bar saat 1+ router dipilih untuk memicu Batch Action.
- [ ] **Step 3: Verifikasi performa render 82 router**
  Pastikan grid responsif dan tidak ada re-render berlebihan saat mengetik di kolom pencarian.

---

### Task 5: Real-Time Oscilloscope Throughput Canvas

**Files:**
- Create: `frontend/src/components/Oscilloscope.tsx`

**Interfaces:**
- Consumes: `rxRate: number`, `txRate: number`, `history: { rx: number, tx: number }[]`
- Produces: Dual glowing neon waveform canvas dengan deteksi peak rate dan format otomatis (Kbps / Mbps / Gbps).

- [ ] **Step 1: Implementasi canvas renderer di `Oscilloscope.tsx`**
  Rendering loop 60fps dengan grid background dark NOC, garis glowing Cyan (RX) dan Violet (TX), bayangan gradien transparan di bawah garis, dan indikator teks peak throughput.
- [ ] **Step 2: Verifikasi autoscale dan format bandwidth**
  Uji interpolasi data saat traffic naik dari ratusan Kbps ke puluhan Mbps tanpa visual glitching.

---

### Task 6: Workspace Detail Router & 8 Tab Monitor

**Files:**
- Create: `frontend/src/components/DeviceWorkspace.tsx`
- Create: `frontend/src/components/tabs/TabOverview.tsx`
- Create: `frontend/src/components/tabs/TabWireless.tsx`
- Create: `frontend/src/components/tabs/TabInterfaces.tsx`
- Create: `frontend/src/components/tabs/TabNetworkArp.tsx`
- Create: `frontend/src/components/tabs/TabFirewall.tsx`
- Create: `frontend/src/components/tabs/TabServices.tsx`
- Create: `frontend/src/components/tabs/TabPing.tsx`
- Create: `frontend/src/components/tabs/TabLogs.tsx`

**Interfaces:**
- Consumes: `DashboardData`, `api.ping`
- Produces: Panel inspeksi mendalam untuk perangkat MikroTik yang sedang aktif.

- [ ] **Step 1: Implementasi `DeviceWorkspace.tsx` & KPI Strip**
  Sub-header perangkat aktif, tombol kembali ke Fleet, KPI card (CPU load, Free RAM, Free Disk, Uptime), banner Oscilloscope, dan tab bar switcher.
- [ ] **Step 2: Implementasi 8 tab monitor**
  - `TabOverview`: Ringkasan resource, board, firmware, reboot trigger.
  - `TabWireless`: Tabel client terkoneksi dengan segmented visual signal quality bar (>-65dBm hijau, -65 s/d -75dBm kuning, <-75dBm merah), MAC, dan RX/TX rate.
  - `TabInterfaces`: Tabel port fisik & virtual, status link, MTU, rate RX/TX counter.
  - `TabNetworkArp`: Tabel mapping ARP IP-MAC dan DNS cache.
  - `TabFirewall`: Filter rules & NAT rules dengan badge counter hit.
  - `TabServices`: Daftar service port RouterOS dan user accounts.
  - `TabPing`: Tool ping hardware interaktif dengan tombol quick preset (Gateway, Cloudflare, Google) dan metrik latensi min/avg/max/mdev.
  - `TabLogs`: Feed log real-time dengan filter search dan pewarnaan berdasarkan topik.
- [ ] **Step 3: Uji kestabilan tab**
  Pastikan input form di `TabPing` tidak ter-reset saat background polling data berjalan.

---

### Task 7: Modal Tambah / Edit Router dengan Uji Koneksi Live

**Files:**
- Create: `frontend/src/components/DeviceModal.tsx`

**Interfaces:**
- Consumes: `editDevice?: Device`, `onSave: (device: DeviceCreate) => Promise<void>`, `onClose: () => void`
- Produces: Dialog modal input perangkat baru dengan uji socket port 8728 live dan pre-filled default `admin` / `Mikrotik@rsam.33`.

- [ ] **Step 1: Implementasi form input di `DeviceModal.tsx`**
  Field IP Host, Port (8728), Username (default `admin`), Password (default `Mikrotik@rsam.33`), Grup/Lokasi, checkbox Jadikan Default, dan Field Nama (opsional dengan placeholder auto-identity).
- [ ] **Step 2: Tombol "Uji Koneksi" instan**
  Panggil `/api/devices/test`, tampilkan identitas router asli, versi ROS, model board, dan CPU load secara real-time. Jika field nama kosong, otomatis isi dengan identitas router yang terdeteksi.
- [ ] **Step 3: Verifikasi penyimpanan**
  Pastikan device baru tersimpan ke backend dan dropdown/armada langsung terupdate tanpa reload halaman.

---

### Task 8: Batch Scripting & Automation Backend Endpoint + UI Modal

**Files:**
- Modify: `C:\Users\admin\mikrotik-controller\app.py`
- Create: `frontend/src/components/BatchScriptModal.tsx`

**Interfaces:**
- Produces:
  - Backend: `POST /api/batch/execute` (chunked streaming response progress)
  - Frontend: `BatchScriptModal` untuk eksekusi script serentak ke router yang dipilih.

- [ ] **Step 1: Implementasi endpoint batch di `app.py`**
  Tambahkan endpoint `POST /api/batch/execute` yang mengeksekusi script secara paralel menggunakan `ThreadPoolExecutor` dan mengembalikan streaming NDJSON event per router (`device_id`, `name`, `status`, `output`, `error`).
- [ ] **Step 2: Implementasi `BatchScriptModal.tsx` di frontend**
  Daftar target router yang dipilih, tab preset script (NTP, DNS, Ping sweep, Password update, Custom Script), editor script, tombol eksekusi dengan konfirmasi keamanan, dan tabel progress live per router (Pending -> Running -> Success/Failed).
- [ ] **Step 3: Uji eksekusi batch terisolasi**
  Pastikan jika 1 router timeout, router lain tetap selesai tanpa blocking.

---

### Task 9: Build Frontend & Integrasi Static Mount ke FastAPI

**Files:**
- Modify: `C:\Users\admin\mikrotik-controller\app.py`
- Command: `cd frontend && npm run build`

**Interfaces:**
- Produces: Production build di `frontend/dist/` yang disajikan di `http://127.0.0.1:8090/`.

- [ ] **Step 1: Jalankan production build frontend**
  Jalankan `npm run build` di folder `frontend/`, verifikasi folder `frontend/dist/` terbentuk lengkap dengan asset minified dan zero CDN calls.
- [ ] **Step 2: Mount static files di `app.py`**
  Pastikan FastAPI menyajikan `frontend/dist/` untuk root `/` dan mempertahankan endpoint `/api/*`.
- [ ] **Step 3: Restart FastAPI server port 8090**
  Restart background process server dan verifikasi health check `curl http://127.0.0.1:8090/health`.
- [ ] **Step 4: End-to-end Browser Verification**
  Buka `http://127.0.0.1:8090` lewat `browser_exec`, uji navigasi 82 router, Command Palette `Ctrl+K`, real-time bandwidth oscilloscope, inspeksi tab wireless, dan hardware ping.
