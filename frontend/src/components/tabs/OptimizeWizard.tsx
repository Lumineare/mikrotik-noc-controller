import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Play,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import { OptimizeJob } from '../../types';

const BASE = (import.meta as any).env?.VITE_API_URL || '';
const call = async <T,>(path: string, method = 'GET', body?: any): Promise<T> => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

interface RrmConfig {
  enabled: boolean;
  include_dfs: boolean;
  apply_channel: boolean;
  apply_txpower: boolean;
  apply_steering: boolean;
  min_gain_pct: number;
}

const STEP_LABEL: Record<string, string> = {
  identify: 'Cek AP kritis',
  history: 'Analisa riwayat',
  scan: 'Scan WLAN',
  compute: 'Hitung config',
  deliver: 'Kirim ke AP',
};

const pill = (job: OptimizeJob | null) => {
  if (!job) return { text: 'Belum pernah jalan', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  if (job.status === 'running')
    return { text: `Berjalan ${job.progress_pct}%`, cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (job.status === 'done') return { text: 'Selesai', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (job.status === 'cancelled')
    return { text: 'Dibatalkan', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { text: 'Gagal', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
};

export const OptimizeWizard: React.FC<{ deviceId: string; onApplied?: () => void }> = ({
  deviceId,
  onApplied,
}) => {
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [cfg, setCfg] = useState<RrmConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [historyMin, setHistoryMin] = useState(1440);
  const [scanS, setScanS] = useState(8);
  const [dryRun, setDryRun] = useState(false);
  const [aiPush, setAiPush] = useState(true);
  const notified = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const j = await api.getOptimizeCurrent(deviceId);
      if (j && j.ok) setJob(j);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  const loadCfg = useCallback(async () => {
    try {
      const s = await call<{ config: RrmConfig }>('/api/rrm/status');
      setCfg(s.config);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    loadCfg();
  }, [load, loadCfg]);

  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [job?.status, load]);

  useEffect(() => {
    if (job?.status === 'done' && job.run_id && notified.current !== job.run_id) {
      notified.current = job.run_id;
      onApplied?.();
    }
  }, [job?.status, job?.run_id, onApplied]);

  const start = async () => {
    if (busy) return;
    if (
      !dryRun &&
      !window.confirm(
        'Optimalkan sekarang dan kirim perubahan ke AP?\n\nChannel bisa berubah → klien di radio itu terputus 10–30 detik. Semua perubahan bisa dibatalkan lewat tombol Rollback.'
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.startOptimize(deviceId, {
        history_window_min: historyMin,
        scan_duration: scanS,
        dry_run: dryRun,
        ai_auto_push: aiPush,
      } as any);
      setMsg(r.ok ? null : r.message || 'Optimasi lain masih berjalan');
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Gagal memulai');
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!job) return;
    if (!window.confirm('Batalkan semua perubahan dari optimasi terakhir dan kembalikan konfigurasi AP?'))
      return;
    setBusy(true);
    const parts: string[] = [];
    try {
      if (job.run_id) {
        const r = await call<any>('/api/rrm/rollback', 'POST', { run_id: job.run_id });
        parts.push(`${r.interfaces_restored ?? 0} radio dikembalikan`);
      }
      const aiRun = (job.details?.summary as any)?.ai_run_id;
      if (aiRun) {
        const a = await call<any>('/api/ai/optimize/rollback', 'POST', { run_id: aiRun });
        parts.push(`${a.interfaces_restored ?? 0} interface AI, ${a.fasttrack_rules_removed ?? 0} rule`);
      }
      setMsg(parts.length ? `Rollback: ${parts.join(', ')}` : 'Tidak ada perubahan untuk dibatalkan');
    } catch (e: any) {
      setMsg(e.message || 'Rollback gagal');
    } finally {
      setBusy(false);
    }
  };

  const saveCfg = async (patch: Partial<RrmConfig>) => {
    setCfg((p) => (p ? { ...p, ...patch } : p));
    try {
      await call('/api/rrm/config', 'POST', patch);
    } catch (e: any) {
      setMsg(e.message || 'Gagal simpan pengaturan');
    }
  };

  const p = pill(job);
  const s = job?.details?.summary as any;
  const roaming = (job?.details?.history as any)?.roaming_issues as any[] | undefined;
  const scan = job?.details?.scan as any;
  const compute = job?.details?.compute as any;
  const deliver = job?.details?.deliver as any;
  const running = job?.status === 'running';

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="font-bold text-slate-800">AI Optimize</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${p.cls}`}>{p.text}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
          >
            Detail <ChevronDown className={`w-3 h-3 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => setShowCfg((v) => !v)}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
          >
            <Sliders className="w-3 h-3" /> Pengaturan
          </button>
        </div>
      </div>

      <p className="text-slate-500 mt-1 text-[11px]">
        Satu tombol: cek AP → analisa riwayat → scan WLAN → hitung → kirim ke AP. Tetap jalan walau halaman
        ditutup.
      </p>

      {!running && (
        <button
          onClick={start}
          disabled={busy || !deviceId}
          className="mt-3 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm cursor-pointer"
        >
          <Play className="w-4 h-4" />
          {job?.status === 'done' ? 'Optimalkan Ulang' : 'Optimalkan Sekarang'}
        </button>
      )}

      {job && (
        <>
          <div className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(job.stages || []).map((st: any) => (
              <div
                key={st.key}
                className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold flex items-center gap-1.5 ${
                  st.status === 'done'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : st.status === 'running'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : st.status === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                {st.status === 'done' ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                ) : st.status === 'running' ? (
                  <RefreshCw className="w-3 h-3 shrink-0 animate-spin" />
                ) : st.status === 'error' ? (
                  <XCircle className="w-3 h-3 shrink-0" />
                ) : (
                  <span className="w-3 h-3 rounded-full border-2 border-current shrink-0" />
                )}
                <span className="truncate">{STEP_LABEL[st.key] || st.name}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {job?.status === 'done' && s && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
          <div className="text-[12px] font-bold text-emerald-800">
            Selesai ·{' '}
            {s.channel_gain_pct != null
              ? `jaringan ${s.channel_gain_pct}% lebih bersih`
              : deliver?.skipped
              ? 'channel sudah optimal'
              : 'jaringan stabil'}
            {s.roaming_issues ? ` · ${s.roaming_issues} isu roaming` : ''}
            {s.ai_applied ? ` · ${s.ai_applied} perbaikan AI` : ''}
            {s.score_before != null && s.score_after != null
              ? ` (score ${s.score_before}→${s.score_after})`
              : ''}
          </div>
          <button
            onClick={rollback}
            disabled={busy}
            className="mt-2 text-[11px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" /> Batalkan perubahan optimasi terakhir
          </button>
        </div>
      )}

      {job?.status === 'error' && (
        <div className="mt-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {job.error || 'Optimasi gagal'}
        </div>
      )}

      {msg && <div className="mt-2 text-[11px] text-slate-600">{msg}</div>}

      {showDetail && job && (
        <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5 text-[11px] text-slate-600">
          <div className="font-bold text-slate-800">Hasil tiap langkah</div>
          {((job.details?.critical_aps as any[]) || []).map((a) => (
            <div key={a.device}>
              • {a.name || a.device}: {a.clients ?? '?'} klien, CPU {a.cpu_load ?? '?'}%
              {a.critical && <span className="text-rose-600 font-bold"> — kritis</span>}
              {a.error && <span className="text-rose-500"> ({a.error})</span>}
            </div>
          ))}
          <div>
            • Riwayat: {(job.details?.history as any)?.samples ?? 0} sampel,{' '}
            {(job.details?.history as any)?.clients_seen ?? 0} klien
          </div>
          {(roaming || []).map((r, i) => (
            <div key={`${r.mac}-${i}`} className="pl-3 border-l-2 border-amber-300">
              {r.mac} — {r.scope}
              {r.avg_rssi != null && ` · avg ${r.avg_rssi} dBm`}
              <div className="text-slate-500">{r.note}</div>
            </div>
          ))}
          {((scan?.bands as any[]) || []).map((b, i) => (
            <div key={`${b.device}-${b.band}-${i}`}>
              • Scan {b.device} {b.band}: ch {b.current_channel?.channel ?? '?'} → {b.best_channel ?? '?'},
              tetangga {b.neighbours ?? 0}, interferensi {b.interference_level ?? '?'}
              {b.error && <span className="text-rose-500"> ({b.error})</span>}
            </div>
          ))}
          {compute && (
            <div>
              • Hitung: channel gain {compute.channel?.gain_pct ?? 0}%, {compute.tx_power?.length ?? 0}{' '}
              tx-power, roaming {compute.roaming_sensitivity_dbm} dBm
            </div>
          )}
          {deliver && !deliver.dry_run && (
            <div>
              • Kirim: {deliver.applied_actions ?? 0} aksi, gain {deliver.gain_pct ?? 0}%
              {deliver.ai?.applied != null &&
                `, AI ${deliver.ai.applied}/${deliver.ai.applied + (deliver.ai.failed || 0)} ok`}
              {job.run_id && <span className="text-slate-400"> · {job.run_id}</span>}
            </div>
          )}
          {deliver?.dry_run && <div>• Kirim: dry-run, tidak ada perubahan</div>}
          {deliver?.skipped && <div>• Kirim: dilewati — {deliver.reason}</div>}
        </div>
      )}

      {showCfg && (
        <div className="mt-3 border-t border-slate-100 pt-3 space-y-2 text-[11px]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="text-slate-500 font-semibold">
              Riwayat (menit)
              <input
                type="number"
                min={60}
                step={60}
                value={historyMin}
                onChange={(e) => setHistoryMin(Number(e.target.value) || 1440)}
                className="block mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
              />
            </label>
            <label className="text-slate-500 font-semibold">
              Scan (detik)
              <input
                type="number"
                min={4}
                max={20}
                value={scanS}
                onChange={(e) => setScanS(Number(e.target.value) || 8)}
                className="block mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
              />
            </label>
            <label className="text-slate-500 font-semibold">
              Gain minimum (%)
              <input
                type="number"
                min={0}
                max={100}
                value={cfg?.min_gain_pct ?? 15}
                onChange={(e) => saveCfg({ min_gain_pct: Number(e.target.value) || 0 })}
                className="block mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            {([
              ['dry', 'Dry-run (jangan kirim)', dryRun, setDryRun],
              ['ai', 'Sekalian perbaikan AI', aiPush, setAiPush],
              ['ch', 'Atur channel', cfg?.apply_channel ?? true, (v: boolean) => saveCfg({ apply_channel: v })],
              ['tp', 'Atur tx-power', cfg?.apply_txpower ?? false, (v: boolean) => saveCfg({ apply_txpower: v })],
              [
                'st',
                'Roaming/steering',
                cfg?.apply_steering ?? false,
                (v: boolean) => saveCfg({ apply_steering: v }),
              ],
              ['dfs', 'Pakai channel DFS', cfg?.include_dfs ?? false, (v: boolean) => saveCfg({ include_dfs: v })],
              ['auto', 'Auto tiap 15 menit', cfg?.enabled ?? false, (v: boolean) => saveCfg({ enabled: v })],
            ] as [string, string, boolean, (v: boolean) => void][]).map(([k, label, val, setter]) => (
              <label key={k} className="flex items-center gap-1.5 text-slate-600 font-semibold cursor-pointer">
                <input type="checkbox" checked={!!val} onChange={(e) => setter(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
