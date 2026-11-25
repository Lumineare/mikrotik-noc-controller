import React, { useState, useEffect, useCallback } from 'react';
import {
  Radar, Play, RotateCcw, BrainCircuit, Loader2, CheckCircle2, AlertCircle,
  ArrowRight, Radio, Gauge, ShieldAlert, Save,
} from 'lucide-react';

interface RrmConfig {
  enabled: boolean;
  interval_min: number;
  include_dfs: boolean;
  apply_channel: boolean;
  apply_txpower: boolean;
  apply_steering: boolean;
  min_gain_pct: number;
  quiet_start: string;
  quiet_end: string;
  max_client_drop: number;
  scan_duration: number;
  last_run_ts: number;
}

interface DcaChange {
  device_id: string; interface: string; band: string;
  from_freq: number; to_freq: number; relief_pct: number;
}
interface TpcChange {
  device_id: string; interface: string; band: string;
  from_dbm: number; to_dbm: number; reason: string;
  strongest_neighbour_dbm?: number;
}
interface RrmPlan {
  ok: boolean; generated_at: string; include_dfs: boolean;
  devices_scanned: number; bands_seen: number; samples_collected: number;
  dca: { changes: DcaChange[]; cost_before: number; cost_after: number; gain_pct: number; iterations: number };
  tpc: TpcChange[];
  steering: Array<{ device_id: string; interface: string; signal_range: string; rationale: string }>;
  summary: { channel_changes: number; txpower_changes: number; steering_rules: number; expected_gain_pct: number; actionable: boolean };
}
interface RrmRun {
  id: string; ts: number; mode: string; status: string; gain_pct: number; rolled_back: number;
  result?: { channel?: any[]; txpower?: any[]; steering?: any[] };
}
interface Anomaly {
  mac: string; device_id: string; interface: string; band: string; ts: string;
  score: number; verdict: string; features: Record<string, number>;
}

const token = () => localStorage.getItem('rsam_noc_token');
async function call<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const t = token();
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any).detail || `HTTP ${res.status}`);
  return json as T;
}

const MHZ: Record<number, string> = {
  2412: 'Ch 1', 2437: 'Ch 6', 2462: 'Ch 11',
  5180: 'Ch 36', 5200: 'Ch 40', 5220: 'Ch 44', 5240: 'Ch 48',
  5745: 'Ch 149', 5765: 'Ch 153', 5785: 'Ch 157', 5805: 'Ch 161', 5825: 'Ch 165',
  5260: 'Ch 52', 5280: 'Ch 56', 5300: 'Ch 60', 5320: 'Ch 64',
  5500: 'Ch 100', 5520: 'Ch 104', 5540: 'Ch 108', 5560: 'Ch 112',
  5580: 'Ch 116', 5600: 'Ch 120', 5620: 'Ch 124', 5640: 'Ch 128',
  5660: 'Ch 132', 5680: 'Ch 136', 5700: 'Ch 140', 5720: 'Ch 144',
};
const ch = (f: number) => `${MHZ[f] || '?'} · ${f}`;

export const RrmPanel: React.FC<{ deviceId: string; onApplied?: () => void }> = ({ deviceId, onApplied }) => {
  const [cfg, setCfg] = useState<RrmConfig | null>(null);
  const [runs, setRuns] = useState<RrmRun[]>([]);
  const [samples, setSamples] = useState(0);
  const [mlReady, setMlReady] = useState(false);
  const [quiet, setQuiet] = useState(false);

  const [plan, setPlan] = useState<RrmPlan | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'rollback' | 'anomaly' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await call<{ config: RrmConfig; runs: RrmRun[]; rf_samples: number; ml_ready: boolean; in_quiet_window: boolean }>('/api/rrm/status');
      setCfg(s.config);
      setRuns(s.runs || []);
      setSamples(s.rf_samples);
      setMlReady(s.ml_ready);
      setQuiet(s.in_quiet_window);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus, deviceId]);

  const saveCfg = async (patch: Partial<RrmConfig>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      await call('/api/rrm/config', 'POST', patch);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const runPlan = async () => {
    setBusy('plan'); setMsg(null); setAnomalies(null);
    try {
      const p = await call<RrmPlan>('/api/rrm/plan', 'POST');
      setPlan(p);
      setMsg({
        ok: true,
        text: p.summary.actionable
          ? `Rencana siap: ${p.summary.channel_changes} channel, ${p.summary.txpower_changes} tx-power, ${p.summary.steering_rules} steering — gain ${p.summary.expected_gain_pct}%`
          : 'Jaringan sudah optimal — tidak ada perubahan yang layak diterapkan',
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };

  const runApply = async () => {
    setBusy('apply'); setMsg(null);
    try {
      const r = await call<{ ok: boolean; skipped?: boolean; reason?: string; run_id?: string; applied_actions?: number; gain_pct?: number }>(
        '/api/rrm/apply', 'POST', { plan });
      setMsg(r.skipped
        ? { ok: false, text: `Ditolak: ${r.reason}` }
        : { ok: true, text: `Push selesai — ${r.applied_actions} aksi diterapkan (run ${r.run_id}). Rollback tersedia di riwayat.` });
      if (!r.skipped) { setPlan(null); onApplied?.(); }
      await loadStatus();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };

  const rollback = async (runId: string) => {
    setBusy('rollback'); setMsg(null);
    try {
      const r = await call<{ interfaces_restored: number; steering_rules_removed: number }>(
        '/api/rrm/rollback', 'POST', { run_id: runId });
      setMsg({ ok: true, text: `Rollback ${runId}: ${r.interfaces_restored} interface dipulihkan, ${r.steering_rules_removed} rule steering dihapus` });
      await loadStatus(); onApplied?.();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };

  const runAnomaly = async () => {
    setBusy('anomaly'); setMsg(null);
    try {
      const r = await call<{ ok: boolean; status?: string; samples: number; needed?: number; anomalies?: Anomaly[]; anomaly_rate_pct?: number; note?: string }>(
        '/api/ai/ml/anomaly', 'POST');
      if (!r.ok) {
        setMsg({ ok: false, text: `Model belum siap: ${r.samples}/${r.needed} sampel. ${r.note || ''}` });
      } else {
        setAnomalies(r.anomalies || []);
        setMsg({ ok: true, text: `${r.anomalies?.length || 0} anomali dari ${r.samples} sampel (${r.anomaly_rate_pct}%)` });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };

  const Toggle: React.FC<{ label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }> = ({ label, on, onChange, hint }) => (
    <button
      onClick={() => onChange(!on)}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
        on ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}
      title={hint}
    >
      <span>{label}</span>
      <span className={`w-7 h-3.5 rounded-full relative transition-colors ${on ? 'bg-blue-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  );

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <Radar className="w-4 h-4 text-blue-600" />
            <span>Direct-Push RRM (Self-Optimizing WLAN)</span>
            {cfg?.enabled && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">AUTO</span>}
            {cfg?.enabled && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${quiet ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {quiet ? 'dalam quiet window' : 'di luar quiet window — tunggu'}
            </span>}
          </div>
          <p className="text-slate-500 text-[11px] mt-1">
            DCA (weighted graph coloring) + TPC (−70 dBm target) + band steering, di-push backend sendiri.
            {' '}Sampel RF: <b>{samples}</b>{mlReady ? ' · ML siap' : ' · ML kumpulkan data'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runPlan} disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
          >
            {busy === 'plan' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
            Scan &amp; Plan
          </button>
          <button
            onClick={runApply} disabled={busy !== null || !plan?.summary?.actionable}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-bold cursor-pointer"
          >
            {busy === 'apply' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Push Plan
          </button>
          <button
            onClick={runAnomaly} disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
          >
            {busy === 'anomaly' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
            Anomaly ML
          </button>
        </div>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 p-3 rounded-xl border text-[11px] font-semibold ${
          msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* auto-push config */}
      {cfg && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Toggle label="Auto-push" on={cfg.enabled} onChange={(v) => saveCfg({ enabled: v })} hint="Backend menjalankan plan+apply sendiri tiap interval" />
          <Toggle label="Terapkan channel" on={cfg.apply_channel} onChange={(v) => saveCfg({ apply_channel: v })} />
          <Toggle label="Terapkan tx-power" on={cfg.apply_txpower} onChange={(v) => saveCfg({ apply_txpower: v })} hint="Memutus klien sesaat saat radio restart" />
          <Toggle label="Band steering" on={cfg.apply_steering} onChange={(v) => saveCfg({ apply_steering: v })} hint="Tolak klien < −75 dBm di 2.4 GHz" />
          <Toggle label="Izinkan DFS" on={cfg.include_dfs} onChange={(v) => saveCfg({ include_dfs: v })} hint="Risiko radar-drop memutus radio" />
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
            <Gauge className="w-3.5 h-3.5" />
            <span>min gain</span>
            <input
              type="number" value={cfg.min_gain_pct} min={0} max={90}
              onChange={(e) => saveCfg({ min_gain_pct: Number(e.target.value) })}
              className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-900 font-mono"
            />
            <span>%</span>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
            <span>quiet</span>
            <input value={cfg.quiet_start} onChange={(e) => saveCfg({ quiet_start: e.target.value })}
              className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-900 font-mono" />
            <span>–</span>
            <input value={cfg.quiet_end} onChange={(e) => saveCfg({ quiet_end: e.target.value })}
              className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-900 font-mono" />
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
            <span>interval</span>
            <input type="number" value={cfg.interval_min} min={5} max={1440}
              onChange={(e) => saveCfg({ interval_min: Number(e.target.value) })}
              className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-900 font-mono" />
            <span>mnt</span>
          </label>
        </div>
      )}

      {/* plan detail */}
      {plan && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 flex flex-wrap items-center gap-3">
            <span>Plan {plan.generated_at}</span>
            <span className="text-slate-400">|</span>
            <span>{plan.bands_seen} radio</span>
            <span className="text-slate-400">|</span>
            <span>cost {plan.dca.cost_before.toExponential(2)} → {plan.dca.cost_after.toExponential(2)} mW</span>
            <span className="text-slate-400">|</span>
            <span className="text-blue-700">gain {plan.dca.gain_pct}%</span>
            <span className="text-slate-400">|</span>
            <span>{plan.dca.iterations} pass</span>
            {plan.include_dfs && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">DFS ON</span>}
          </div>
          <div className="divide-y divide-slate-100">
            {plan.dca.changes.map((c, i) => (
              <div key={`ch${i}`} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                <Radio className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="font-bold text-slate-800">{c.device_id}/{c.interface}</span>
                <span className="text-slate-400">{c.band}</span>
                <span className="font-mono text-slate-600">{ch(c.from_freq)}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-mono text-emerald-700 font-bold">{ch(c.to_freq)}</span>
                <span className="ml-auto px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">−{c.relief_pct}% interferensi</span>
              </div>
            ))}
            {plan.tpc.map((t, i) => (
              <div key={`tp${i}`} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                <Gauge className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="font-bold text-slate-800">{t.device_id}/{t.interface}</span>
                <span className="font-mono text-slate-600">{t.from_dbm} dBm</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-mono text-amber-700 font-bold">{t.to_dbm} dBm</span>
                <span className="ml-auto text-slate-500">{t.reason}</span>
              </div>
            ))}
            {plan.steering.map((s, i) => (
              <div key={`st${i}`} className="px-3 py-2 flex items-start gap-2 text-[11px]">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                <span className="font-bold text-slate-800">{s.device_id}/{s.interface}</span>
                <span className="font-mono text-slate-600">signal-range {s.signal_range}</span>
                <span className="ml-auto text-slate-500 text-right max-w-[50%]">{s.rationale}</span>
              </div>
            ))}
            {!plan.summary.actionable && (
              <div className="px-3 py-3 text-[11px] text-slate-500">Tidak ada perubahan yang direkomendasikan.</div>
            )}
          </div>
        </div>
      )}

      {/* ML anomalies */}
      {anomalies && anomalies.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-800 text-white text-[11px] font-bold flex items-center gap-2">
            <BrainCircuit className="w-3.5 h-3.5" /> IsolationForest — {anomalies.length} anomali transmisi
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-auto">
            {anomalies.map((a, i) => (
              <div key={`an${i}`} className="px-3 py-2 text-[11px] flex flex-wrap items-center gap-2">
                <span className="font-mono text-slate-800 font-bold">{a.mac}</span>
                <span className="text-slate-400">{a.interface}</span>
                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold">{a.verdict}</span>
                <span className="font-mono text-slate-500">score {a.score}</span>
                <span className="ml-auto text-slate-400">
                  RSSI {a.features.rssi} · SNR {a.features.snr} · retry {a.features.retry_pct}% · CCQ {a.features.tx_ccq}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* run history */}
      {runs.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700">Riwayat push &amp; rollback</div>
          <div className="divide-y divide-slate-100">
            {runs.slice(0, 6).map((r) => {
              const applied = (r.result?.channel?.length || 0) + (r.result?.txpower?.length || 0) + (r.result?.steering?.length || 0);
              return (
                <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-slate-700">{r.id}</span>
                  <span className="text-slate-400">{new Date(r.ts * 1000).toLocaleString()}</span>
                  <span className="text-slate-500">{applied} aksi · gain {r.gain_pct}%</span>
                  {r.rolled_back ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-bold">rolled back</span>
                  ) : (
                    <button
                      onClick={() => rollback(r.id)} disabled={busy !== null}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer disabled:opacity-50"
                    >
                      {busy === 'rollback' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Rollback
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
