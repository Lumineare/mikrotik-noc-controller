import React, { useEffect, useMemo, useState } from 'react';
import { Activity, SignalHigh, RefreshCw, AlertTriangle, CheckCircle2, Search, ChevronDown } from 'lucide-react';
import { api } from '../api/client';
import capAcImg from '../assets/mikrotik-cap-ac.png';

type Bucket = { lo: number; hi: number | null; count: number; pct: number };

interface ApCoverage {
  id: string;
  name: string;
  host: string;
  samples: number;
  clients: number;
  median_dbm: number | null;
  weak_pct: number | null;
}

interface Diag {
  ok: boolean;
  error?: string;
  device_id?: string;
  scope?: 'fleet' | 'device';
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
  aps: ApCoverage[];
}

const label = (b: Bucket, unit = '%') =>
  b.hi === null ? `${b.lo}${unit}+` : `${b.lo}-${b.hi}${unit}`;

const barColor = (b: Bucket) => {
  if (b.lo >= 20) return 'bg-rose-500';
  if (b.lo >= 10) return 'bg-amber-400';
  return 'bg-emerald-500';
};

export const WifiDiagnostics: React.FC<{
  deviceId?: string;
  deviceName?: string;
  fleet?: boolean;
}> = ({ deviceId, deviceName, fleet = false }) => {
  const [d, setD] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  const [band, setBand] = useState<'all' | '2g' | '5g'>('all');
  const [selectedDevice, setSelectedDevice] = useState<string>(fleet ? 'all' : deviceId || 'all');

  // AP Deployment Density readability controls
  const [zoneFilter, setZoneFilter] = useState<'all' | 'weak' | 'mid' | 'good'>('all');
  const [apSearch, setApSearch] = useState('');
  const [hoveredAp, setHoveredAp] = useState<ApCoverage | null>(null);
  const [showNoData, setShowNoData] = useState(false);

  useEffect(() => {
    setSelectedDevice(fleet ? 'all' : deviceId || 'all');
  }, [deviceId, fleet]);

  const load = async (target?: string) => {
    const dev = target ?? selectedDevice;
    setBusy(true);
    try {
      const q = dev && dev !== 'all' ? `?device=${encodeURIComponent(dev)}` : '?device=all';
      setD(await api.getWifiDiagnostics(q));
    } catch {
      setD(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load(selectedDevice);
    const t = setInterval(() => load(selectedDevice), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  const measuredAps = useMemo(() => {
    if (!d?.aps) return [];
    return d.aps
      .filter((a) => a.median_dbm != null)
      .sort((a, b) => (a.median_dbm ?? 0) - (b.median_dbm ?? 0)); // terlemah di atas
  }, [d?.aps]);

  const unmeasuredAps = useMemo(() => {
    if (!d?.aps) return [];
    return d.aps.filter((a) => a.median_dbm == null);
  }, [d?.aps]);

  const zoneCounts = useMemo(() => {
    let weak = 0;
    let mid = 0;
    let good = 0;
    for (const a of measuredAps) {
      const r = a.median_dbm!;
      if (r < -75) weak += 1;
      else if (r < -65) mid += 1;
      else good += 1;
    }
    return { all: measuredAps.length, weak, mid, good };
  }, [measuredAps]);

  const filteredAps = useMemo(() => {
    const q = apSearch.trim().toLowerCase();
    return measuredAps.filter((a) => {
      const r = a.median_dbm!;
      if (zoneFilter === 'weak' && !(r < -75)) return false;
      if (zoneFilter === 'mid' && !(r >= -75 && r < -65)) return false;
      if (zoneFilter === 'good' && !(r >= -65)) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.host.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [measuredAps, zoneFilter, apSearch]);

  if (!d || !d.ok) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm text-xs font-mono text-slate-500">
        {d?.error ? `Diagnostik WiFi gagal: ${d.error}` : 'Memuat diagnostik WiFi...'}
      </div>
    );
  }

  const series = band === 'all' ? null : d.quality.bands?.[band];
  const bars = series ? series.buckets : d.quality.buckets;
  const samples = series ? series.samples : d.quality.samples;
  const avgPct = series ? series.avg_pct : d.quality.avg_pct;
  const pos = (dbm: number) => Math.max(2, Math.min(98, ((dbm + 90) / 60) * 100));

  const healthyPct = Math.round(
    bars.filter((b) => b.lo < 10).reduce((acc, b) => acc + b.pct, 0) * 10
  ) / 10;
  const moderatePct = Math.round(
    bars.filter((b) => b.lo >= 10 && b.lo < 20).reduce((acc, b) => acc + b.pct, 0) * 10
  ) / 10;
  const stressedPct = Math.round(
    bars.filter((b) => b.lo >= 20).reduce((acc, b) => acc + b.pct, 0) * 10
  ) / 10;

  const segColor = (b: Bucket) => {
    if (b.lo < 5) return 'bg-emerald-500';
    if (b.lo < 10) return 'bg-emerald-400';
    if (b.lo < 15) return 'bg-amber-400';
    if (b.lo < 20) return 'bg-amber-500';
    if (b.lo < 35) return 'bg-rose-400';
    return 'bg-rose-600';
  };
  const segText = (b: Bucket) => {
    if (b.lo < 10) return 'text-emerald-700';
    if (b.lo < 20) return 'text-amber-700';
    return 'text-rose-700';
  };

  const activeScopeLabel =
    selectedDevice === 'all'
      ? `Semua AP (${d.aps.length})`
      : d.aps.find((a) => a.id === selectedDevice)?.name || deviceName || selectedDevice;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
      {/* Link Quality */}
      <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold flex-wrap">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>Link Quality · 100 − CCQ</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 normal-case font-normal">
              estimasi
            </span>
            {fleet ? (
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                aria-label="Pilih cakupan AP untuk Link Quality"
                className="normal-case font-mono text-[11px] font-semibold bg-slate-50 border border-slate-300 rounded-lg px-2 py-0.5 text-slate-800 max-w-[240px] cursor-pointer"
              >
                <option value="all">Semua AP ({d.aps.length} AP)</option>
                {d.aps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[10px] normal-case font-normal text-slate-500">· {activeScopeLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {(['2g', '5g', 'all'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBand(k)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors cursor-pointer ${
                    band === k ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {k === 'all' ? 'Semua' : k === '2g' ? '2.4 GHz' : '5 GHz'}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              {samples} sampel / {d.window_h}j
            </span>
            <button
              type="button"
              onClick={() => load()}
              className="p-1 rounded-md hover:bg-slate-100 cursor-pointer"
              title="Muat ulang"
              aria-label="Muat ulang diagnostik WiFi"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {/* Honest proportional distribution strip + 3-zone summary */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] font-mono">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="text-slate-500">Stabil (0–10%)</span>
                <strong className="text-emerald-700 tabular-nums">{healthyPct}%</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
                <span className="text-slate-500">Sedang (10–20%)</span>
                <strong className="text-amber-700 tabular-nums">{moderatePct}%</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
                <span className="text-slate-500">Tertekan (&gt;20%)</span>
                <strong className="text-rose-700 tabular-nums">{stressedPct}%</strong>
              </span>
            </div>
            <span className="text-slate-600 tabular-nums">
              Rata-rata:{' '}
              <strong className={avgPct >= 20 ? 'text-rose-700' : avgPct >= 10 ? 'text-amber-700' : 'text-emerald-700'}>
                {avgPct}%
              </strong>
            </span>
          </div>

          {/* 100% proportional stacked bar */}
          <div
            className="w-full h-3 rounded-full bg-slate-100 border border-slate-200/80 overflow-hidden flex gap-[1px] p-[1px]"
            role="img"
            aria-label={`Distribusi tekanan link: Stabil ${healthyPct}%, Sedang ${moderatePct}%, Tertekan ${stressedPct}%`}
          >
            {bars.map((b) =>
              b.pct > 0 ? (
                <div
                  key={String(b.lo)}
                  className={`h-full first:rounded-l-full last:rounded-r-full transition-all duration-300 ${segColor(b)}`}
                  style={{ width: `${b.pct}%` }}
                  title={`${label(b)}: ${b.pct}% (${b.count.toLocaleString()} sampel)`}
                />
              ) : null
            )}
          </div>

          {/* Compact 6-bucket telemetry breakdown (real scale micro-bars) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {bars.map((b) => (
              <div
                key={String(b.lo)}
                className="bg-slate-50/80 border border-slate-200/80 rounded-xl px-2.5 py-2 flex flex-col justify-between gap-1.5"
                title={`${b.count.toLocaleString()} sampel di rentang ${label(b)}`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                  <span className="inline-flex items-center gap-1.5 text-slate-600 font-semibold">
                    <span className={`w-1.5 h-1.5 rounded-full ${segColor(b)}`} aria-hidden="true" />
                    {label(b)}
                  </span>
                  <span className="text-slate-400 tabular-nums">{b.count.toLocaleString()}</span>
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`text-sm font-bold font-mono tabular-nums ${segText(b)}`}>{b.pct}%</span>
                </div>
                <div className="w-full h-1 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${segColor(b)}`}
                    style={{ width: `${Math.min(100, b.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {d.quality.worst.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <div className="text-[10px] font-mono text-slate-500 mb-1">
              Klien paling tertekan ({activeScopeLabel}, rata-rata {d.window_h}j)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.quality.worst.map((w) => (
                <span
                  key={w.mac + w.band}
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
        <p className="mt-2 text-[10px] font-mono text-slate-500 leading-relaxed">
          Tekanan link = 100 - TX CCQ (makin kecil makin stabil; &gt;20% menandakan interferensi/retransmisi tinggi).
          Rata-rata {series ? series.avg_pct : d.quality.avg_pct}%.
        </p>
      </div>

      {/* AP Deployment Density */}
      <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold">
            <SignalHigh className="w-4 h-4 text-blue-600" />
            <span>AP Deployment Density</span>
            <span className="text-[10px] normal-case font-normal text-slate-500">
              ({measuredAps.length} AP terukur)
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            median {d.signal.median_dbm ?? '-'} dBm / {d.window_h}j · {d.signal.clients} klien
          </span>
        </div>

        <p className="text-[11px] text-slate-500">
          Sebaran rata-rata sinyal klien tiap AP (makin ke kanan makin kuat). Arahkan kursor ke ikon AP untuk detail, atau lihat daftar rapi di bawah.
        </p>

        {/* Compact, uncluttered round ceiling-AP distribution strip */}
        <div className="relative h-32 mx-2">
          <div className="absolute inset-x-0 top-0 bottom-6 rounded-lg overflow-hidden bg-slate-50 border border-slate-200">
            <div className="absolute inset-y-0 left-0 bg-rose-50/90" style={{ width: `${pos(-75)}%` }} />
            <div
              className="absolute inset-y-0 bg-amber-50/90"
              style={{ left: `${pos(-75)}%`, width: `${pos(-65) - pos(-75)}%` }}
            />
            <div className="absolute inset-y-0 right-0 bg-emerald-50/90" style={{ left: `${pos(-65)}%` }} />
            {[-90, -80, -70, -60, -50, -40, -30].map((t) => (
              <div
                key={t}
                className="absolute inset-y-0 border-l border-dashed border-slate-200"
                style={{ left: `${pos(t)}%` }}
              />
            ))}
          </div>

          {measuredAps.map((ap, i) => {
            const rssi = Math.round(ap.median_dbm!);
            const isHovered = hoveredAp?.id === ap.id;
            const row = i % 3;
            const ringCls =
              rssi >= -65
                ? 'ring-emerald-500'
                : rssi >= -75
                ? 'ring-amber-400'
                : 'ring-rose-500';
            return (
              <button
                key={ap.id}
                type="button"
                onMouseEnter={() => setHoveredAp(ap)}
                onMouseLeave={() => setHoveredAp((cur) => (cur?.id === ap.id ? null : cur))}
                onClick={() => {
                  setHoveredAp(ap);
                  setApSearch(ap.name);
                  setZoneFilter('all');
                }}
                style={{ left: `${pos(rssi)}%`, top: 8 + row * 29 }}
                title={`${ap.name} · ${rssi} dBm · ${ap.clients} klien`}
                aria-label={`${ap.name}: ${rssi} dBm, ${ap.clients} klien`}
                className={`absolute -translate-x-1/2 w-6 h-6 rounded-full bg-white p-[1px] ring-2 transition-transform cursor-pointer shadow-sm ${
                  isHovered ? 'scale-125 z-20 ring-blue-600 shadow-md' : `hover:scale-125 z-10 ${ringCls}`
                }`}
              >
                <img
                  src={capAcImg}
                  alt=""
                  draggable={false}
                  className="w-full h-full object-contain rounded-full pointer-events-none select-none"
                />
              </button>
            );
          })}

          {measuredAps.length === 0 && (
            <div className="absolute inset-0 bottom-6 flex items-center justify-center text-[11px] font-mono text-slate-400">
              belum ada AP terukur (tunggu sampel RF)
            </div>
          )}

          {/* dBm axis */}
          <div className="absolute inset-x-0 bottom-0 h-5">
            {[-90, -80, -70, -60, -50, -40, -30].map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-[9px] font-mono text-slate-500 top-1"
                style={{ left: `${pos(t)}%` }}
              >
                {t}
              </span>
            ))}
            <span className="absolute right-0 top-1 text-[9px] font-mono text-slate-400">dBm</span>
          </div>
        </div>

        {/* Fixed-height hover/selected info bar (reserved space prevents layout shift / shaking) */}
        <div
          className={`h-8 px-3 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 transition-colors ${
            hoveredAp
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : 'bg-slate-50 border-slate-200 text-slate-400'
          }`}
        >
          {hoveredAp ? (
            <>
              <span className="font-bold truncate">{hoveredAp.name}</span>
              <span className="shrink-0">
                {Math.round(hoveredAp.median_dbm!)} dBm · {hoveredAp.clients} klien
                {hoveredAp.weak_pct != null ? ` · ${hoveredAp.weak_pct}% lemah` : ''}
              </span>
            </>
          ) : (
            <span className="truncate">Arahkan kursor ke titik atau kartu AP untuk melihat detail sinyal</span>
          )}
        </div>

        {/* Filter & Search Bar for readable AP list */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1 flex-wrap text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setZoneFilter('all')}
              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                zoneFilter === 'all'
                  ? 'bg-slate-800 text-white border-slate-800 font-bold'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Semua ({zoneCounts.all})
            </button>
            <button
              type="button"
              onClick={() => setZoneFilter('weak')}
              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                zoneFilter === 'weak'
                  ? 'bg-rose-600 text-white border-rose-600 font-bold'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              Lemah &lt;-75 ({zoneCounts.weak})
            </button>
            <button
              type="button"
              onClick={() => setZoneFilter('mid')}
              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                zoneFilter === 'mid'
                  ? 'bg-amber-600 text-white border-amber-600 font-bold'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
            >
              Sedang -65..-75 ({zoneCounts.mid})
            </button>
            <button
              type="button"
              onClick={() => setZoneFilter('good')}
              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                zoneFilter === 'good'
                  ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              Baik &ge;-65 ({zoneCounts.good})
            </button>
          </div>

          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={apSearch}
              onChange={(e) => setApSearch(e.target.value)}
              placeholder="Cari nama AP..."
              className="w-full pl-8 pr-2.5 py-1 text-[11px] font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Clean, readable scrollable grid of APs */}
        {filteredAps.length > 0 ? (
          <div className="max-h-64 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pr-1">
            {filteredAps.map((ap) => {
              const rssi = Math.round(ap.median_dbm!);
              const isWeak = rssi < -75;
              const isMid = rssi >= -75 && rssi < -65;
              return (
                <div
                  key={ap.id}
                  onMouseEnter={() => setHoveredAp(ap)}
                  onMouseLeave={() => setHoveredAp((cur) => (cur?.id === ap.id ? null : cur))}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-mono transition-colors ${
                    hoveredAp?.id === ap.id
                      ? 'border-blue-400 bg-blue-50/40'
                      : isWeak
                      ? 'border-rose-200 bg-rose-50/30'
                      : isMid
                      ? 'border-amber-200 bg-amber-50/30'
                      : 'border-slate-200 bg-slate-50/40'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        isWeak ? 'bg-rose-500' : isMid ? 'bg-amber-400' : 'bg-emerald-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate" title={ap.name}>
                        {ap.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {ap.clients} klien{ap.weak_pct != null ? ` · ${ap.weak_pct}% lemah` : ''}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`font-bold shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                      isWeak
                        ? 'bg-rose-100 text-rose-700 border-rose-200'
                        : isMid
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    {rssi} dBm
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center text-[11px] font-mono text-slate-400 border border-dashed border-slate-200 rounded-lg">
            Tidak ada AP di filter ini.
          </div>
        )}

        {/* Concise density verdict */}
        <div
          className={`rounded-xl border p-3 text-xs font-mono ${
            d.density.need_improvement
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            {d.density.need_improvement ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            AP Deployment Density {d.density.need_improvement ? 'May Need Improvement' : 'OK'}
          </div>
          <div className="text-[11px] leading-relaxed mt-0.5">
            {d.density.need_improvement
              ? 'Ada AP di area sinyal lemah — pertimbangkan tambah/geser AP atau turunkan lebar channel.'
              : 'Tidak ada AP di area lemah — sebaran AP sudah memadai.'}{' '}
            {d.density.detail}
          </div>
        </div>

        {unmeasuredAps.length > 0 && (
          <div className="text-[10px] font-mono text-slate-500">
            <button
              type="button"
              onClick={() => setShowNoData((v) => !v)}
              className="inline-flex items-center gap-1 hover:text-slate-800 cursor-pointer"
            >
              <span>AP tanpa data RF ({unmeasuredAps.length})</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showNoData ? 'rotate-180' : ''}`} />
            </button>
            {showNoData && (
              <div className="mt-1 text-slate-400 leading-relaxed">
                {unmeasuredAps.map((a) => a.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
