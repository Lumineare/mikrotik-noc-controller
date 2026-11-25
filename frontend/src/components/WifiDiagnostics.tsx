import React, { useEffect, useState } from 'react';
import { Activity, SignalHigh, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

type Bucket = { lo: number; hi: number | null; count: number; pct: number };

interface Diag {
  ok: boolean;
  error?: string;
  generated_at: string;
  window_h: number;
  quality: {
    buckets: Bucket[];
    samples: number;
    avg_pct: number;
    measured_retry: boolean;
    worst: { mac: string; band: string; pct: number; samples: number }[];
    live: { mac: string; interface: string; ccq_pct: number | null }[];
    bands?: Record<string, { samples: number; buckets: Bucket[]; avg_pct: number }>;
    source: string;
  };
  signal: {
    buckets: Bucket[];
    live: { mac: string; interface: string; rssi: number | null; rssi_avg?: number | null; samples?: number }[];
    median_dbm: number | null;
    weak_pct: number;
    clients: number;
    source: string;
  };
  density: { need_improvement: boolean; title: string; detail: string };
  aps: { id: string; name: string; host: string; samples: number; clients: number; median_dbm: number | null; weak_pct: number | null }[];
}

const label = (b: Bucket, unit = '%') =>
  b.hi === null ? `${b.lo}${unit}+` : `${b.lo}–${b.hi}${unit}`;

const barColor = (b: Bucket) => {
  if (b.lo >= 20) return 'bg-rose-500';
  if (b.lo >= 10) return 'bg-amber-400';
  return 'bg-emerald-500';
};

export const WifiDiagnostics: React.FC<{ deviceId?: string; deviceName?: string }> = ({ deviceId, deviceName }) => {
  const [d, setD] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  const [band, setBand] = useState<'all' | '2g' | '5g'>('all');

  const load = async () => {
    setBusy(true);
    try {
      const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : '';
      setD(await api.getWifiDiagnostics(q));
    } catch {
      setD(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  if (!d || !d.ok) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm text-xs font-mono text-slate-500">
        {d?.error ? `Diagnostik WiFi gagal: ${d.error}` : 'Memuat diagnostik WiFi…'}
      </div>
    );
  }

  const series = band === 'all' ? null : d.quality.bands?.[band];
  const bars = series ? series.buckets : d.quality.buckets;
  const samples = series ? series.samples : d.quality.samples;
  const maxPct = Math.max(...bars.map((b) => b.pct), 1);
  const pos = (dbm: number) => Math.max(0, Math.min(100, ((dbm + 90) / 60) * 100));
  const points = d.aps
    .map((a) => (a.median_dbm == null ? null : { mac: a.id, label: a.name, rssi: Math.round(a.median_dbm), clients: a.clients }))
    .filter((x): x is { mac: string; label: string; rssi: number; clients: number } => x !== null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
      {/* TX retries */}
      <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>Link Quality · 100 − CCQ</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500 normal-case font-normal">
              estimasi
            </span>
            {deviceName && <span className="text-[10px] normal-case font-normal text-slate-400">· {deviceName}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {(['2g', '5g', 'all'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setBand(k)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                    band === k ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {k === 'all' ? 'Semua' : k === '2g' ? '2.4 GHz' : '5 GHz'}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-mono text-slate-400">{samples} sampel / {d.window_h}j</span>
            <button onClick={load} className="p-1 rounded-md hover:bg-slate-100" title="Muat ulang">
              <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {bars.map((b) => (
            <div key={String(b.lo)} className="flex items-center gap-2">
              <span className="w-16 text-[10px] font-mono text-slate-500 text-right">{label(b)}</span>
              <div className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden">
                <div
                  className={`h-full ${barColor(b)} transition-all`}
                  style={{ width: `${Math.round((b.pct / maxPct) * 100)}%` }}
                />
              </div>
              <span className="w-10 text-[10px] font-mono text-slate-600 text-right">{b.pct}%</span>
            </div>
          ))}
        </div>
        {d.quality.worst.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <div className="text-[10px] font-mono text-slate-400 mb-1">Klien paling tertekan (rata-rata 24j)</div>
            <div className="flex flex-wrap gap-1.5">
              {d.quality.worst.map((w) => (
                <span
                  key={w.mac}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    w.pct >= 20 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                  title={`${w.samples} sampel`}
                >
                  {w.mac} · {w.band} · {w.pct}%
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] font-mono text-slate-400 leading-relaxed">
          Angka = estimasi tekanan link, bukan jumlah retry hardware (driver legacy cAP ac tidak melaporkan
          tx-frames-timed-out). Rata-rata {series ? series.avg_pct : d.quality.avg_pct}%.
          <br />
          {d.quality.source}
        </p>
      </div>

      {/* AP Deployment Density */}
      <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold">
            <SignalHigh className="w-4 h-4 text-blue-600" />
            <span>AP Deployment Density</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            median {d.signal.median_dbm ?? '-'} dBm / {d.window_h}j · {d.signal.clients} klien live
          </span>
        </div>
        <p className="text-[10px] text-slate-500 mb-3">
          Tiap lingkaran = satu <b>AP terdaftar</b>. Posisi = rata-rata sinyal klien yang dilayaninya
          (makin ke kanan, cakupan makin baik). Hijau ≥ −65 dBm, kuning −65…−75, merah &lt; −75 dBm.
        </p>

        <div className="relative h-56 mx-4">
          {/* zona kekuatan sinyal */}
          <div className="absolute inset-x-0 top-0 bottom-8 rounded-lg overflow-hidden bg-slate-50">
            <div className="absolute inset-y-0 left-0 bg-rose-50" style={{ width: `${pos(-75)}%` }} />
            <div className="absolute inset-y-0 bg-amber-50" style={{ left: `${pos(-75)}%`, width: `${pos(-65) - pos(-75)}%` }} />
            <div className="absolute inset-y-0 right-0 bg-emerald-50" style={{ left: `${pos(-65)}%` }} />
            {[-90, -80, -70, -60, -50, -40, -30].map((t) => (
              <div key={t} className="absolute inset-y-0 border-l border-dashed border-slate-200" style={{ left: `${pos(t)}%` }} />
            ))}
          </div>

          {/* titik klien */}
          {points.map((pt, i) => (
            <div
              key={pt.mac + i}
              className="absolute -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${pos(pt.rssi)}%`, top: 10 + (i % 4) * 46 }}
              title={`${pt.mac} · ${pt.rssi} dBm`}
            >
              <span className="text-[9px] font-mono text-slate-600 whitespace-nowrap">{pt.rssi} dBm</span>
              <span
                className={`w-4 h-4 rounded-full border-2 ring-2 ring-white shadow-sm ${
                  pt.rssi >= -65
                    ? 'bg-emerald-500 border-emerald-600'
                    : pt.rssi >= -75
                    ? 'bg-amber-400 border-amber-500'
                    : 'bg-rose-500 border-rose-600'
                }`}
              />
              <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">{pt.label}</span>
              <span className="text-[8px] font-mono text-slate-400 whitespace-nowrap">{pt.clients} klien</span>
            </div>
          ))}

          {points.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono text-slate-400">
              belum ada AP terukur (tunggu sampel RF)
            </div>
          )}

          {/* sumbu dBm */}
          <div className="absolute inset-x-0 bottom-0 h-6 border-t border-slate-300">
            {[-90, -80, -70, -60, -50, -40, -30].map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-[9px] font-mono text-slate-500"
                style={{ left: `${pos(t)}%`, top: 4 }}
              >
                {t}
              </span>
            ))}
            <span className="absolute right-0 top-4 text-[9px] font-mono text-slate-400">dBm</span>
          </div>
        </div>

        <div
          className={`mt-3 rounded-xl border p-3 text-xs font-mono ${
            d.density.need_improvement
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            {d.density.need_improvement ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            AP Deployment Density {d.density.need_improvement ? 'May Need Improvement' : 'OK'}
          </div>
          <div className="text-[10px] leading-relaxed mt-0.5">
            {d.density.need_improvement
              ? 'Ada klien di area sinyal lemah — pertimbangkan tambah/geser AP atau turunkan lebar channel.'
              : 'Tidak ada klien di area lemah — sebaran AP sudah memadai.'}{' '}
            {d.density.detail}
          </div>
        </div>
        {d.aps.some((a) => a.median_dbm == null) && (
          <div className="mt-2 text-[10px] font-mono text-slate-400">
            tanpa data RF: {d.aps.filter((a) => a.median_dbm == null).map((a) => a.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};
