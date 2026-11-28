import React from 'react';
import {
  Clock,
  Edit2,
  Trash2,
  RefreshCw,
  ChevronRight,
  Users,
} from 'lucide-react';
import { FleetDevice, Device } from '../types';

interface DeviceCardProps {
  device: FleetDevice | Device;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenDashboard: (id: string) => void;
  onEdit: (device: Device) => void;
  onDelete: (id: string, name: string) => void;
  onTestConnection: (device: Device | FleetDevice) => Promise<void>;
  isTesting?: boolean;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onToggleSelect,
  onOpenDashboard,
  onEdit,
  onDelete,
  onTestConnection,
  isTesting,
}) => {
  const isFleet = 'online' in device;
  const fleetData = isFleet ? (device as FleetDevice) : null;
  const isOnline = fleetData ? !!fleetData.online : false;
  const cpuLoad = fleetData?.cpu_load ?? 0;
  const clientsCount = fleetData?.clients_count ?? null;
  const isOverloadClients = isOnline && clientsCount !== null && clientsCount >= 35;
  const isHighCpu = isOnline && cpuLoad >= 70;
  const hasRealGroup = Boolean(device.group && device.group.toLowerCase() !== 'default');

  let clientTextColor = 'text-blue-700';
  let clientBadgeClass = 'text-blue-700';
  if (clientsCount === null) {
    clientTextColor = 'text-slate-400';
    clientBadgeClass = 'text-slate-400';
  } else if (clientsCount === 0) {
    clientTextColor = 'text-slate-400';
    clientBadgeClass = 'text-slate-500';
  } else if (clientsCount >= 35) {
    clientTextColor = 'text-rose-700';
    clientBadgeClass = 'text-rose-700';
  } else if (clientsCount >= 25) {
    clientTextColor = 'text-amber-700';
    clientBadgeClass = 'text-amber-700';
  }

  let cpuBarColor = 'bg-emerald-600';
  let cpuTextColor = 'text-emerald-700';
  if (cpuLoad >= 80) {
    cpuBarColor = 'bg-rose-600';
    cpuTextColor = 'text-rose-700';
  } else if (cpuLoad >= 50) {
    cpuBarColor = 'bg-amber-500';
    cpuTextColor = 'text-amber-700';
  }

  // Clean board & version label without clutter
  const shortVersion = fleetData?.version
    ? `v${fleetData.version.replace(/\s*\(stable\)/i, '')}`
    : '';
  const boardModel = fleetData?.board || '';

  return (
    <article
      onClick={() => onOpenDashboard(device.id)}
      className={`group relative bg-white border rounded-lg p-3.5 transition-colors duration-150 flex flex-col justify-between cursor-pointer focus-within:ring-2 focus-within:ring-blue-500/40 ${
        isSelected
          ? 'border-blue-500 bg-blue-50/30 ring-1 ring-blue-500/40'
          : !isOnline
          ? 'border-rose-200 border-t-2 border-t-rose-500 bg-rose-50/20 hover:border-rose-300'
          : isHighCpu
          ? 'border-amber-200 border-t-2 border-t-amber-500 bg-amber-50/15 hover:border-amber-300'
          : 'border-slate-200 hover:border-blue-400'
      }`}
    >
      <div>
        {/* Top Row: Checkbox + Name + Status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(device.id)}
              aria-label={`Pilih ${device.name} untuk batch script`}
              className="mt-1 w-4 h-4 rounded border-slate-300 accent-blue-600 cursor-pointer shrink-0"
              title="Pilih untuk Batch Action"
            />

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    !isOnline ? 'bg-rose-500' : isHighCpu ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  aria-hidden="true"
                />
                <h3 className="font-bold text-[13px] text-slate-900 group-hover:text-blue-700 truncate transition-colors">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDashboard(device.id);
                    }}
                    className="text-left truncate max-w-full block"
                    title={device.name}
                  >
                    {device.name}
                  </button>
                </h3>
              </div>

              {/* Compact 1-line IP + Hardware + ROS */}
              <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5 truncate">
                <span className="text-slate-600">{device.host}</span>
                {boardModel && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="truncate">{boardModel}</span>
                  </>
                )}
                {shortVersion && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="shrink-0">{shortVersion}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {hasRealGroup && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-medium truncate max-w-[110px]">
                {device.group}
              </span>
            )}
          </div>
        </div>

        {/* Telemetry Strip: CPU + Live Clients + Uptime (or Offline error note) */}
        {isOnline ? (
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2.5 text-[11px] font-mono">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500 font-semibold">CPU</span>
                <span className={`text-[11px] font-bold ${cpuTextColor}`}>{cpuLoad}%</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full ${cpuBarColor} transition-all duration-300`}
                  style={{ width: `${Math.min(100, Math.max(2, cpuLoad))}%` }}
                />
              </div>
            </div>

            <div className="h-6 w-px bg-slate-100 shrink-0" />

            <div
              className="text-center shrink-0 min-w-[44px]"
              title={
                clientsCount === null
                  ? 'Bukan interface Wi-Fi / tidak terbaca'
                  : clientsCount === 0
                  ? 'Online tapi 0 klien Wi-Fi aktif'
                  : isOverloadClients
                  ? `${clientsCount} klien Wi-Fi aktif (Overload)`
                  : `${clientsCount} klien Wi-Fi aktif`
              }
            >
              <div className="text-[10px] text-slate-500 font-semibold">Klien</div>
              <div className={`flex items-center justify-center gap-1 mt-0.5 font-bold ${clientBadgeClass}`}>
                <Users className={`w-3 h-3 ${clientTextColor}`} aria-hidden="true" />
                <span>{clientsCount === null ? '-' : clientsCount}</span>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-100 shrink-0" />

            <div className="text-right shrink-0">
              <div className="text-[10px] text-slate-500 font-semibold">Uptime</div>
              <div className="text-slate-700 flex items-center justify-end gap-1 mt-0.5">
                <Clock className="w-3 h-3 text-slate-400" aria-hidden="true" />
                <span>{fleetData?.uptime || '-'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 pt-2.5 border-t border-rose-100 text-[11px] font-mono text-rose-700 truncate">
            {fleetData?.error || 'Tidak merespons pada port 8728'}
          </div>
        )}
      </div>

      {/* Quiet Footer: Subtle open cue + compact utility icons */}
      <div
        className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onOpenDashboard(device.id)}
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-500 group-hover:text-blue-600 transition-colors cursor-pointer"
        >
          <span>Kelola Router</span>
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTestConnection(device)}
            disabled={isTesting}
            aria-label={`Tes koneksi ${device.name}`}
            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            title="Tes Koneksi Socket API Port 8728"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-blue-600' : ''}`} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onEdit(device as Device)}
            aria-label={`Edit ${device.name}`}
            className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
            title="Edit Data / Kredensial"
          >
            <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onDelete(device.id, device.name)}
            aria-label={`Hapus ${device.name}`}
            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
            title="Hapus Perangkat"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
