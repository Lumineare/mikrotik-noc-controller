import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import { FleetDevice, OptimizeJob } from '../../types';

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
  apply_roam: boolean;
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

export const OptimizeWizard: React.FC<{
  deviceId?: string;
  fleet?: boolean;
  fleetDevices?: FleetDevice[];
  initialSelectedIds?: string[];
  onApplied?: () => void;
}> = ({ deviceId, fleet = false, fleetDevices, initialSelectedIds, onApplied }) => {
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [cfg, setCfg] = useState<RrmConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [showApList, setShowApList] = useState(false);
  const [expandedAp, setExpandedAp] = useState<string | null>(null);
  const [historyMin, setHistoryMin] = useState(1440);
  const [scanS, setScanS] = useState(8);
  const [dryRun, setDryRun] = useState(false);
  const [useOmniroute, setUseOmniroute] = useState(true);
  const [omniModels, setOmniModels] = useState<string[]>([]);
  const [selectedOmniModel, setSelectedOmniModel] = useState<string>(() => {
    try {
      return localStorage.getItem('rsam_optimize_omniroute_model') || '';
    } catch {
      return '';
    }
  });
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const notified = useRef<string | null>(null);

  // Target AP selector state (for fleet mode so user-optimized APs are never overwritten)
  const [loadedDevices, setLoadedDevices] = useState<FleetDevice[]>(fleetDevices || []);
  const [selectedApIds, setSelectedApIds] = useState<Set<string>>(() => {
    if (initialSelectedIds && initialSelectedIds.length > 0) return new Set(initialSelectedIds);
    return new Set((fleetDevices || []).map((d) => d.id));
  });
  const [showTargetPicker, setShowTargetPicker] = useState<boolean>(
    Boolean(initialSelectedIds && initialSelectedIds.length > 0)
  );
  const [targetSearch, setTargetSearch] = useState('');
  const [targetGroup, setTargetGroup] = useState('ALL');
  const initializedTargets = useRef<boolean>(
    Boolean((initialSelectedIds && initialSelectedIds.length > 0) || (fleetDevices && fleetDevices.length > 0))
  );

  useEffect(() => {
    if (fleetDevices && fleetDevices.length > 0) {
      setLoadedDevices(fleetDevices);
      if (!initializedTargets.current) {
        initializedTargets.current = true;
        setSelectedApIds(new Set(fleetDevices.map((d) => d.id)));
      }
    }
  }, [fleetDevices]);

  useEffect(() => {
    if (!fleet || (fleetDevices && fleetDevices.length > 0)) return;
    let alive = true;
    api
      .getFleet()
      .then((res) => {
        if (!alive) return;
        const devs = res.devices || [];
        setLoadedDevices(devs);
        if (!initializedTargets.current && devs.length > 0) {
          initializedTargets.current = true;
          setSelectedApIds(new Set(devs.map((d) => d.id)));
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [fleet, fleetDevices]);

  const targetGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of loadedDevices) {
      const g = d.group || 'Default';
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [loadedDevices]);

  const filteredTargetDevices = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    return loadedDevices.filter((d) => {
      const matchGroup = targetGroup === 'ALL' || (d.group || 'Default') === targetGroup;
      const matchSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        (d.group || '').toLowerCase().includes(q);
      return matchGroup && matchSearch;
    });
  }, [loadedDevices, targetSearch, targetGroup]);

  const toggleTargetAp = (id: string) => {
    setSelectedApIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalFleetCount = loadedDevices.length;
  const selectedCount = selectedApIds.size;
  const lockedCount = Math.max(0, totalFleetCount - selectedCount);
  const isPartialFleet = fleet && totalFleetCount > 0 && selectedCount > 0 && selectedCount < totalFleetCount;

  const load = useCallback(async () => {
    const key = fleet ? 'fleet' : deviceId;
    if (!key) return;
    try {
      const j = await api.getOptimizeCurrent(key);
      if (j && j.ok) setJob(j);
    } catch {
      /* ignore */
    }
  }, [deviceId, fleet]);

  const loadCfg = useCallback(async () => {
    try {
      const s = await call<{ config: RrmConfig }>('/api/rrm/status');
      setCfg(s.config);
    } catch {
      /* ignore */
    }
  }, []);

  const loadOmniModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await call<{ current_model?: string; available_models?: string[] }>('/api/ai/models');
      const list = Array.isArray(res.available_models) ? res.available_models : [];
      setOmniModels(list);
      setSelectedOmniModel((prev) => {
        if (prev && (list.length === 0 || list.includes(prev))) return prev;
        return res.current_model || list[0] || '';
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadCfg();
    loadOmniModels();
  }, [load, loadCfg, loadOmniModels]);

  const handleSelectOmniModel = (modelId: string) => {
    setSelectedOmniModel(modelId);
    try {
      if (modelId) localStorage.setItem('rsam_optimize_omniroute_model', modelId);
      else localStorage.removeItem('rsam_optimize_omniroute_model');
    } catch {
      /* ignore */
    }
  };

  const groupedOmniModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const filtered = q ? omniModels.filter((m) => m.toLowerCase().includes(q)) : omniModels;
    const groups = new Map<string, string[]>();
    for (const m of filtered) {
      const slashIdx = m.indexOf('/');
      const groupName = slashIdx > 0 ? m.slice(0, slashIdx) : 'Lainnya';
      const arr = groups.get(groupName) || [];
      arr.push(m);
      groups.set(groupName, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [omniModels, modelSearch]);

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
    if (fleet && totalFleetCount > 0 && selectedCount === 0) {
      setMsg('Pilih minimal 1 AP target untuk dioptimalkan.');
      setShowTargetPicker(true);
      return;
    }
    const targetIdsList = fleet && totalFleetCount > 0 ? Array.from(selectedApIds) : undefined;
    const confirmText = fleet
      ? isPartialFleet
        ? `Optimalkan ${selectedCount} AP terpilih dan kirim perubahan?\n\n${lockedCount} AP lainnya DIKUNCI (tidak akan discan maupun diubah konfigurasinya). Push dilakukan satu AP per satu AP. Radio AP terpilih bisa restart singkat (10–30 detik).`
        : `Optimalkan SEMUA AP (${totalFleetCount || 'armada'}) dan kirim perubahan?\n\nChannel dihitung bersama antar-AP. Push dilakukan satu AP per satu AP; kalau klien di sebuah AP turun melebihi batas, AP itu dikembalikan otomatis. Radio bisa restart singkat (klien terputus 10–30 detik per AP).`
      : 'Optimalkan AP ini dan kirim perbaikan ke AP?\n\nOptimasi channel tetap dikelola global (fleet), tetapi PERBAIKAN (radio mati, frequency=auto, channel di luar rencana) tetap dikirim. TX power & steering ikut. Radio bisa restart singkat (klien terputus 10–30 detik).';

    if (!dryRun && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.startOptimize(fleet ? undefined : deviceId, {
        history_window_min: historyMin,
        scan_duration: scanS,
        dry_run: dryRun,
        use_omniroute: useOmniroute,
        omniroute_model: useOmniroute && selectedOmniModel ? selectedOmniModel : undefined,
        fleet,
        device_ids: targetIdsList,
      });
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
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="font-bold text-slate-800">{fleet ? 'AI Optimize · Semua AP' : 'AI Optimize'}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${p.cls}`}>{p.text}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-indigo-200 bg-indigo-50 text-indigo-700">
            {compute?.engine ||
              (useOmniroute
                ? selectedOmniModel
                  ? `OmniRoute (${selectedOmniModel})`
                  : 'OmniRoute AI'
                : 'rrm_engine.py')}
          </span>
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
        {fleet
          ? 'Pilih seluruh armada atau hanya AP tertentu (AP yang tidak dipilih otomatis dikunci agar hasil optimasi sebelumnya tidak tertimpa). Tetap jalan walau halaman ditutup.'
          : 'Cek AP → riwayat → scan WLAN → hitung → kirim ke AP ini. Channel dikunci (dikelola global); yang dikirim hanya TX power & steering.'}
      </p>

      {/* OmniRoute Model Selector Bar */}
      {!running && (
        <div className="mt-3 border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 text-[11px] font-mono font-semibold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={useOmniroute}
                onChange={(e) => setUseOmniroute(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-600"
              />
              <span>Model OmniRoute AI</span>
              {omniModels.length > 0 && (
                <span className="text-[10px] font-normal text-slate-500">
                  ({omniModels.length} tersedia)
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={loadOmniModels}
              disabled={loadingModels}
              className="inline-flex items-center gap-1 text-[10.5px] font-mono text-blue-600 hover:text-blue-800 disabled:opacity-50"
              title="Muat ulang daftar model langsung dari server OmniRoute"
            >
              <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Sync Model</span>
            </button>
          </div>

          {useOmniroute ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative sm:w-44 shrink-0">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  aria-label="Filter daftar model OmniRoute"
                  placeholder="Cari model..."
                  className="w-full pl-7 pr-2 py-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-800 placeholder:text-slate-400 focus:border-blue-600"
                />
              </div>
              <select
                value={selectedOmniModel}
                onChange={(e) => handleSelectOmniModel(e.target.value)}
                aria-label="Pilih model OmniRoute untuk AI Optimize"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono font-semibold bg-white border border-slate-300 rounded-md text-slate-800 focus:border-blue-600"
              >
                {selectedOmniModel && !omniModels.includes(selectedOmniModel) && (
                  <option value={selectedOmniModel}>{selectedOmniModel}</option>
                )}
                {groupedOmniModels.length > 0 ? (
                  groupedOmniModels.map(([grp, models]) => (
                    <optgroup key={grp} label={`${grp} (${models.length})`}>
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  ))
                ) : (
                  <option value={selectedOmniModel || 'auto/best-chat'}>
                    {loadingModels
                      ? 'Memuat daftar model OmniRoute...'
                      : modelSearch
                      ? 'Tidak ada model yang cocok'
                      : selectedOmniModel || 'auto/best-chat'}
                  </option>
                )}
              </select>
            </div>
          ) : (
            <div className="text-[11px] font-mono text-slate-500">
              OmniRoute nonaktif: optimasi menggunakan kalkulasi matematis lokal <span className="font-semibold text-slate-700">rrm_engine.py</span>.
            </div>
          )}
        </div>
      )}

      {/* Selective AP Target Picker (Fleet mode) */}
      {fleet && totalFleetCount > 0 && !running && (
        <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden bg-white">
          <div className="px-3 py-2 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-[11px] font-mono flex-wrap">
              <Lock
                className={`w-3.5 h-3.5 shrink-0 ${
                  selectedCount === 0
                    ? 'text-rose-600'
                    : isPartialFleet
                    ? 'text-emerald-600'
                    : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              {selectedCount === 0 ? (
                <span className="font-semibold text-rose-700">
                  Belum ada AP dipilih (0 / {totalFleetCount})
                </span>
              ) : isPartialFleet ? (
                <span className="text-slate-700">
                  Target: <strong className="text-blue-700">{selectedCount} AP</strong> ·{' '}
                  <strong className="text-emerald-700">{lockedCount} AP lain dikunci</strong> (tidak akan diubah)
                </span>
              ) : (
                <span className="text-slate-700">
                  Target: <strong className="text-slate-900">Semua AP ({totalFleetCount})</strong>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowTargetPicker((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-mono font-semibold text-slate-700 transition-colors"
            >
              <span>{showTargetPicker ? 'Tutup Pemilih AP' : 'Pilih AP Target'}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showTargetPicker ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>

          {showTargetPicker && (
            <div className="p-3 border-t border-slate-200 space-y-2.5 bg-white">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" aria-hidden="true" />
                  <input
                    type="text"
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    placeholder="Cari nama AP, IP, atau ruangan..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-[11px] font-mono bg-slate-50 border border-slate-300 rounded-md text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-600"
                  />
                </div>
                <select
                  value={targetGroup}
                  onChange={(e) => setTargetGroup(e.target.value)}
                  aria-label="Filter lokasi AP target"
                  className="px-2.5 py-1.5 text-[11px] font-mono bg-slate-50 border border-slate-300 rounded-md text-slate-700"
                >
                  <option value="ALL">Semua Lokasi ({totalFleetCount})</option>
                  {targetGroups.map(([g, cnt]) => (
                    <option key={g} value={g}>
                      {g} ({cnt})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-mono">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedApIds((prev) => {
                        const next = new Set(prev);
                        filteredTargetDevices.forEach((d) => next.add(d.id));
                        return next;
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    Pilih Hasil Filter ({filteredTargetDevices.length})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedApIds(new Set(loadedDevices.filter((d) => d.online).map((d) => d.id)))
                    }
                    className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                  >
                    Online Saja ({loadedDevices.filter((d) => d.online).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedApIds(new Set())}
                    className="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700"
                  >
                    Kosongkan
                  </button>
                </div>
                <span className="text-[10.5px] text-slate-500">
                  Centang hanya AP yang ingin dioptimalkan
                </span>
              </div>

              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-md grid grid-cols-1 sm:grid-cols-2 divide-y divide-slate-100">
                {filteredTargetDevices.map((d) => {
                  const checked = selectedApIds.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-mono border-r border-slate-100 cursor-pointer transition-colors ${
                        checked ? 'bg-blue-50/40 text-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTargetAp(d.id)}
                          className="w-3.5 h-3.5 rounded accent-blue-600 shrink-0"
                        />
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            d.online ? 'bg-emerald-500' : 'bg-rose-400'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate font-semibold" title={`${d.name} (${d.host})`}>
                          {d.name}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {d.host}
                      </span>
                    </label>
                  );
                })}
                {filteredTargetDevices.length === 0 && (
                  <div className="col-span-2 py-4 text-center text-[11px] font-mono text-slate-400">
                    Tidak ada AP yang cocok dengan pencarian.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!running && (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={start}
            disabled={busy || (!fleet && !deviceId) || (fleet && totalFleetCount > 0 && selectedCount === 0)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 px-4 py-2 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>
              {fleet
                ? isPartialFleet
                  ? `Optimalkan ${selectedCount} AP Terpilih`
                  : job?.status === 'done'
                  ? `Optimalkan Ulang Semua AP (${totalFleetCount || 'Armada'})`
                  : `Optimalkan Semua AP (${totalFleetCount || 'Armada'})`
                : job?.status === 'done'
                ? 'Optimalkan Ulang'
                : 'Optimalkan AP Ini'}
            </span>
          </button>
          <span className="text-[11px] text-slate-500">
            5 langkah otomatis · bisa dibatalkan kapan saja
          </span>
        </div>
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

      {fleet && job && (() => {
        const aps = ((job.details as any)?.critical_aps as any[]) || [];
        if (aps.length === 0) return null;
        const planData = (job.details as any)?.plan || {};
        const resCh = (deliver?.result?.channel || []) as any[];
        const resTp = (deliver?.result?.txpower || []) as any[];
        const resSt = (deliver?.result?.steering || []) as any[];
        const resRm = (deliver?.result?.roam || []) as any[];
        const planCh = (planData?.dca?.changes || []) as any[];
        const planTp = (planData?.tpc || []) as any[];

        const rows = aps.map((ap: any) => {
          const scans = (((job.details as any)?.scan?.bands as any[]) || []).filter(
            (b: any) => b.device === ap.device
          );
          const ch = scans
            .map((b: any) => `${b.band} ch ${b.current_channel?.channel ?? '?'}`)
            .join(' · ');

          const chActs = resCh.filter((x: any) => x.device_id === ap.device);
          const tpActs = resTp.filter((x: any) => x.device_id === ap.device);
          const stActs = resSt.filter((x: any) => x.device_id === ap.device);
          const rmActs = resRm.filter((x: any) => x.device_id === ap.device);

          const actionItems: { label: string; detail?: string; ok: boolean }[] = [
            ...chActs.map((x: any) => ({
              label: `Channel ${x.interface || x.band}: ${x.from_freq ? `${x.from_freq}` : 'auto'} -> ${x.to_freq} MHz`,
              detail: x.error ? `Gagal: ${x.error}` : x.reason || (x.repair ? 'Perbaikan radio/kanal' : 'Optimasi interferensi'),
              ok: !!x.applied,
            })),
            ...tpActs.map((x: any) => ({
              label: `TX Power ${x.interface || x.band}: ${x.from_dbm ?? '?'} -> ${x.to_dbm} dBm`,
              detail: x.error ? `Gagal: ${x.error}` : x.reason || 'Penyesuaian daya pancar',
              ok: !!x.applied,
            })),
            ...stActs.map((x: any) => ({
              label: `Band Steering ${x.mac || ''}${x.interface ? ` (${x.interface})` : ''}`,
              detail: x.error ? `Gagal: ${x.error}` : `Atur batas sinyal ${x.signal_range || '5 GHz'} agar klien pindah ke 5 GHz`,
              ok: !!x.applied,
            })),
            ...rmActs.map((x: any) => ({
              label: `Paksa Roaming ${x.mac || ''}`,
              detail: x.error
                ? `Gagal: ${x.error}`
                : `${x.current_dbm ?? '?'} dBm, arahkan ke ${x.best_device || 'AP lebih dekat'}${x.best_dbm != null ? ` (${x.best_dbm} dBm)` : ''}`,
              ok: !!x.applied,
            })),
          ];

          const applied = actionItems.filter((a) => a.ok).length;
          const aborted = deliver?.aborted?.device === ap.device;
          const plannedForAp =
            planCh.filter((x: any) => x.device_id === ap.device).length +
            planTp.filter((x: any) => x.device_id === ap.device).length;
          const scanErr = scans.find((s: any) => s.error)?.error;

          let whyNoChange = '';
          if (ap.error) {
            whyNoChange = `Tidak terjangkau saat pemeriksaan: ${ap.error}`;
          } else if (aborted) {
            whyNoChange = `Push dihentikan otomatis: ${deliver.aborted.reason}`;
          } else if (applied === 0 && job.status !== 'running') {
            if (actionItems.length > 0) {
              whyNoChange = actionItems.map((a) => `${a.label} (${a.detail || 'gagal'})`).join('; ');
            } else if (deliver?.dry_run) {
              whyNoChange = plannedForAp > 0
                ? `Mode dry-run aktif: ada ${plannedForAp} rencana perubahan, tidak dikirim ke router.`
                : 'Mode dry-run aktif dan tidak ada perubahan yang diperlukan.';
            } else if (deliver?.aborted && plannedForAp > 0) {
              whyNoChange = `Ada ${plannedForAp} rencana perubahan, tetapi push berhenti lebih dulu di ${deliver.aborted.device} (${deliver.aborted.reason}).`;
            } else if (deliver?.skipped) {
              whyNoChange = `Dilewati: ${deliver.reason || 'tidak ada aksi yang lolos batas aman.'}`;
            } else if (deliver?.channel_skipped && plannedForAp > 0) {
              whyNoChange = `Dilewati: ${deliver.channel_skipped}`;
            } else if (scanErr) {
              whyNoChange = `Scan radio gagal: ${scanErr}`;
            } else if (deliver?.aborted) {
              whyNoChange = `Tidak ada perubahan untuk AP ini (dan push berhenti di ${deliver.aborted.device}).`;
            } else {
              const highIntf = scans.some((s: any) => s.interference_level === 'high');
              whyNoChange = highIntf
                ? 'Tidak ada kanal/TX power kandidat yang memberi penurunan interferensi melebihi batas minimum.'
                : 'Channel dan TX power sudah optimal berdasarkan hasil scan saat ini (interferensi rendah, tidak ada klien sticky/konflik).';
            }
          }

          const previewText =
            applied > 0
              ? actionItems
                  .filter((a) => a.ok)
                  .map((a) => a.label)
                  .join(' · ')
              : whyNoChange;

          const state = ap.error
            ? { t: 'gagal', c: 'text-rose-600', kind: 'err' }
            : aborted
            ? { t: 'dihentikan', c: 'text-rose-600', kind: 'err' }
            : applied
            ? { t: `${applied} aksi`, c: 'text-emerald-700', kind: 'ok' }
            : job.status === 'running'
            ? { t: 'menunggu', c: 'text-slate-500', kind: 'idle' }
            : { t: 'tanpa perubahan', c: 'text-slate-500', kind: 'idle' };
          return { ap, ch, state, actionItems, whyNoChange, previewText };
        });
        const appliedCount = rows.filter((r) => r.state.kind === 'ok').length;
        const errCount = rows.filter((r) => r.state.kind === 'err').length;
        const idleCount = rows.length - appliedCount - errCount;

        return (
          <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowApList((v) => !v)}
              aria-expanded={showApList}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-[11px] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 flex-wrap text-left">
                <span className="font-bold text-slate-800">Daftar Hasil AP ({rows.length})</span>
                <span className="text-slate-500">
                  {appliedCount > 0 && (
                    <span className="text-emerald-700 font-semibold">{appliedCount} berubah</span>
                  )}
                  {appliedCount > 0 && (idleCount > 0 || errCount > 0) ? ' · ' : ''}
                  {idleCount > 0 && <span>{idleCount} tanpa perubahan</span>}
                  {errCount > 0 && (
                    <>
                      {idleCount > 0 ? ' · ' : ''}
                      <span className="text-rose-600 font-semibold">{errCount} gagal/dihentikan</span>
                    </>
                  )}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 font-semibold text-blue-600 shrink-0">
                <span>{showApList ? 'Sembunyikan' : 'Tampilkan'}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showApList ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {showApList && (
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 border-t border-slate-200">
                {rows.map(({ ap, ch, state, actionItems, whyNoChange, previewText }) => {
                  const isOpen = expandedAp === ap.device;
                  return (
                    <div key={ap.device} className="text-[11px]">
                      <button
                        type="button"
                        onClick={() => setExpandedAp(isOpen ? null : ap.device)}
                        aria-expanded={isOpen}
                        className="w-full text-left flex items-start justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-800 truncate">{ap.name || ap.device}</div>
                          <div className="text-slate-500 truncate">
                            {ch || 'belum discan'}
                            {ap.clients != null ? ` · ${ap.clients} klien` : ''}
                            {ap.cpu_load != null ? ` · CPU ${ap.cpu_load}%` : ''}
                          </div>
                          {previewText && (
                            <div
                              className={`mt-1 text-[10.5px] leading-snug ${
                                state.kind === 'ok'
                                  ? 'text-emerald-700'
                                  : state.kind === 'err'
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                              } ${isOpen ? '' : 'truncate'}`}
                            >
                              {previewText}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                          <span className={`font-bold ${state.c}`}>{state.t}</span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 bg-slate-50/80 border-t border-slate-100 space-y-1.5">
                          {actionItems.length > 0 ? (
                            <ul className="space-y-1">
                              {actionItems.map((act, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-start justify-between gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-800">{act.label}</div>
                                    {act.detail && (
                                      <div className="text-[10.5px] text-slate-500">{act.detail}</div>
                                    )}
                                  </div>
                                  <span
                                    className={`text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded ${
                                      act.ok
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                    }`}
                                  >
                                    {act.ok ? 'Diterapkan' : 'Gagal'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-2 leading-relaxed">
                              <span className="font-semibold text-slate-800">Alasan: </span>
                              {whyNoChange || 'Menunggu proses optimasi selesai.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {compute?.compare && (() => {
        const cmp = compute.compare as any;
        const rrmSide = cmp.rrm || {};
        const omniSide = cmp.omniroute || {};
        const rrmWon = cmp.winner !== 'omniroute';
        const mathRejected = Boolean(cmp.omniroute_rejected_by_math);
        const fmtMw = (v: any) => {
          if (v == null || Number.isNaN(Number(v))) return '—';
          const n = Number(v);
          if (n === 0) return '0 mW';
          return `${n.toExponential(2)} mW`;
        };
        const renderChanges = (chs: any[], tpcs: any[]) => {
          if (!chs?.length && !tpcs?.length) {
            return <div className="text-[11px] text-slate-500 italic">Tidak ada perubahan — sudah optimal.</div>;
          }
          return (
            <ul className="space-y-1 text-[11px]">
              {(chs || []).map((c: any, idx: number) => (
                <li key={`ch-${idx}`} className="flex items-center justify-between gap-2 bg-slate-50 rounded px-2 py-1">
                  <span className="font-mono text-slate-700 truncate">
                    {c.device_id}/{c.interface}: {c.from_freq || 'auto'} → <b>{c.to_freq} MHz</b>
                    {c.fix_width ? ` (${c.fix_width})` : ''}
                  </span>
                  {c.relief_pct != null && c.relief_pct !== 0 && (
                    <span className={`font-bold shrink-0 ${c.relief_pct > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {c.relief_pct > 0 ? `-${c.relief_pct}%` : `+${Math.abs(c.relief_pct)}%`}
                    </span>
                  )}
                </li>
              ))}
              {(tpcs || []).map((t: any, idx: number) => (
                <li key={`tp-${idx}`} className="flex items-center justify-between gap-2 bg-slate-50 rounded px-2 py-1">
                  <span className="font-mono text-slate-700 truncate">
                    {t.device_id}/{t.interface}: TX {t.from_dbm ?? '?'} → <b>{t.to_dbm} dBm</b>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">TPC</span>
                </li>
              ))}
            </ul>
          );
        };

        return (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-bold text-slate-800">
                Compare Engine: <span className="font-mono">rrm_engine.py</span> vs OmniRoute AI
              </div>
              <span
                className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${
                  mathRejected
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : rrmWon
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}
              >
                {mathRejected
                  ? 'OmniRoute Ditolak (Interferensi Lebih Buruk) → Pakai rrm_engine.py'
                  : rrmWon
                  ? 'Dipakai: rrm_engine.py'
                  : `Dipakai: ${omniSide.engine || 'OmniRoute AI'}`}
              </span>
            </div>

            {cmp.verdict && (
              <div
                className={`px-3 py-1.5 text-[11px] border-b ${
                  mathRejected
                    ? 'bg-rose-50/70 text-rose-800 border-rose-100'
                    : 'bg-slate-50/50 text-slate-600 border-slate-100'
                }`}
              >
                {cmp.verdict}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {/* Left: rrm_engine.py */}
              <div className={`p-3 space-y-2 ${rrmWon ? 'bg-emerald-50/20' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-bold text-slate-800">rrm_engine.py (Matematis)</div>
                  {rrmWon && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Terpilih
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                    <div className="text-[10px] text-slate-400">Interferensi (mW)</div>
                    <div className="font-mono font-bold text-slate-800">
                      {fmtMw(rrmSide.cost_before_mw)} → {fmtMw(rrmSide.cost_after_mw)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                    <div className="text-[10px] text-slate-400">Gain Interferensi</div>
                    <div className={`font-mono font-bold ${(rrmSide.gain_pct ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {rrmSide.gain_pct ?? 0}%
                    </div>
                  </div>
                </div>
                {renderChanges(rrmSide.channel_changes, rrmSide.txpower_changes)}
              </div>

              {/* Right: OmniRoute AI */}
              <div className={`p-3 space-y-2 ${!rrmWon ? 'bg-indigo-50/20' : mathRejected ? 'bg-rose-50/20' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-bold text-slate-800 truncate">
                    {omniSide.engine || 'OmniRoute AI'}
                  </div>
                  {!rrmWon ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 shrink-0">
                      Terpilih
                    </span>
                  ) : mathRejected ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">
                      Ditolak Validasi
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                      Fallback
                    </span>
                  )}
                </div>

                {omniSide.available ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <div className="text-[10px] text-slate-400">Interferensi (mW)</div>
                        <div className="font-mono font-bold text-slate-800">
                          {fmtMw(omniSide.cost_before_mw)} → {fmtMw(omniSide.cost_after_mw)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <div className="text-[10px] text-slate-400">Gain Interferensi</div>
                        <div
                          className={`font-mono font-bold ${
                            (omniSide.gain_pct ?? 0) > 0
                              ? 'text-emerald-700'
                              : (omniSide.gain_pct ?? 0) < 0
                              ? 'text-rose-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {omniSide.gain_pct ?? 0}%
                        </div>
                      </div>
                    </div>
                    {renderChanges(omniSide.channel_changes, omniSide.txpower_changes)}
                    {omniSide.rationale && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 rounded px-2 py-1.5 leading-relaxed">
                        <span className="font-semibold text-slate-700">Alasan AI: </span>
                        {omniSide.rationale}
                      </div>
                    )}
                    {omniSide.rejected?.length > 0 && (
                      <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Ditolak filter legalitas: {omniSide.rejected.join('; ')}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                    <span className="font-semibold text-slate-700">Tidak tersedia: </span>
                    {omniSide.error || 'OmniRoute tidak aktif'}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
          {compute?.omniroute_rationale && (
            <div className="mt-1.5 text-[11px] text-emerald-900/90 leading-relaxed">
              <span className="font-bold">OmniRoute:</span> {compute.omniroute_rationale}
            </div>
          )}
          <button
            onClick={rollback}
            disabled={busy}
            className="mt-2 text-[11px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" /> Batalkan perubahan optimasi terakhir
          </button>
          {deliver?.aborted && (
            <div className="mt-2 text-[11px] font-semibold text-rose-700">
              Push dihentikan di {deliver.aborted.device}: {deliver.aborted.reason}
            </div>
          )}
        </div>
      )}

      {job?.status === 'error' && (
        <div className="mt-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {job.error || 'Optimasi gagal'}
        </div>
      )}

      {msg && <div className="mt-2 text-[11px] text-slate-600">{msg}</div>}

      {showDetail && job && (
        <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5 text-[11px] text-slate-600 max-h-96 overflow-y-auto pr-1">
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
            {compute?.used_omniroute
              ? `sumber: ${compute.engine} (LLM OmniRoute, divalidasi terhadap whitelist frekuensi legal router)`
              : `sumber: ${compute?.engine || 'rrm_engine.py'} — model biaya deterministik: cost(f) = noise(f) + Σ overlap×10^(RSSI/10)`}
          </div>
          {deliver && !deliver.dry_run && !deliver.skipped && (
            <div>
              • Kirim: {deliver.applied_actions ?? 0} aksi, gain {deliver.gain_pct ?? 0}%
              {deliver.channel_skipped && <span className="text-amber-600"> (channel dilewati: {deliver.channel_skipped})</span>}
              {deliver.ai?.applied != null &&
                `, AI ${deliver.ai.applied}/${deliver.ai.applied + (deliver.ai.failed || 0)} ok`}
              {job.run_id && <span className="text-slate-400"> · {job.run_id}</span>}
            </div>
          )}
          {deliver?.dry_run && <div>• Kirim: dry-run, tidak ada perubahan</div>}
          {deliver?.skipped && <div>• Kirim: dilewati — {deliver.reason}</div>}
          {((deliver?.result?.roam as any[]) || []).length > 0 && (
            <div>
              {((deliver.result.roam as any[]) || []).map((r: any, i: number) => (
                <div key={`roam-${i}`} className={r.applied ? 'text-slate-600' : 'text-rose-600'}>
                  • Roam {r.mac} di {r.device_id}: {r.current_dbm} dBm → blokir ≤ {r.signal_range?.split('..')[1]} dBm
                  {r.best_device ? `, arahkan ke ${r.best_device} (${r.best_dbm} dBm)` : ''}
                  {r.applied ? '' : ` — gagal: ${r.error}`}
                </div>
              ))}
            </div>
          )}
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
              ['omni', 'Gunakan OmniRoute AI', useOmniroute, setUseOmniroute],
              ['dry', 'Dry-run (jangan kirim)', dryRun, setDryRun],
              ['ch', 'Atur channel', cfg?.apply_channel ?? true, (v: boolean) => saveCfg({ apply_channel: v })],
              ['tp', 'Atur tx-power', cfg?.apply_txpower ?? false, (v: boolean) => saveCfg({ apply_txpower: v })],
              [
                'st',
                'Roaming/steering',
                cfg?.apply_steering ?? false,
                (v: boolean) => saveCfg({ apply_steering: v }),
              ],
              [
                'rm',
                'Paksa roaming (blokir MAC di AP salah)',
                cfg?.apply_roam ?? false,
                (v: boolean) => saveCfg({ apply_roam: v }),
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
