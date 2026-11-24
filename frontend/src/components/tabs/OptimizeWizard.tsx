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
  channels_2g?: number[];
  channels_5g?: number[];
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
          className="group relative mt-3 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-3.5 text-white shadow-lg shadow-blue-600/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-600/30 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0 cursor-pointer"
        >
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <span className="relative flex items-center justify-center gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-white/15 ring-1 ring-white/30">
              {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </span>
            <span className="text-left">
              <span className="block text-sm font-extrabold tracking-wide">
                {job?.status === 'done' ? 'Optimalkan Ulang' : 'Optimalkan Sekarang'}
              </span>
              <span className="block text-[10px] font-medium text-white/75">
                5 langkah otomatis · bisa dibatalkan kapan saja
              </span>
            </span>
            <Play className="w-4 h-4 ml-1 opacity-80 transition-transform group-hover:translate-x-0.5" />
          </span>
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
              ? `interferensi turun ${s.channel_gain_pct}%`
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
          <div className="text-slate-400">
            Semua angka di bawah dari router &amp; database lokal. LLM tidak dipakai di jalur ini.
          </div>
          {((job.details?.critical_aps as any[]) || []).map((a) => (
            <div key={a.device}>
              • {a.name || a.device}: {a.clients ?? '?'} klien, CPU {a.cpu_load ?? '?'}%
              {a.critical && <span className="text-rose-600 font-bold"> — kritis</span>}
              {a.error && <span className="text-rose-500"> ({a.error})</span>}
            </div>
          ))}
          <div className="text-slate-400">
            sumber: RouterOS <code>/system/resource</code> + <code>/interface/wireless/registration-table</code>{' '}
            (live)
          </div>
          <div>
            • Riwayat: {(job.details?.history as any)?.samples ?? 0} sampel,{' '}
            {(job.details?.history as any)?.clients_seen ?? 0} klien
            {(job.details?.history as any)?.span_min != null &&
              `, rentang ${(job.details?.history as any).span_min} menit`}
          </div>
          <div className="text-slate-400">
            sumber: database lokal <code>rf_samples</code> (sampler tiap 5 menit), window{' '}
            {(job.details?.history as any)?.window_min ?? 0} menit · kolom:{' '}
            {(((job.details?.history as any)?.fields as string[]) || []).join(', ')}
          </div>
          {(roaming || []).map((r, i) => (
            <div key={`${r.mac}-${i}`} className="pl-3 border-l-2 border-amber-300">
              {r.mac} — {r.scope}
              {r.avg_rssi != null && ` · avg ${r.avg_rssi} dBm`}
              <div className="text-slate-500">{r.note}</div>
            </div>
          ))}
          {(() => {
            const live = ((job as any).live_channels || {}) as any;
            if (live.error) return null;
            const parts = ['2g', '5g'].filter((k) => live[k]?.channel != null);
            if (!parts.length) return null;
            return (
              <div className="font-bold text-slate-800">
                • Channel radio sekarang (live dari router):{' '}
                {parts.map((k) => `${k} ch ${live[k].channel} (${live[k].freq} MHz)`).join(' · ')}
              </div>
            );
          })()}
          {((scan?.bands as any[]) || []).map((b, i) => {
            const scanAt = (b.scanned_at || '').replace(' ', 'T');
            const ageMin = scanAt ? (Date.now() - Date.parse(scanAt)) / 60000 : null;
            const stale = ageMin != null && ageMin > 10;
            return (
              <div key={`${b.device}-${b.band}-${i}`}>
                • Scan {b.device} {b.band}: sekarang ch {b.current_channel?.channel ?? '?'}
                {b.scanned_at && <span className="text-slate-400"> (scan {String(b.scanned_at).slice(11, 16)})</span>},
                kandidat udara terbaik ch {b.best_channel ?? '?'}, tetangga {b.neighbours ?? 0}, interferensi{' '}
                {b.interference_level ?? '?'}
                {b.error && <span className="text-rose-500"> ({b.error})</span>}
                {(() => {
                  const lv = ((job as any).live_channels || {})[b.band];
                  return lv && b.current_channel?.channel != null && lv.channel !== b.current_channel.channel ? (
                    <span className="text-amber-600 font-bold"> — sekarang sudah ch {lv.channel}</span>
                  ) : null;
                })()}
                {stale && (
                  <span className="text-amber-600">
                    {' '}— data scan {Math.round(ageMin!)} menit lalu; channel bisa sudah berubah setelah apply.
                    Jalankan Optimize lagi untuk kondisi terkini.
                  </span>
                )}
              </div>
            );
          })}
          <div className="text-slate-400">
            sumber: <code>/interface/wireless/scan</code> live {scanS}s — beacon tetangga + freq usage
          </div>
          {compute && (
            <div>
              {compute.actionable === false || compute.channel?.gain_pct === 0 ? (
                <>
                  • Hitung: tidak ada perubahan perlu — channel & tx-power sudah optimal (gain 0%), roaming
                  threshold {compute.roaming_sensitivity_dbm} dBm
                  {compute.sticky_clients
                    ? `, ${compute.sticky_clients} klien lemah bisa di-steer`
                    : ', tak ada klien lemah untuk di-steer'}
                </>
              ) : (
                <>
                  • Hitung: channel gain {compute.channel?.gain_pct ?? 0}%,{' '}
                  {compute.tx_power?.length ?? 0} tx-power, roaming {compute.roaming_sensitivity_dbm} dBm
                </>
              )}
            </div>
          )}
          <div className="text-slate-400">
            sumber: <code>rrm_engine.py</code> — model biaya deterministik (bukan LLM): cost(f) = noise(f) + Σ
            overlap×10^(RSSI/10)
          </div>
          {deliver && !deliver.dry_run && !deliver.skipped && (
            <div>
              • Kirim: {deliver.applied_actions ?? 0} aksi, gain {deliver.gain_pct ?? 0}%
              {deliver.ai?.applied != null &&
                `, AI ${deliver.ai.applied}/${deliver.ai.applied + (deliver.ai.failed || 0)} ok`}
              {job.run_id && <span className="text-slate-400"> · {job.run_id}</span>}
            </div>
          )}
          {deliver?.dry_run && <div>• Kirim: dry-run, tidak ada perubahan</div>}
          {deliver?.skipped && <div>• Kirim: dilewati — {deliver.reason}</div>}
          <div className="text-slate-400">
            sumber: <code>/interface/wireless set</code> (RRM) + diagnosa rule-based{' '}
            <code>/system/resource, /ip/dns, /ip/firewall/filter</code> → whitelist auto-push. LLM hanya
            dipakai di tab AI Chat, bukan di sini.
          </div>
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
            <label className="text-slate-500 font-semibold" title="Hanya 1, 6, 11 yang tidak saling tumpang tindih. Ch 9 menabrak 6 dan 11.">
              Channel 2.4GHz
              <input
                type="text"
                defaultValue={(cfg?.channels_2g ?? [1, 6, 11]).join(',')}
                onBlur={(e) =>
                  saveCfg({
                    channels_2g: e.target.value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter((n) => n >= 1 && n <= 14),
                  })
                }
                className="block mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-mono"
              />
            </label>
            <label className="text-slate-500 font-semibold" title="149–161 = UNII-3, non-DFS, legal di Indonesia. 36–48 jangkauannya lebih jauh.">
              Channel 5GHz
              <input
                type="text"
                defaultValue={(cfg?.channels_5g ?? [36, 40, 44, 48, 149, 153, 157, 161, 165]).join(',')}
                onBlur={(e) =>
                  saveCfg({
                    channels_5g: e.target.value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter((n) => n >= 36 && n <= 177),
                  })
                }
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
