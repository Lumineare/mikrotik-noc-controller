import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { FleetDevice, Device } from '../types';
import { DeviceCard } from './DeviceCard';
import { WifiDiagnostics } from './WifiDiagnostics';
import { OptimizeWizard } from './tabs/OptimizeWizard';

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
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'WARNING' | 'OFFLINE'>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Extract distinct groups with counts
  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of fleet) {
      const g = d.group || 'Default';
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [fleet]);

  // Filtered devices
  const filtered = useMemo(() => {
    return fleet.filter((d) => {
      // Search match
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        (d.group && d.group.toLowerCase().includes(q)) ||
        (d.board && d.board.toLowerCase().includes(q));

      // Group match
      const matchGroup = selectedGroup === 'ALL' || (d.group || 'Default') === selectedGroup;

      // Status match
      let matchStatus = true;
      if (statusFilter === 'ONLINE') matchStatus = d.online;
      else if (statusFilter === 'OFFLINE') matchStatus = !d.online;
      else if (statusFilter === 'WARNING') matchStatus = d.online && (d.cpu_load || 0) >= 70;

      return matchSearch && matchGroup && matchStatus;
    });
  }, [fleet, search, selectedGroup, statusFilter]);

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

  return (
    <div className="space-y-4 pb-24">
      {/* Top Banner KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Total Perangkat</div>
            <div className="text-xl font-bold font-mono text-slate-900">{fleet.length} Unit</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
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
          <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
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
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
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

      <OptimizeWizard fleet />

      <WifiDiagnostics deviceId={primaryDevice?.id} deviceName={primaryDevice?.name} />

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
              onClick={() => setStatusFilter('OFFLINE')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'OFFLINE' ? 'bg-rose-50 text-rose-700 font-bold border border-rose-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Offline ({fleet.filter((d) => !d.online).length})
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
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

      {/* Fleet Cards Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center bg-white border border-slate-200 rounded-2xl text-slate-500 text-sm shadow-sm">
          Tidak ada router yang sesuai dengan kriteria filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
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
    </div>
  );
};
