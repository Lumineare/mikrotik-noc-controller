import React from 'react';
import { Server, Cpu, HardDrive, Database, Clock, Calendar, CheckCircle2, AlertCircle } from 'lucide-react';
import { SystemInfo } from '../../types';
import { WifiDiagnostics } from '../WifiDiagnostics';

interface TabOverviewProps {
  system: SystemInfo;
  deviceId?: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export const TabOverview: React.FC<TabOverviewProps> = ({ system, deviceId }) => {
  const totalMem = system.total_memory || (system.memory_total_mb ? system.memory_total_mb * 1024 * 1024 : 0);
  const freeMem = system.free_memory || (system.memory_free_mb ? system.memory_free_mb * 1024 * 1024 : 0);
  const ramUsed = Math.max(0, totalMem - freeMem);
  const ramPercent = system.memory_used_pct ?? (totalMem > 0 ? Math.round((ramUsed / totalMem) * 100) : 0);

  const totalHdd = system.total_hdd || (system.disk_total_mb ? system.disk_total_mb * 1024 * 1024 : 0);
  const freeHdd = system.free_hdd || (system.disk_free_mb ? system.disk_free_mb * 1024 * 1024 : 0);
  const hddUsed = Math.max(0, totalHdd - freeHdd);
  const hddPercent = totalHdd > 0 ? Math.round((hddUsed / totalHdd) * 100) : 0;

  return (
    <div className="space-y-4">
      <WifiDiagnostics deviceId={deviceId} />
      {/* Hardware & Spec Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Device Information Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-3">
            <Server className="w-4 h-4 text-blue-600" />
            <span>Spesifikasi Hardware</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Identity:</span>
              <span className="text-slate-900 font-bold">{system.identity || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Board Model:</span>
              <span className="text-slate-800 font-medium">{system.board || system.model || system.board_name || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Arsitektur:</span>
              <span className="text-slate-700">{system.architecture || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">RouterOS:</span>
              <span className="text-emerald-700 font-bold">{system.version || system.routeros_version || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Uptime:</span>
              <span className="text-slate-800 font-medium">{system.uptime || '-'}</span>
            </div>
          </div>
        </div>

        {/* CPU & Processing */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-3">
            <Cpu className="w-4 h-4 text-blue-600" />
            <span>Prosesor (CPU)</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">CPU Model:</span>
              <span className="text-slate-800 font-medium truncate max-w-[180px]">{system.cpu || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Cores / Freq:</span>
              <span className="text-slate-700 font-medium">
                {system.cpu_count || 1} Core @ {system.cpu_frequency ? `${system.cpu_frequency} MHz` : '-'}
              </span>
            </div>
            <div className="py-2">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-500 font-medium">CPU Load Saat Ini:</span>
                <span className={`font-bold ${system.cpu_load >= 80 ? 'text-rose-600' : system.cpu_load >= 50 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {system.cpu_load || 0}%
                </span>
              </div>
              <div className="w-full bg-slate-100 border border-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full ${system.cpu_load >= 80 ? 'bg-rose-500' : system.cpu_load >= 50 ? 'bg-amber-500' : 'bg-emerald-500'} transition-all duration-300`}
                  style={{ width: `${Math.min(100, Math.max(0, system.cpu_load || 0))}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Memory & Storage */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-3">
            <Database className="w-4 h-4 text-blue-600" />
            <span>Memori & Penyimpanan</span>
          </div>
          <div className="space-y-3 text-xs font-mono">
            {/* RAM */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-500 font-medium">RAM Digunakan:</span>
                <span className="text-slate-800 font-semibold">
                  {formatBytes(ramUsed)} / {formatBytes(totalMem)} ({ramPercent}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 border border-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${ramPercent}%` }}
                />
              </div>
            </div>

            {/* Disk */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-500 font-medium">Disk Digunakan:</span>
                <span className="text-slate-800 font-semibold">
                  {formatBytes(hddUsed)} / {formatBytes(totalHdd)} ({hddPercent}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 border border-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300"
                  style={{ width: `${hddPercent}%` }}
                />
              </div>
            </div>

            <div className="pt-1.5 text-[11px] text-slate-500 flex justify-between font-medium">
              <span>Waktu Router: {system.time || '-'}</span>
              <span>{system.date || '-'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
