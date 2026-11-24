import React, { useEffect, useState } from 'react';
import { Activity, Wifi, SignalHigh, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

type Bucket = { lo: number; hi: number | null; count: number; pct: number };

interface Diag {
  ok: boolean;
  error?: string;
  generated_at: string;
  window_h: number;
  retries: {
    buckets: Bucket[];
    samples: number;
    avg_pct: number;
    ccq_est: Bucket[];
    ccq_est_used: boolean;
    live: { mac: string; interface: string; retry_pct: number }[];
    source: string;
  };
  connectivity: {
    association: number;
    authentication: number;
    dhcp: number;
    dns: number;
    dns_ms: number | null;
    basis: Record<string, string>;
  };
  signal: {
    buckets: Bucket[];
    live: { mac: string; interface: string; rssi: number | null }[];
    median_dbm: number | null;
    weak_pct: number;
    clients: number;
    source: string;
  };
  density: { need_improvement: boolean; title: string; detail: string };
}

const label = (b: Bucket, unit = '%') =>
  b.hi === null ? `${b.lo}${unit}+` : `${b.lo}–${b.hi}${unit}`;

const rssiLabel = (b: Bucket) => (b.hi === null ? `< ${b.lo}` : b.lo === -50 ? `≥ -50` : `${b.hi} … ${b.lo}`);

const barColor = (b: Bucket) => {
  if (b.lo >= 20) return 'bg-rose-500';
  if (b.lo >= 10) return 'bg-amber-400';
  return 'bg-emerald-500';
};

const stageColor = (v: number) => (v >= 97 ? 'bg-emerald-500' : v >= 90 ? 'bg-amber-400' : 'bg-rose-500');

export const WifiDiagnostics: React.FC<{ deviceId?: string }> = ({ deviceId }) => {
  const [d, setD] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);

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
    const t = setInterval(load, 60000);
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

  const bars = d.retries.ccq_est_used ? d.retries.ccq_est : d.retries.buckets;
  const maxPct = Math.max(...bars.map((b) => b.pct), 1);
  const stages = [
    ['Association', d.connectivity.association],
    ['Authentication', d.connectivity.authentication],
    ['DHCP', d.connectivity.dhcp],
    ['DNS', d.connectivity.dns],
  ] as [string, number][];
  const overall = Math.round(stages.reduce((s, [, v]) => s + v, 0) / stages.length);
  const sigMax = Math.max(...d.signal.buckets.map((b) => b.pct), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
      {/* TX retries */}
      <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>AP Radio TX Retries</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-400">{d.retries.samples} sampel / {d.window_h}j</span>
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
        <p className="mt-2 text-[10px] font-mono text-slate-400 leading-relaxed">
          {d.retries.ccq_est_used
            ? 'RouterOS (driver legacy) tidak melaporkan jumlah retry hardware — batang di atas = 100 − CCQ (tekanan udara/retry tersembunyi).'
            : `Frame timeout nyata dari router · rata-rata ${d.retries.avg_pct}%`}
          <br />
          {d.retries.source}
        </p>
      </div>

      {/* Connectivity funnel */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-3">
          <Wifi className="w-4 h-4 text-blue-600" />
          <span>WiFi Connectivity</span>
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className={`text-3xl font-bold font-mono ${overall >= 97 ? 'text-emerald-600' : overall >= 90 ? 'text-amber-600' : 'text-rose-600'}`}>
            {overall}%
          </span>
          <span className="text-[10px] font-mono text-slate-400">rata-rata 4 tahap</span>
        </div>
        <div className="space-y-2">
          {stages.map(([name, v]) => (
            <div key={name} title={d.connectivity.basis[name.toLowerCase()]}>
              <div className="flex justify-between text-[10px] font-mono mb-0.5">
                <span className="text-slate-500">{name}</span>
                <span className="text-slate-700 font-bold">{v}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${stageColor(v)}`} style={{ width: `${v}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] font-mono text-slate-400 leading-relaxed">
          {d.connectivity.basis.association} · {d.connectivity.basis.dhcp}
        </p>
      </div>

      {/* Signal spread / density */}
      <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold">
            <SignalHigh className="w-4 h-4 text-blue-600" />
            <span>Sebaran Sinyal Klien</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            median {d.signal.median_dbm ?? '-'} dBm · {d.signal.clients} klien live
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
          <div className="space-y-1.5">
            {d.signal.buckets.map((b) => (
              <div key={String(b.lo)} className="flex items-center gap-2">
                <span className="w-20 text-[10px] font-mono text-slate-500 text-right">{rssiLabel(b)} dBm</span>
                <div className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden">
                  <div
                    className={`h-full ${b.lo <= -80 ? 'bg-rose-500' : b.lo <= -70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.round((b.pct / sigMax) * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-[10px] font-mono text-slate-600 text-right">{b.pct}%</span>
              </div>
            ))}
          </div>
          <div
            className={`rounded-xl border p-3 text-xs font-mono ${
              d.density.need_improvement
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <div className="flex items-center gap-2 font-bold mb-1">
              {d.density.need_improvement ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {d.density.title}
            </div>
            <div className="text-[10px] leading-relaxed">{d.density.detail}</div>
            <div className="text-[10px] leading-relaxed mt-1 text-slate-500">{d.signal.source}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
