import React, { useState } from 'react';
import {
  Server,
  Wifi,
  Cpu,
  Clock,
  Layers,
  Edit2,
  Trash2,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
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

  // CPU color thresholds
  let cpuColor = 'bg-emerald-500';
  let cpuTextColor = 'text-emerald-400';
  if (cpuLoad >= 80) {
    cpuColor = 'bg-rose-500';
    cpuTextColor = 'text-rose-400';
  } else if (cpuLoad >= 50) {
    cpuColor = 'bg-amber-500';
    cpuTextColor = 'text-amber-400';
  }

  return (
    <div
      className={`group relative bg-white border rounded-2xl p-4 transition-all duration-200 flex flex-col justify-between hover:shadow-md ${
        isSelected
          ? 'border-blue-500 bg-blue-50/30 ring-2 ring-blue-500/20 shadow-sm'
          : isOnline
          ? 'border-slate-200/90 hover:border-slate-300'
          : 'border-rose-200 bg-rose-50/20 hover:border-rose-300'
      }`}
    >
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Selection Checkbox */}
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(device.id)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
              title="Pilih untuk Batch Action"
            />

            {/* Status Icon */}
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                isOnline
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  : 'bg-rose-50 border-rose-200 text-rose-600'
              }`}
            >
              <Server className="w-4 h-4" />
            </div>

            {/* Name & Identity */}
            <div className="min-w-0">
              <h3
                onClick={() => onOpenDashboard(device.id)}
                className="font-bold text-sm text-slate-900 hover:text-blue-600 cursor-pointer truncate transition-colors"
                title={device.name}
              >
                {device.name}
              </h3>
              <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
                <span>{device.host}:{device.port || 8728}</span>
                {device.is_default && (
                  <span className="text-[9px] px-1 py-0.2 bg-blue-50 text-blue-700 border border-blue-200 rounded uppercase font-semibold">
                    Default
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Group Tag & Online Badge */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {device.group && (
              <span className="text-[10px] font-mono px-2 py-0.2 bg-slate-100 text-slate-600 border border-slate-200 rounded font-medium">
                {device.group}
              </span>
            )}
          </div>
        </div>

        {/* Hardware & Specs Grid */}
        <div className="grid grid-cols-2 gap-2 my-3 p-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-xs font-mono">
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Board Model</div>
            <div className="text-slate-800 truncate font-bold">
              {fleetData?.board || 'MikroTik'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">RouterOS</div>
            <div className="text-slate-800 truncate font-medium">
              {fleetData?.version ? `v${fleetData.version}` : 'ROS v7'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Uptime</div>
            <div className="text-slate-700 truncate flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>{fleetData?.uptime || '-'}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold flex items-center justify-between">
              <span>CPU Load</span>
              <span className={cpuTextColor}>{cpuLoad}%</span>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full ${cpuColor} transition-all duration-500`}
                style={{ width: `${Math.min(100, Math.max(0, cpuLoad))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Card Action Buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-1 gap-2">
        <button
          onClick={() => onOpenDashboard(device.id)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs"
        >
          <span>Buka Dashboard</span>
          <ExternalLink className="w-3 h-3" />
        </button>

        <button
          onClick={() => onTestConnection(device)}
          disabled={isTesting}
          className="p-1.5 text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
          title="Tes Koneksi Socket API Port 8728"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-blue-600' : ''}`} />
        </button>

        <button
          onClick={() => onEdit(device as Device)}
          className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200 border border-slate-300 rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
          title="Edit Data / Kredensial"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onDelete(device.id, device.name)}
          className="p-1.5 text-slate-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200 border border-slate-300 rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
          title="Hapus Perangkat"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
