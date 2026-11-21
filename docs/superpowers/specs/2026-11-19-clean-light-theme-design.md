# Enterprise Clean Light Theme Specification

## Context & Intent
Sistem controller armada 82 MikroTik RS Anwar Medika sebelumnya menggunakan tema hitam pekat (`#05070a`) dengan aksen neon jenuh (cyan, violet, merah). Pengguna melaporkan bahwa kombinasi tersebut tidak nyaman dan melelahkan mata (*eye strain*).
Sesuai arahan teknisi NOC (Opsi 1 / Enterprise Clean Light), antarmuka akan dimodernisasi ke gaya **Cisco Meraki / Cloudflare / UniFi**: sejuk, bersih, berbasis palet putih & slate lembut dengan tipografi berkontras nyaman untuk operasional rumah sakit.

## Goals & Anti-Goals
- **Goals**:
  - Mengubah warna canvas dasar dari hitam pekat ke *Cool Slate Soft* (`#f8fafc` / `slate-50`).
  - Mengubah kontainer, card, dan panel menjadi putih bersih (`#ffffff`) dengan border abu-abu halus (`border-slate-200` / `#e2e8f0`).
  - Menghilangkan kontras ekstrem neon: mengganti neon cyan/violet dengan *Royal Cobalt Blue* (`#2563eb`), *Sky Blue* (`#0284c7`), dan *Forest Emerald* (`#059669`).
  - Memastikan seluruh teks, badge status, tabel router, formulir, dan modal konfirmasi memiliki keterbacaan tinggi (*high readability*) tanpa silau.
  - Mempertahankan font lokal (Inter & JetBrains Mono) dan zero-CDN offline requirement.
- **Anti-Goals**:
  - Jangan merusak fungsionalitas socket port 8728, sesi auth, atau integrasi OmniRoute AI.
  - Jangan menggunakan warna latar belakang putih mentah 100% tanpa batas antar-kontainer (wajib ada pemisah grid yang rapi).

## Visual Tokens & Color Mapping
- **Canvas / Body**: `#f8fafc` (`slate-50`)
- **Card / Surface**: `#ffffff` (`white`)
- **Card Hover / Accent Background**: `#f1f5f9` (`slate-100`)
- **Border Default**: `#e2e8f0` (`slate-200`)
- **Border Active / Focused**: `#cbd5e1` (`slate-300`)
- **Text Primary**: `#0f172a` (`slate-900`)
- **Text Secondary / Muted**: `#475569` (`slate-600`)
- **Text Code / Telemetry**: `#334155` (`slate-700`)
- **Primary Accent**: `#2563eb` (`blue-600`) / `#1d4ed8` (`blue-700`)
- **Status Indicators**:
  - Online: `bg-emerald-50 text-emerald-700 border-emerald-200`
  - High Load / Warning: `bg-amber-50 text-amber-700 border-amber-200`
  - Offline / Error: `bg-rose-50 text-rose-700 border-rose-200`
