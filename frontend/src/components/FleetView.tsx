import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Filter,
  Layers,
  Server,
  Terminal,
  CheckSquare,
  Square,
  RefreshCw,
  AlertTriangle,
  Wifi,
  Cpu,
  ChevronDown,
  SlidersHorizontal,
  X,
  LayoutGrid,
  List,
  ArrowUpDown,
  Edit2,
  Trash2,
  Users,
} from 'lucide-react';
import { FleetDevice, Device } from '../types';
import { DeviceCard } from './DeviceCard';
import { WifiDiagnostics } from './WifiDiagnostics';
import { OptimizeWizard } from './tabs/OptimizeWizard';
import { FleetWifiSyncModal } from './FleetWifiSyncModal';

interface FleetViewProps {
  fleet: FleetDevice[];
  onSelectDevice: (id: string) => void;
  onEditDevice: (device: Device) => void;
  onDeleteDevice: (id: string, name: string) => void;
  onOpenBatchModal: (selectedIds?: string[]) => void;
  onRefreshFleet: () => void;
  isRefreshing?: boolean;
  onTestConnection: (device: Device | FleetDevice) => Promise<void>;
  testingDeviceId?: string | null;
}

export const FleetView: React.FC<FleetViewProps> = ({
  fleet,
  onSelectDevice,
  onEditDevice,
  onDeleteDevice,
  onOpenBatchModal,
  onRefreshFleet,
  isRefreshing,
  onTestConnection,
  testingDeviceId,
}) => {
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'WARNING' | 'ZERO_CLIENTS' | 'OFFLINE'>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [showWifiSyncModal, setShowWifiSyncModal] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      return localStorage.getItem('rsam_fleet_view_mode') === 'table' ? 'table' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [sortBy, setSortBy] = useState<'status' | 'clients_desc' | 'clients_asc' | 'cpu' | 'name' | 'ip'>('status');

  useEffect(() => {
    try {
      localStorage.setItem('rsam_fleet_view_mode', viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    if (!showOptimizeModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowOptimizeModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showOptimizeModal]);

  // Extract distinct groups with counts
  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of fleet) {
      const g = d.group || 'Default';
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [fleet]);

  // Filtered & sorted devices (Offline & High CPU first by default)
  const filtered = useMemo(() => {
    const list = fleet.filter((d) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        (d.group && d.group.toLowerCase().includes(q)) ||
        (d.board && d.board.toLowerCase().includes(q));

      const matchGroup = selectedGroup === 'ALL' || (d.group || 'Default') === selectedGroup;

      let matchStatus = true;
      if (statusFilter === 'ONLINE') matchStatus = d.online;
      else if (statusFilter === 'OFFLINE') matchStatus = !d.online;
      else if (statusFilter === 'WARNING') matchStatus = d.online && (d.cpu_load || 0) >= 70;
      else if (statusFilter === 'ZERO_CLIENTS') matchStatus = d.online && d.clients_count === 0;

      return matchSearch && matchGroup && matchStatus;
    });

    const ipNum = (ip: string) =>
      ip.split('.').reduce((acc, oct) => acc * 256 + (parseInt(oct, 10) || 0), 0);

    return [...list].sort((a, b) => {
      if (sortBy === 'status') {
        // Offline (0) -> High CPU >=70% (1) -> Online normal (2)
        const rank = (d: FleetDevice) => (!d.online ? 0 : (d.cpu_load || 0) >= 70 ? 1 : 2);
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        if ((b.cpu_load || 0) !== (a.cpu_load || 0) && rank(a) === 1) {
          return (b.cpu_load || 0) - (a.cpu_load || 0);
        }
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'clients_desc') {
        if (a.online !== b.online) return a.online ? -1 : 1;
        const ca = a.clients_count ?? -1;
        const cb = b.clients_count ?? -1;
        if (cb !== ca) return cb - ca;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'clients_asc') {
        if (a.online !== b.online) return a.online ? -1 : 1;
        const ca = a.clients_count ?? Number.MAX_SAFE_INTEGER;
        const cb = b.clients_count ?? Number.MAX_SAFE_INTEGER;
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'cpu') {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (b.cpu_load || 0) - (a.cpu_load || 0);
      }
      if (sortBy === 'ip') {
        return ipNum(a.host) - ipNum(b.host);
      }
      return a.name.localeCompare(b.name);
    });
  }, [fleet, search, selectedGroup, statusFilter, sortBy]);

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((d) => d.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const primaryDevice = fleet.find((d) => d.is_default) || fleet[0];

  const totalLiveClients = useMemo(
    () => fleet.reduce((sum, d) => sum + (d.online && typeof d.clients_count === 'number' ? d.clients_count : 0), 0),
    [fleet]
  );
  const zeroClientCount = useMemo(
    () => fleet.filter((d) => d.online && d.clients_count === 0).length,
    [fleet]
  );

  return (
    <div className="space-y-4 pb-24">
      {/* Top Banner KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Total Perangkat</div>
            <div className="text-xl font-bold font-mono text-slate-900">{fleet.length} Unit</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Online</div>
            <div className="text-xl font-bold font-mono text-emerald-600">
              {fleet.filter((d) => d.online).length}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Klien Wi-Fi Live</div>
            <div className="text-xl font-bold font-mono text-indigo-700">{totalLiveClients}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Offline / Error</div>
            <div className="text-xl font-bold font-mono text-rose-600">
              {fleet.filter((d) => !d.online).length}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">High Load (&gt;70%)</div>
            <div className="text-xl font-bold font-mono text-amber-600">
              {fleet.filter((d) => d.online && (d.cpu_load || 0) >= 70).length} Unit
            </div>
          </div>
        </div>
      </div>

      <WifiDiagnostics fleet />

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter nama, IP host, ruangan, atau model board..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 border border-slate-200 rounded-xl text-xs font-mono">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua ({fleet.length})
            </button>
            <button
              onClick={() => setStatusFilter('ONLINE')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'ONLINE' ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Online ({fleet.filter((d) => d.online).length})
            </button>
            <button
              onClick={() => setStatusFilter('WARNING')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'WARNING' ? 'bg-amber-50 text-amber-700 font-bold border border-amber-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              High CPU ({fleet.filter((d) => d.online && (d.cpu_load || 0) >= 70).length})
            </button>
            <button
              onClick={() => setStatusFilter('ZERO_CLIENTS')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'ZERO_CLIENTS' ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="AP Online tetapi 0 klien Wi-Fi terhubung"
            >
              0 Klien ({zeroClientCount})
            </button>
            <button
              onClick={() => setStatusFilter('OFFLINE')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'OFFLINE' ? 'bg-rose-50 text-rose-700 font-bold border border-rose-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Offline ({fleet.filter((d) => !d.online).length})
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowOptimizeModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-mono font-semibold transition-colors cursor-pointer shadow-xs"
              title="Buka AI Optimize (OmniRoute) untuk seluruh AP"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>AI Optimize</span>
            </button>

            <button
              type="button"
              onClick={() => setShowWifiSyncModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-mono font-semibold transition-colors cursor-pointer shadow-xs"
              title="Sinkronisasi SSID & Ganti Password Wi-Fi Massal"
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Wi-Fi Sync</span>
            </button>

            <button
              onClick={onRefreshFleet}
              className={`flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 text-slate-700 rounded-xl text-xs font-mono font-medium transition-colors cursor-pointer shadow-xs ${
                isRefreshing ? 'animate-pulse text-blue-600' : ''
              }`}
              title="Refresh status perangkat"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              <span>Probe Perangkat</span>
            </button>

            <button
              onClick={handleSelectAllFiltered}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 text-slate-700 rounded-xl text-xs font-mono font-medium transition-colors cursor-pointer shadow-xs"
            >
              <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
              <span>Pilih Semua ({filtered.length})</span>
            </button>

            {/* Sort selector */}
            <div className="flex items-center gap-1 bg-slate-100 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-mono">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Urutkan daftar AP"
                className="bg-transparent text-xs text-slate-700 font-medium focus:outline-none cursor-pointer"
              >
                <option value="status">Bermasalah dulu</option>
                <option value="clients_desc">Klien terbanyak</option>
                <option value="clients_asc">Klien tersedikit (0 dulu)</option>
                <option value="cpu">CPU tertinggi</option>
                <option value="name">Nama A-Z</option>
                <option value="ip">IP Address</option>
              </select>
            </div>

            {/* Grid / Table view switch */}
            <div className="flex items-center p-0.5 bg-slate-100 border border-slate-300 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-label="Tampilan kartu"
                title="Tampilan Kartu"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-label="Tampilan tabel padat"
                title="Tampilan Tabel Padat"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'table' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Group / Location Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono border-t border-slate-100 pt-2.5">
          <span className="text-slate-500 text-[11px] shrink-0 uppercase pr-1 font-semibold">Lokasi / Ruangan:</span>
          <button
            onClick={() => setSelectedGroup('ALL')}
            className={`px-3 py-1 rounded-full text-[11px] border shrink-0 transition-colors cursor-pointer ${
              selectedGroup === 'ALL'
                ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold shadow-xs'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            Semua ({fleet.length})
          </button>
          {groups.map(([grp, count]) => (
            <button
              key={grp}
              onClick={() => setSelectedGroup(grp)}
              className={`px-3 py-1 rounded-full text-[11px] border shrink-0 transition-colors cursor-pointer ${
                selectedGroup === grp
                  ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              {grp} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Fleet Cards Grid or Compact Table */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center bg-white border border-slate-200 rounded-2xl text-slate-500 text-sm shadow-sm">
          Tidak ada router yang sesuai dengan kriteria filter.
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase border-b border-slate-200">
                <tr>
                  <th className="py-2.5 pl-3.5 pr-2 w-8">
                    <span className="sr-only">Pilih</span>
                  </th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2">Perangkat &amp; IP</th>
                  <th className="py-2.5 px-2">Lokasi</th>
                  <th className="py-2.5 px-2">Board / ROS</th>
                  <th className="py-2.5 px-2 text-center">Klien</th>
                  <th className="py-2.5 px-2 w-32">CPU</th>
                  <th className="py-2.5 px-2">Uptime</th>
                  <th className="py-2.5 pl-2 pr-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d) => {
                  const isSel = selectedIds.has(d.id);
                  const cpu = d.cpu_load ?? 0;
                  const cpuBar = cpu >= 80 ? 'bg-rose-600' : cpu >= 50 ? 'bg-amber-500' : 'bg-emerald-600';
                  const cpuTxt = cpu >= 80 ? 'text-rose-700' : cpu >= 50 ? 'text-amber-700' : 'text-emerald-700';
                  const hasGroup = Boolean(d.group && d.group.toLowerCase() !== 'default');
                  const ver = d.version ? `v${d.version.replace(/\s*\(stable\)/i, '')}` : '-';
                  return (
                    <tr
                      key={d.id}
                      onClick={() => onSelectDevice(d.id)}
                      className={`cursor-pointer transition-colors ${
                        isSel
                          ? 'bg-blue-50/50'
                          : !d.online
                          ? 'bg-rose-50/35 hover:bg-rose-50/70'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 pl-3.5 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => handleToggleSelect(d.id)}
                          aria-label={`Pilih ${d.name}`}
                          className="w-4 h-4 rounded border-slate-300 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                            d.online
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          />
                          {d.online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 min-w-[200px]">
                        <div className="font-bold text-slate-900 hover:text-blue-700">{d.name}</div>
                        <div className="text-[10.5px] text-slate-500">{d.host}</div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {hasGroup ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                            {d.group}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-[11px] text-slate-700">
                        <div>{d.board || 'MikroTik'}</div>
                        <div className="text-[10px] text-slate-500">{ver}</div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-center">
                        {!d.online ? (
                          <span className="text-slate-300">-</span>
                        ) : d.clients_count === null || d.clients_count === undefined ? (
                          <span className="text-slate-400" title="Bukan interface Wi-Fi">-</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                              d.clients_count === 0
                                ? 'bg-slate-50 text-slate-500 border-slate-200'
                                : d.clients_count >= 35
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : d.clients_count >= 25
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                            title={
                              d.clients_count === 0
                                ? 'Online tapi 0 klien Wi-Fi aktif'
                                : `${d.clients_count} klien Wi-Fi aktif`
                            }
                          >
                            <Users className="w-3 h-3" aria-hidden="true" />
                            <span>{d.clients_count}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        {d.online ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className={`h-full ${cpuBar}`} style={{ width: `${Math.min(100, Math.max(2, cpu))}%` }} />
                            </div>
                            <span className={`text-[11px] font-bold w-8 text-right ${cpuTxt}`}>{cpu}%</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-rose-600">offline</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-[11px] text-slate-600">
                        {d.online ? d.uptime || '-' : '-'}
                      </td>
                      <td className="py-2.5 pl-2 pr-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onTestConnection(d)}
                            disabled={testingDeviceId === d.id}
                            aria-label={`Tes koneksi ${d.name}`}
                            title="Tes Koneksi"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${testingDeviceId === d.id ? 'animate-spin text-blue-600' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditDevice(d as Device)}
                            aria-label={`Edit ${d.name}`}
                            title="Edit"
                            className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteDevice(d.id, d.name)}
                            aria-label={`Hapus ${d.name}`}
                            title="Hapus"
                            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={selectedIds.has(device.id)}
              onToggleSelect={handleToggleSelect}
              onOpenDashboard={onSelectDevice}
              onEdit={onEditDevice}
              onDelete={onDeleteDevice}
              onTestConnection={onTestConnection}
              isTesting={testingDeviceId === device.id}
            />
          ))}
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white text-slate-900 border border-slate-200/90 rounded-2xl shadow-xl px-5 py-3 flex items-center gap-4 animate-slide-up">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
            <span className="font-bold text-slate-900">{selectedIds.size}</span>
            <span className="text-slate-600">router dipilih dari daftar perangkat</span>
          </div>

          <div className="h-5 w-px bg-slate-200" />

          <button
            onClick={() => setShowWifiSyncModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs transition-all shadow-sm cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Sync Wi-Fi ({selectedIds.size})</span>
          </button>

          <button
            onClick={() => onOpenBatchModal(Array.from(selectedIds))}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Jalankan Batch Script ({selectedIds.size})</span>
          </button>

          <button
            onClick={handleClearSelection}
            className="text-xs text-slate-500 hover:text-slate-900 font-medium transition-colors cursor-pointer"
          >
            Batal
          </button>
        </div>
      )}
      {/* AI Optimize Fleet Modal */}
      {showOptimizeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          onClick={() => setShowOptimizeModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-bold font-mono text-slate-800">
                AI Optimize Armada (OmniRoute)
              </span>
              <button
                type="button"
                onClick={() => setShowOptimizeModal(false)}
                aria-label="Tutup AI Optimize"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <OptimizeWizard fleet onApplied={onRefreshFleet} />
            </div>
          </div>
        </div>
      )}
      {/* Fleet Wi-Fi Sync Modal */}
      <FleetWifiSyncModal
        isOpen={showWifiSyncModal}
        onClose={() => setShowWifiSyncModal(false)}
        fleet={fleet}
        initialSelectedIds={selectedIds.size > 0 ? Array.from(selectedIds) : undefined}
      />
    </div>
  );
};
