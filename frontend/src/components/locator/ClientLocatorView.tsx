import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Radio,
  Wifi,
  Smartphone,
  Tablet,
  Laptop,
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Tag,
  MapPin,
  Filter,
  CheckCircle2,
  SlidersHorizontal,
  Compass,
  Footprints,
} from 'lucide-react';
import { ClientPresence, LocatorStats } from '../../types';
import { api } from '../../api/client';
import { ClientTrailDrawer } from './ClientTrailDrawer';

interface ClientLocatorViewProps {
  onSelectFloorMap?: (floorId: string, deviceId: string) => void;
}

export const ClientLocatorView: React.FC<ClientLocatorViewProps> = ({ onSelectFloorMap }) => {
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [stats, setStats] = useState<LocatorStats | null>(null);
  const [clients, setClients] = useState<ClientPresence[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('online');
  const [bandFilter, setBandFilter] = useState<'all' | '2.4 GHz' | '5 GHz'>('all');
  const [roamedOnly, setRoamedOnly] = useState(false);
  const [weakSignalOnly, setWeakSignalOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'last_seen' | 'signal' | 'roams' | 'name'>('last_seen');

  // Selected client for Roaming Trail Drawer
  const [selectedMacForTrail, setSelectedMacForTrail] = useState<string | null>(null);

  // Alias modal state
  const [editingClient, setEditingClient] = useState<ClientPresence | null>(null);
  const [aliasName, setAliasName] = useState('');
  const [aliasBrand, setAliasBrand] = useState('');
  const [aliasSeries, setAliasSeries] = useState('');
  const [aliasNotes, setAliasNotes] = useState('');
  const [isSavingAlias, setIsSavingAlias] = useState(false);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const res = await api.getClientLocatorStats();
      setStats(res);
    } catch (err) {
      console.error('Failed to load locator stats:', err);
    }
  }, []);

  // Load clients list
  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getClientLocator({
        query: searchQuery.trim(),
        status: statusFilter,
        band: bandFilter,
        roamed_only: roamedOnly,
        weak_signal: weakSignalOnly,
        sort: sortBy,
        limit: 150,
      });
      setClients(res.clients || []);
      setTotalCount(res.total || 0);
    } catch (err) {
      console.error('Failed to load locator clients:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, bandFilter, roamedOnly, weakSignalOnly, sortBy]);

  // Initial load
  useEffect(() => {
    loadStats();
    loadClients();
  }, [loadStats, loadClients]);

  // Background refresh every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      loadStats();
      // Silently update list without big loading spinner
      api.getClientLocator({
        query: searchQuery.trim(),
        status: statusFilter,
        band: bandFilter,
        roamed_only: roamedOnly,
        weak_signal: weakSignalOnly,
        sort: sortBy,
        limit: 150,
      }).then((res) => {
        setClients(res.clients || []);
        setTotalCount(res.total || 0);
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [loadStats, searchQuery, statusFilter, bandFilter, roamedOnly, weakSignalOnly, sortBy]);

  // Manual Trigger Fleet Scan Now
  const handleScanNow = async () => {
    setPolling(true);
    try {
      await api.pollClientLocatorNow();
      await loadStats();
      await loadClients();
    } catch (err) {
      console.error('Manual fleet poll failed:', err);
    } finally {
      setPolling(false);
    }
  };

  // Open Edit Alias modal
  const handleOpenAliasModal = (client: ClientPresence) => {
    setEditingClient(client);
    setAliasName(client.device_name || '');
    setAliasBrand(client.brand || '');
    setAliasSeries(client.model_series || '');
    setAliasNotes('');
  };

  // Save Alias
  const handleSaveAlias = async () => {
    if (!editingClient) return;
    setIsSavingAlias(true);
    try {
      await api.setClientAlias({
        mac: editingClient.mac,
        name: aliasName.trim(),
        brand: aliasBrand.trim(),
        model_series: aliasSeries.trim(),
        vendor: editingClient.vendor || '',
        notes: aliasNotes.trim(),
      });
      setEditingClient(null);
      loadClients();
    } catch (err) {
      alert('Gagal menyimpan label klien: ' + err);
    } finally {
      setIsSavingAlias(false);
    }
  };

  const getDeviceIcon = (type?: string) => {
    switch (type) {
      case 'tablet':
        return <Tablet className="w-4 h-4 text-indigo-600" />;
      case 'laptop':
        return <Laptop className="w-4 h-4 text-sky-600" />;
      case 'mobile':
      case 'phone':
        return <Smartphone className="w-4 h-4 text-blue-600" />;
      default:
        return <Wifi className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Top Banner / Title */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-600">
              <Footprints className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Pelacak Lokasi &amp; Riwayat Roaming Klien
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                  NOC Live Telemetri
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Pantau posisi fisik tablet dokter, troli USG/EKG, scanner farmasi, dan deteksi otomatis perpindahan AP di seluruh rumah sakit.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleScanNow}
            disabled={polling}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            title="Scan ulang seluruh armada AP sekarang"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${polling ? 'animate-spin' : ''}`} />
            <span>{polling ? 'Memindai 81 AP...' : 'Scan Armada Sekarang'}</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium block">Klien Online Saat Ini</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-slate-900">{stats?.online_now ?? '-'}</span>
            <span className="text-[11px] text-slate-400">/ {stats?.total_tracked ?? '-'} total</span>
          </div>
          <span className="text-[10px] text-emerald-600 flex items-center gap-1 mt-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Aktif di armada AP
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium block">Peristiwa Roaming Hari Ini</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-blue-700">{stats?.roams_today ?? 0}</span>
            <span className="text-[11px] text-slate-500">perpindahan</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            {stats?.roamed_clients_count ?? 0} perangkat pernah roam
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium block">Sinyal Lemah (&lt; -75 dBm)</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${(stats?.weak_signal_count || 0) > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {stats?.weak_signal_count ?? 0}
            </span>
            <span className="text-[11px] text-slate-500">klien</span>
          </div>
          <span className="text-[10px] text-amber-700 block mt-1 font-medium">
            Rawan putus / butuh AP dekat
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium block">Spektrum Frekuensi</span>
          <div className="flex items-center gap-3 mt-1.5 text-xs font-mono">
            <div>
              <span className="text-slate-500 text-[10px] block">2.4 GHz</span>
              <span className="font-bold text-slate-800">{stats?.band_distribution?.['2.4 GHz'] ?? 0}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-blue-600 text-[10px] block font-semibold">5 GHz</span>
              <span className="font-bold text-blue-700">{stats?.band_distribution?.['5 GHz'] ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs col-span-2 lg:col-span-1">
          <span className="text-xs text-slate-500 font-medium block">AP Terpadat (Klien Terbanyak)</span>
          <div className="mt-1">
            {stats?.top_aps && stats.top_aps.length > 0 ? (
              <div className="text-xs truncate font-medium text-slate-800 flex items-center justify-between">
                <span className="truncate" title={stats.top_aps[0].ap_name}>
                  {stats.top_aps[0].ap_name}
                </span>
                <span className="font-mono font-bold text-blue-600 shrink-0 ml-1">
                  {stats.top_aps[0].count} klien
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-400">-</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Beban seimbang antar AP
          </span>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari MAC, IP, Nama Klien, Brand (Samsung, Apple, Xiaomi), atau AP..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-mono placeholder:font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            )}
          </div>

          {/* Quick Filter Toggles */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-blue-600"
            >
              <option value="online">Status: Online</option>
              <option value="all">Status: Semua (Online &amp; Riwayat)</option>
              <option value="offline">Status: Offline / Lepas</option>
            </select>

            {/* Band filter */}
            <select
              value={bandFilter}
              onChange={(e: any) => setBandFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-blue-600"
            >
              <option value="all">Band: Semua</option>
              <option value="5 GHz">Band: 5 GHz Cepat</option>
              <option value="2.4 GHz">Band: 2.4 GHz Jauh</option>
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-blue-600"
            >
              <option value="last_seen">Urutkan: Terakhir Terlihat</option>
              <option value="roams">Urutkan: Paling Sering Roam</option>
              <option value="signal">Urutkan: Sinyal Terbaik</option>
              <option value="name">Urutkan: Nama Perangkat</option>
            </select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100 flex-wrap text-xs">
          <span className="text-[11px] text-slate-400 font-medium">Filter Cepat:</span>

          <button
            onClick={() => setRoamedOnly(!roamedOnly)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              roamedOnly
                ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Footprints className="w-3.5 h-3.5" />
            <span>Pernah Roaming (&gt; 0)</span>
          </button>

          <button
            onClick={() => setWeakSignalOnly(!weakSignalOnly)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              weakSignalOnly
                ? 'bg-amber-600 text-white font-semibold shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Sinyal Lemah (&lt; -75 dBm)</span>
          </button>

          <div className="ml-auto text-xs text-slate-500 font-mono">
            Ditemukan: <b className="text-slate-800">{totalCount}</b> perangkat
          </div>
        </div>
      </div>

      {/* Client Table / Grid */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Perangkat &amp; Identitas</th>
                <th className="py-3 px-4">MAC &amp; IP Address</th>
                <th className="py-3 px-4">AP Terhubung (Lokasi)</th>
                <th className="py-3 px-4">Band &amp; Link Rate</th>
                <th className="py-3 px-4">Sinyal (RSSI)</th>
                <th className="py-3 px-4">Riwayat Roam</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Memuat data pelacak klien...
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    Tidak ada perangkat yang cocok dengan kriteria pencarian/filter di atas.
                  </td>
                </tr>
              ) : (
                clients.map((c) => {
                  const hasRoamed = c.roam_count > 0;
                  const isWeak = c.signal_dbm != null && c.signal_dbm < -75;

                  return (
                    <tr
                      key={c.mac}
                      className="hover:bg-slate-50/90 transition-colors group"
                    >
                      {/* Device & Identity */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-slate-100 border border-slate-200/80 text-slate-700 shrink-0">
                            {getDeviceIcon(c.device_type)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 truncate">
                                {c.device_name}
                              </span>
                              {Boolean(c.is_custom_name) && (
                                <span className="px-1 py-0.2 text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded">
                                  Label
                                </span>
                              )}
                              {c.brand === 'Privat' && (
                                <span
                                  className="px-1.5 py-0.2 text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded"
                                  title="Perangkat mengacak MAC (fitur privasi iOS/Android/Windows 11). Identitas asli hanya bisa diketahui dengan memberi label manual."
                                >
                                  MAC Acak
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {c.vendor || c.brand || 'MikroTik Wi-Fi Client'}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* MAC & IP */}
                      <td className="py-3 px-4 font-mono">
                        <div className="font-semibold text-slate-800">{c.mac}</div>
                        <div className="text-[11px] text-slate-500">{c.ip || 'DHCP / Auto'}</div>
                      </td>

                      {/* AP Connected */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                          <Radio className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span className="truncate max-w-[200px]" title={c.ap_name}>
                            {c.ap_name}
                          </span>
                        </div>
                        {c.has_floor_map && c.floor_name ? (
                          <div className="flex items-center gap-1 text-[11px] text-rose-600 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{c.floor_name}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Uptime: {c.uptime || '-'}
                          </div>
                        )}
                      </td>

                      {/* Band & Link Rate */}
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 rounded font-semibold ${
                              c.band === '5 GHz'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {c.band || '-'}
                          </span>
                          <span className="text-slate-400">{c.interface}</span>
                        </div>
                        <div className="text-slate-500 text-[10px] truncate mt-0.5" title={c.tx_rate}>
                          Tx: {c.tx_rate || '-'}
                        </div>
                      </td>

                      {/* RSSI Signal */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono font-bold text-xs ${
                              c.signal_dbm == null
                                ? 'text-slate-400'
                                : c.signal_dbm >= -65
                                ? 'text-emerald-700'
                                : c.signal_dbm >= -75
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {c.signal_dbm != null ? `${c.signal_dbm} dBm` : '-'}
                          </span>
                        </div>
                        {/* Mini signal bar */}
                        {c.signal_dbm != null && (
                          <div className="w-20 bg-slate-200 h-1 rounded-full mt-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                c.signal_dbm >= -65
                                  ? 'bg-emerald-500'
                                  : c.signal_dbm >= -75
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(10, (c.signal_dbm + 100) * 1.6))}%`,
                              }}
                            />
                          </div>
                        )}
                      </td>

                      {/* Roam Count */}
                      <td className="py-3 px-4">
                        {hasRoamed ? (
                          <button
                            onClick={() => setSelectedMacForTrail(c.mac)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
                            title="Klik untuk membuka jejak perpindahan"
                          >
                            <Footprints className="w-3 h-3 text-blue-600" />
                            <span>{c.roam_count}× Roam</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px] font-mono">
                            0× (Stabil)
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => setSelectedMacForTrail(c.mac)}
                          className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                          title="Lihat riwayat jejak roaming klien ini"
                        >
                          <Footprints className="w-3.5 h-3.5" />
                          <span>Jejak</span>
                        </button>

                        <button
                          onClick={() => handleOpenAliasModal(c)}
                          className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                          title="Beri label / alias medis untuk perangkat ini"
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </button>

                        {c.has_floor_map && c.floor_id && onSelectFloorMap && (
                          <button
                            onClick={() => onSelectFloorMap(c.floor_id!, c.ap_id)}
                            className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title={`Tampilkan AP di Denah ${c.floor_name || ''}`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roaming Trail Drawer */}
      <ClientTrailDrawer
        mac={selectedMacForTrail}
        onClose={() => setSelectedMacForTrail(null)}
        onOpenAliasModal={handleOpenAliasModal}
        onSelectFloorMap={onSelectFloorMap}
      />

      {/* Edit Alias Modal */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Beri Label / Alias Klien Medis
                </h3>
              </div>
              <button
                onClick={() => setEditingClient(null)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-500 block mb-1">MAC Address (Terkunci)</label>
                <input
                  type="text"
                  disabled
                  value={editingClient.mac}
                  className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-600"
                />
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">
                  Nama / Label Klien (Contoh: Tablet Dokter IGD 1, Troli USG)
                </label>
                <input
                  type="text"
                  value={aliasName}
                  onChange={(e) => setAliasName(e.target.value)}
                  placeholder="Misal: Tablet Dokter Poli 1"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 block mb-1">Brand</label>
                  <input
                    type="text"
                    value={aliasBrand}
                    onChange={(e) => setAliasBrand(e.target.value)}
                    placeholder="Samsung / Apple / dsb."
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="text-slate-600 block mb-1">Model / Seri</label>
                  <input
                    type="text"
                    value={aliasSeries}
                    onChange={(e) => setAliasSeries(e.target.value)}
                    placeholder="Galaxy Tab A8 / dsb."
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-600 block mb-1">Catatan Tambahan (Opsional)</label>
                <textarea
                  rows={2}
                  value={aliasNotes}
                  onChange={(e) => setAliasNotes(e.target.value)}
                  placeholder="Inventaris IT / milik dr. Sp.PD"
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSavingAlias}
                onClick={handleSaveAlias}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer disabled:opacity-60"
              >
                {isSavingAlias ? 'Menyimpan...' : 'Simpan Label'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
