import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ruler,
  X,
  RefreshCw,
  Search,
  AlertTriangle,
  Radio,
  ArrowLeftRight,
  ChevronDown,
  Radar,
} from 'lucide-react';
import { api } from '../api/client';
import { FleetDevice } from '../types';
import { ActionProgressModal, useActionProgress } from './ActionProgressModal';

interface FleetRfDistanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  fleet: FleetDevice[];
}

type BandFilter = 'all' | '2g' | '5g';
type EnvProfile = 'corridor' | 'hospital' | 'heavy_wall';
type ProxFilter = 'all' | 'too_close' | 'co_channel' | 'ideal' | 'far';
type ViewTab = 'pairs' | 'per_ap';

export const FleetRfDistanceModal: React.FC<FleetRfDistanceModalProps> = ({
  isOpen,
  onClose,
  fleet,
}) => {
  const [band, setBand] = useState<BandFilter>('all');
  const [env, setEnv] = useState<EnvProfile>('hospital');
  const [proxFilter, setProxFilter] = useState<ProxFilter>('all');
  const [viewTab, setViewTab] = useState<ViewTab>('pairs');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getFleetRfDistances>> | null>(null);
  const [expandedAp, setExpandedAp] = useState<string | null>(null);
  const [scanTargetId, setScanTargetId] = useState<string>('');
  const { progress: actionProgress, runAction, closeProgress } = useActionProgress();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFleetRfDistances({ band, env, window_h: 168 });
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat estimasi jarak RF antar-AP');
    } finally {
      setLoading(false);
    }
  }, [band, env]);

  useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && actionProgress.status === 'idle') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, actionProgress.status]);

  const filteredPairs = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.pairs.filter((p) => {
      if (proxFilter === 'too_close' && p.proximity !== 'too_close') return false;
      if (proxFilter === 'ideal' && p.proximity !== 'ideal') return false;
      if (proxFilter === 'far' && p.proximity !== 'far') return false;
      if (proxFilter === 'co_channel' && !p.co_channel) return false;
      if (!q) return true;
      return (
        p.ap_a_name.toLowerCase().includes(q) ||
        p.ap_b_name.toLowerCase().includes(q) ||
        p.ap_a_host.toLowerCase().includes(q) ||
        p.ap_b_host.toLowerCase().includes(q) ||
        p.ap_a_group.toLowerCase().includes(q) ||
        p.ap_b_group.toLowerCase().includes(q)
      );
    });
  }, [data, search, proxFilter]);

  const filteredPerAp = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.per_ap.filter((a) => {
      if (proxFilter === 'too_close' && a.too_close_count === 0) return false;
      if (proxFilter === 'co_channel' && a.co_channel_count === 0) return false;
      if (proxFilter === 'ideal' && a.nearest?.proximity !== 'ideal') return false;
      if (proxFilter === 'far' && a.nearest?.proximity !== 'far') return false;
      if (!q) return true;
      return (
        a.device_name.toLowerCase().includes(q) ||
        a.host.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q) ||
        (a.nearest?.peer_name || '').toLowerCase().includes(q)
      );
    });
  }, [data, search, proxFilter]);

  const handleScanOne = async () => {
    if (!scanTargetId) return;
    const target = fleet.find((d) => d.id === scanTargetId);
    const label = target?.name || scanTargetId;
    const res = await runAction(
      {
        loadingTitle: 'Memindai Tetangga RF...',
        loadingMessage: `Menjalankan scan RF pada "${label}" (2.4 & 5 GHz ~10 detik) untuk menghitung jarak AP tetangga...`,
        successTitle: 'Scan RF Selesai!',
        errorTitle: 'Gagal Memindai RF',
      },
      async () => {
        const scanRes = await api.scanFleetRfDistances({
          device_ids: [scanTargetId],
          band: band === 'all' ? 'all' : band,
          duration: 5,
        });
        if (!scanRes.ok) {
          const msg = scanRes.results[0]?.errors?.join('; ') || 'AP tidak dapat dipindai';
          throw new Error(msg);
        }
        await loadData();
      }
    );
    if (res.ok) {
      setScanTargetId('');
    }
  };

  if (!isOpen) return null;

  const proxBadge = (prox: 'too_close' | 'ideal' | 'far') => {
    if (prox === 'too_close')
      return {
        label: 'Terlalu Dekat',
        cls: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    if (prox === 'ideal')
      return {
        label: 'Ideal',
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    return {
      label: 'Jauh / Terhalang',
      cls: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  };

  const onlineDevices = fleet.filter((d) => d.online);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      onClick={() => actionProgress.status === 'idle' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Estimasi Jarak & Tetangga RF Antar-AP"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl max-h-[90vh] bg-white border border-slate-200 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <Ruler className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 font-mono truncate">
                Estimasi Jarak &amp; Tetangga RF Antar-AP
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                Dihitung otomatis dari RSSI scan RF antar-AP (Log-Distance Path Loss) tanpa perlu input koordinat denah.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-mono text-slate-700"
              title="Muat ulang data jarak RF"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} aria-hidden="true" />
              <span>Muat Ulang</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup jendela estimasi jarak AP"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Summary Telemetry Strip */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-x divide-slate-200 border-b border-slate-200 bg-white shrink-0 text-xs font-mono">
            <div className="px-4 py-2.5">
              <div className="text-[10px] text-slate-500 uppercase">Pasangan AP Terdeteksi</div>
              <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                {data.summary.total_pairs}
              </div>
            </div>
            <div className={`px-4 py-2.5 ${data.summary.too_close_pairs > 0 ? 'bg-rose-50/40' : ''}`}>
              <div className="text-[10px] text-slate-500 uppercase">Terlalu Dekat (&lt;7 m)</div>
              <div className="text-base font-bold text-rose-700 tabular-nums mt-0.5">
                {data.summary.too_close_pairs}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="text-[10px] text-slate-500 uppercase">Jarak Ideal (7–18 m)</div>
              <div className="text-base font-bold text-emerald-700 tabular-nums mt-0.5">
                {data.summary.ideal_pairs}
              </div>
            </div>
            <div className={`px-4 py-2.5 ${data.summary.co_channel_pairs > 0 ? 'bg-amber-50/40' : ''}`}>
              <div className="text-[10px] text-slate-500 uppercase">Konflik Co-Channel</div>
              <div className="text-base font-bold text-amber-700 tabular-nums mt-0.5">
                {data.summary.co_channel_pairs}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 px-4 py-2.5">
              <div className="text-[10px] text-slate-500 uppercase">Cakupan Scan AP</div>
              <div className="text-base font-bold text-blue-700 tabular-nums mt-0.5">
                {data.summary.scanned_devices} / {data.summary.total_devices}
              </div>
            </div>
          </div>
        )}

        {/* Controls & Calibration Strip */}
        <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative w-52">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama AP / IP..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-800 placeholder:text-slate-400 focus:border-blue-600"
              />
            </div>

            {/* Band selector */}
            <div className="flex items-center p-0.5 bg-slate-200/70 rounded-md border border-slate-200 text-[11px] font-mono">
              {(['all', '2g', '5g'] as BandFilter[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBand(b)}
                  className={`px-2 py-1 rounded transition-colors ${
                    band === b ? 'bg-white text-slate-900 font-bold border border-slate-200' : 'text-slate-600 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  {b === 'all' ? 'Semua' : b === '2g' ? '2.4 GHz' : '5 GHz'}
                </button>
              ))}
            </div>

            {/* Environment path-loss calibration */}
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as EnvProfile)}
              aria-label="Kalibrasi redaman dinding gedung"
              className="px-2.5 py-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-800"
              title="Kalibrasi eksponen redaman gedung (Path Loss Exponent n)"
            >
              <option value="corridor">Koridor Terbuka (n = 2.4)</option>
              <option value="hospital">Gedung RS Bertembok (n = 3.0)</option>
              <option value="heavy_wall">Tembok Beton Tebal (n = 3.5)</option>
            </select>

            {/* Proximity filter */}
            <select
              value={proxFilter}
              onChange={(e) => setProxFilter(e.target.value as ProxFilter)}
              aria-label="Filter kedekatan jarak AP"
              className="px-2.5 py-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-800"
            >
              <option value="all">Semua Status Jarak</option>
              <option value="too_close">Terlalu Dekat (&lt;7 m)</option>
              <option value="co_channel">Konflik Co-Channel</option>
              <option value="ideal">Ideal (7–18 m)</option>
              <option value="far">Jauh (&gt;18 m)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View switch */}
            <div className="flex items-center p-0.5 bg-slate-200/70 rounded-md border border-slate-200 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setViewTab('pairs')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  viewTab === 'pairs' ? 'bg-white text-blue-700 font-bold border border-slate-200' : 'text-slate-600 border border-transparent'
                }`}
              >
                Pasangan AP ({filteredPairs.length})
              </button>
              <button
                type="button"
                onClick={() => setViewTab('per_ap')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  viewTab === 'per_ap' ? 'bg-white text-blue-700 font-bold border border-slate-200' : 'text-slate-600 border border-transparent'
                }`}
              >
                Per AP ({filteredPerAp.length})
              </button>
            </div>

            {/* Quick scan 1 AP on-demand */}
            <div className="flex items-center gap-1">
              <select
                value={scanTargetId}
                onChange={(e) => setScanTargetId(e.target.value)}
                aria-label="Pilih AP untuk scan RF on-demand"
                className="px-2 py-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-700 max-w-[180px]"
              >
                <option value="">Pindai 1 AP...</option>
                {onlineDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleScanOne}
                disabled={!scanTargetId}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[11px] font-mono font-semibold"
                title="Scan RF live untuk memperbarui daftar tetangga AP terpilih"
              >
                <Radar className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Scan</span>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {loading && !data ? (
            <div className="py-16 text-center text-xs font-mono text-slate-500">
              <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-600" aria-hidden="true" />
              Menghitung estimasi jarak antar-AP dari riwayat scan RF...
            </div>
          ) : viewTab === 'pairs' ? (
            filteredPairs.length === 0 ? (
              <div className="py-16 text-center text-xs font-mono text-slate-500">
                Belum ada pasangan AP yang cocok dengan filter. Gunakan "Scan" atau jalankan AI Optimize agar data scan RF terisi.
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 text-[10px] uppercase border-b border-slate-200 z-10">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2">AP A</th>
                    <th className="py-2.5 px-2">AP B (Tetangga)</th>
                    <th className="py-2.5 px-2">Band &amp; Kanal</th>
                    <th className="py-2.5 px-2">Sinyal Antar-AP</th>
                    <th className="py-2.5 px-2 text-right">Estimasi Jarak</th>
                    <th className="py-2.5 pl-2 pr-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {filteredPairs.map((p, idx) => {
                    const badge = proxBadge(p.proximity);
                    return (
                      <tr
                        key={`${p.ap_a_id}-${p.ap_b_id}-${p.band}-${idx}`}
                        className={`transition-colors ${
                          p.proximity === 'too_close'
                            ? 'bg-rose-50/25 hover:bg-rose-50/50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <div className="font-bold text-slate-900">{p.ap_a_name}</div>
                          <div className="text-[10px] text-slate-500">{p.ap_a_host}</div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="font-bold text-slate-900">{p.ap_b_name}</div>
                          <div className="text-[10px] text-slate-500">{p.ap_b_host}</div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                p.band === '5g'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {p.band === '5g' ? '5 GHz' : '2.4 GHz'}
                            </span>
                            <span className="text-[11px] text-slate-600">{p.channel_label}</span>
                          </div>
                          {p.co_channel && (
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Co-Channel
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap tabular-nums">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{p.rssi_dbm} dBm</span>
                            {p.bidirectional && (
                              <span
                                className="inline-flex items-center text-[9.5px] px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                                title={`Saling mendengar 2 arah: A→B ${p.rssi_ab} dBm, B→A ${p.rssi_ba} dBm`}
                              >
                                <ArrowLeftRight className="w-2.5 h-2.5" aria-hidden="true" />
                              </span>
                            )}
                          </div>
                          {p.bidirectional && (
                            <div className="text-[10px] text-slate-400">
                              {p.rssi_ab} / {p.rssi_ba} dBm
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap tabular-nums">
                          <span
                            className={`text-sm font-bold ${
                              p.proximity === 'too_close'
                                ? 'text-rose-700'
                                : p.proximity === 'ideal'
                                ? 'text-emerald-700'
                                : 'text-slate-600'
                            }`}
                          >
                            ~{p.distance_m} m
                          </span>
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredPerAp.map((ap) => {
                const isOpenRow = expandedAp === ap.device_id;
                const nearestBadge = ap.nearest ? proxBadge(ap.nearest.proximity) : null;
                return (
                  <div key={ap.device_id} className="bg-white">
                    <button
                      type="button"
                      onClick={() => setExpandedAp(isOpenRow ? null : ap.device_id)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left text-xs font-mono hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Radio className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{ap.device_name}</div>
                          <div className="text-[10px] text-slate-500">
                            {ap.host} · {ap.neighbour_count} tetangga RF
                            {ap.too_close_count > 0 && (
                              <span className="text-rose-700 font-bold"> · {ap.too_close_count} terlalu dekat</span>
                            )}
                            {ap.co_channel_count > 0 && (
                              <span className="text-amber-700 font-bold"> · {ap.co_channel_count} co-channel</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {ap.nearest ? (
                          <>
                            <span className="text-[11px] text-slate-600 hidden sm:inline">
                              Terdekat: <strong className="text-slate-900">{ap.nearest.peer_name}</strong>
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold border tabular-nums ${nearestBadge?.cls}`}>
                              ~{ap.nearest.distance_m} m ({ap.nearest.rssi_dbm} dBm)
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">Tidak ada tetangga terdeteksi</span>
                        )}
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpenRow ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </div>
                    </button>
                    {isOpenRow && ap.neighbours.length > 0 && (
                      <div className="px-4 pb-3 pt-1 bg-slate-50/70 border-t border-slate-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border border-slate-200 rounded-md overflow-hidden bg-white">
                          {ap.neighbours.map((nb, idx) => {
                            const bdg = proxBadge(nb.proximity);
                            return (
                              <div
                                key={`${nb.peer_id}-${nb.band}-${idx}`}
                                className="px-3 py-2 border-b border-r border-slate-200/80 flex items-center justify-between gap-2 text-[11px] font-mono"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-800 truncate">{nb.peer_name}</div>
                                  <div className="text-[10px] text-slate-500">
                                    {nb.band === '5g' ? '5 GHz' : '2.4 GHz'} · {nb.rssi_dbm} dBm
                                    {nb.co_channel ? ' · Co-Ch' : ''}
                                  </div>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 tabular-nums ${bdg.cls}`}>
                                  ~{nb.distance_m} m
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Honest Technical Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-[10.5px] font-mono text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-1 shrink-0">
          <span>
            Catatan: Jarak diestimasi dari RSSI (Log-Distance Path Loss, n = {data?.path_loss_n ?? 3.0}). Tembok beton/pintu radiologi membuat jarak tampak lebih jauh dari meteran fisik.
          </span>
          {data && data.summary.unscanned_devices > 0 && (
            <span className="text-slate-600 shrink-0">
              {data.summary.unscanned_devices} AP belum memiliki riwayat scan RF
            </span>
          )}
        </div>
      </div>

      <ActionProgressModal state={actionProgress} onClose={closeProgress} />
    </div>
  );
};
