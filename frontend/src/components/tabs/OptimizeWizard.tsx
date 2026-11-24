import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Layers,
  Play,
  RefreshCw,
  Radio,
  Radar,
  Settings2,
  Upload,
  XCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import { OptimizeJob } from '../../types';

interface Props {
  deviceId: string;
  onApplied?: () => void;
}

const STAGE_ICON: Record<string, React.ReactNode> = {
  identify: <Layers className="w-4 h-4" />,
  history: <Clock className="w-4 h-4" />,
  scan: <Radar className="w-4 h-4" />,
  compute: <Settings2 className="w-4 h-4" />,
  deliver: <Upload className="w-4 h-4" />,
};

const STAGE_HINT: Record<string, string> = {
  identify: 'Deteksi AP kritis: beban klien & CPU',
  history: 'Analisis data historis untuk isu roaming',
  scan: 'Scan radio: relasi tetangga & sumber interferensi eksternal',
  compute: 'Hitung channel, tx-power, dan roaming sensitivity optimal',
  deliver: 'Push konfigurasi ke AP lewat MikroTik API :8728',
};

const statusColor = (s: string) =>
  s === 'done'
    ? 'text-emerald-600'
    : s === 'running'
    ? 'text-blue-600'
    : s === 'error'
    ? 'text-rose-600'
    : s === 'skipped'
    ? 'text-amber-600'
    : 'text-slate-300';

const statusIcon = (s: string) => {
  if (s === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (s === 'running') return <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />;
  if (s === 'error') return <XCircle className="w-4 h-4 text-rose-600" />;
  if (s === 'skipped') return <AlertCircle className="w-4 h-4 text-amber-600" />;
  return <span className="w-4 h-4 rounded-full border-2 border-slate-200 block" />;
};

export const OptimizeWizard: React.FC<Props> = ({ deviceId, onApplied }) => {
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ history: true });
  const [historyMin, setHistoryMin] = useState(1440);
  const [scanS, setScanS] = useState(8);
  const [dryRun, setDryRun] = useState(false);
  const pollRef = useRef<number | null>(null);

  const fetchJob = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await api.getOptimizeCurrent(deviceId);
      if (res && res.ok) setJob(res);
    } catch {
      /* keep last known state */
    }
  }, [deviceId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (job?.status === 'running') {
      pollRef.current = window.setInterval(async () => {
        await fetchJob();
      }, 2000);
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.status, fetchJob]);

  const start = async () => {
    if (!deviceId || starting) return;
    if (
      !dryRun &&
      !window.confirm(
        'Jalankan optimasi penuh dan PUSH konfigurasi ke AP sekarang?\n\nChannel/width dapat berubah → klien di radio itu terputus sesaat. Rollback tersedia setelah selesai.'
      )
    ) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await api.startOptimize(deviceId, {
        history_window_min: historyMin,
        scan_duration: scanS,
        dry_run: dryRun,
      });
      if (!res.ok) {
        setError(res.message || 'Optimasi lain masih berjalan');
      } else {
        await fetchJob();
      }
    } catch (e: any) {
      setError(e.message || 'Gagal memulai optimasi');
    } finally {
      setStarting(false);
    }
  };

  const finishNotify = useRef<string | null>(null);
  useEffect(() => {
    if (job?.status === 'done' && job.run_id && finishNotify.current !== job.run_id) {
      finishNotify.current = job.run_id;
      if (onApplied) onApplied();
    }
  }, [job?.status, job?.run_id, onApplied]);

  const roaming = (job?.details?.history as any)?.roaming_issues as any[] | undefined;
  const deliver = job?.details?.deliver as any;
  const compute = job?.details?.compute as any;
  const scan = job?.details?.scan as any;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-blue-700 font-bold">
            <Radar className="w-4 h-4 text-blue-600" />
            <span>AI Optimize — Full Pipeline</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
              5 PHASE
            </span>
          </div>
          <p className="text-slate-500 mt-1 text-[11px] max-w-2xl">
            Identify APs → historical data → WLAN scan → compute → deliver. Berjalan di background:
            setelah keluar dari halaman ini, optimasi tetap lanjut.
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] text-slate-500 font-semibold">
            History (min)
            <input
              type="number"
              value={historyMin}
              min={60}
              step={60}
              onChange={(e) => setHistoryMin(Number(e.target.value) || 1440)}
              className="block mt-0.5 w-20 px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
            />
          </label>
          <label className="text-[10px] text-slate-500 font-semibold">
            Scan (s)
            <input
              type="number"
              value={scanS}
              min={4}
              max={20}
              onChange={(e) => setScanS(Number(e.target.value) || 8)}
              className="block mt-0.5 w-16 px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600 font-semibold pb-1.5">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            dry-run
          </label>
          <button
            onClick={start}
            disabled={starting || job?.status === 'running' || !deviceId}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {job?.status === 'running' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {job?.status === 'running' ? `Berjalan ${job.progress_pct}%` : 'Start Optimization'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {job && (
        <>
          <div className="mt-4 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>

          <div className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {job.stages.map((s: any) => {
              const open = !!expanded[s.key];
              const dur =
                s.started && s.ended ? `${Math.max(0.1, s.ended - s.started).toFixed(1)}s` : null;
              return (
                <div key={s.key} className="bg-slate-50/40">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [s.key]: !p[s.key] }))}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer hover:bg-slate-50"
                  >
                    <span className={statusColor(s.status)}>{STAGE_ICON[s.key]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold text-slate-800">{s.name}</span>
                      <span className="text-slate-400 ml-2">{STAGE_HINT[s.key]}</span>
                    </span>
                    <span className="text-slate-400 shrink-0">{dur || s.eta}</span>
                    {statusIcon(s.status)}
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {open && (
                    <div className="px-10 pb-3 text-slate-600 space-y-1">
                      {s.key === 'identify' &&
                        ((job.details?.critical_aps as any[]) || []).map((a) => (
                          <div key={a.device}>
                            • {a.name || a.device} — klien {a.clients ?? '?'}, CPU {a.cpu_load ?? '?'}%{' '}
                            {a.critical ? (
                              <span className="text-rose-600 font-semibold">CRITICAL</span>
                            ) : (
                              <span className="text-slate-400">normal</span>
                            )}
                            {a.error && <span className="text-rose-500"> ({a.error})</span>}
                          </div>
                        ))}
                      {s.key === 'history' && (
                        <>
                          <div>
                            {((job.details?.history as any)?.samples ?? 0)} sampel,{' '}
                            {((job.details?.history as any)?.clients_seen ?? 0)} klien, window{' '}
                            {((job.details?.history as any)?.window_min ?? 0)} menit
                          </div>
                          <div className="font-semibold text-slate-800">
                            {((job.details?.history as any)?.roaming_issues_count ?? 0)} historical roaming
                            issue terdeteksi
                          </div>
                          {(roaming || []).map((r, i) => (
                            <div key={`${r.mac}-${i}`} className="pl-2 border-l-2 border-amber-300">
                              <span className="font-mono text-slate-800">{r.mac}</span> —{' '}
                              <span className="text-amber-700 font-semibold">{r.scope}</span>
                              {r.avg_rssi != null && <span className="text-slate-500"> · avg {r.avg_rssi} dBm</span>}
                              <div className="text-slate-500">{r.note}</div>
                            </div>
                          ))}
                        </>
                      )}
                      {s.key === 'scan' &&
                        ((scan?.bands as any[]) || []).map((b, i) => (
                          <div key={`${b.device}-${b.band}-${i}`}>
                            • {b.device} {b.band}: channel {b.current_channel?.channel ?? '?'} → best{' '}
                            {b.best_channel ?? '?'}, tetangga {b.neighbours ?? 0}, interferensi{' '}
                            <span
                              className={
                                b.interference_level === 'high' ? 'text-rose-600 font-semibold' : 'text-emerald-600'
                              }
                            >
                              {b.interference_level ?? '?'}
                            </span>
                            {b.error && <span className="text-rose-500"> ({b.error})</span>}
                          </div>
                        ))}
                      {s.key === 'compute' && (
                        <>
                          <div>
                            Channel: gain {compute?.channel?.gain_pct ?? 0}% · iterasi{' '}
                            {compute?.channel?.iterations ?? '?'} · perubahan{' '}
                            {(compute?.channel?.changes as any[])?.length ?? 0}
                          </div>
                          <div>Tx-power: {(compute?.tx_power as any[])?.length ?? 0} radio disesuaikan</div>
                          <div>
                            Roaming sensitivity: <span className="font-semibold">{compute?.roaming_sensitivity_dbm} dBm</span>{' '}
                            <span className="text-slate-400">({compute?.roaming_rationale})</span>
                          </div>
                        </>
                      )}
                      {s.key === 'deliver' && (
                        <>
                          {deliver?.dry_run ? (
                            <div className="text-amber-700">Dry-run: konfigurasi tidak dikirim ke AP</div>
                          ) : deliver?.skipped ? (
                            <div className="text-amber-700">Dilewati: {deliver?.reason}</div>
                          ) : (
                            <div className="text-emerald-700">
                              {deliver?.applied_actions ?? 0} aksi diterapkan · gain {deliver?.gain_pct ?? 0}%
                              {job.run_id && <span className="text-slate-500"> · run {job.run_id}</span>}
                            </div>
                          )}
                        </>
                      )}
                      {s.status === 'error' && job.error && (
                        <div className="text-rose-600">{job.error}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" /> status {job.status}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3" /> stage {job.stage}
            </span>
            <span className="flex items-center gap-1">
              <Radio className="w-3 h-3" /> {job.progress_pct}%
            </span>
          </div>
        </>
      )}
    </div>
  );
};
