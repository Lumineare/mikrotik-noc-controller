import React from 'react';
import {
  Activity,
  Plus,
  Search,
  Server,
  Layers,
  Terminal,
  RefreshCw,
  SlidersHorizontal,
  LogOut,
  User,
  MapPin,
  Send,
  Footprints,
} from 'lucide-react';
import { Device, FleetDevice, AuthUser } from '../types';

interface HeaderProps {
  devices: Device[];
  activeDeviceId: string;
  onSelectDevice: (id: string) => void;
  activeView: 'fleet' | 'device' | 'map' | 'locator';
  onChangeView: (view: 'fleet' | 'device' | 'map' | 'locator') => void;
  fleetSummary: { total: number; online: number; offline: number; avg_cpu: number };
  pollingInterval: number; // in seconds, 0 = paused
  onChangePolling: (sec: number) => void;
  onOpenAddModal: () => void;
  onOpenBatchModal: () => void;
  onOpenCommandPalette: () => void;
  onOpenTelegramModal?: () => void;
  isRefreshing?: boolean;
  onManualRefresh?: () => void;
  user?: AuthUser | null;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  devices,
  activeDeviceId,
  onSelectDevice,
  activeView,
  onChangeView,
  fleetSummary,
  pollingInterval,
  onChangePolling,
  onOpenAddModal,
  onOpenBatchModal,
  onOpenCommandPalette,
  onOpenTelegramModal,
  isRefreshing,
  onManualRefresh,
  user,
  onLogout,
}) => {
  const activeDevice = devices.find((d) => d.id === activeDeviceId);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-sm px-4 py-2.5">
      <div className="max-w-[1720px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Branding & Views */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Logo */}
          <div className="flex items-center gap-2.5 pr-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-sm shadow-blue-500/10">
              <Activity className="w-5 h-5 text-blue-600 animate-pulse" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-slate-900 flex items-center gap-1.5 font-mono">
                <span>RSAM</span>
                <span className="text-blue-600">NOC</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-mono font-medium">
                  ROS v7
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">Fleet Controller Gateway</div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200 hidden sm:block" />

          {/* Navigation Mode: Perangkat vs Detail Router */}
          <div className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
            <button
              onClick={() => onChangeView('fleet')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeView === 'fleet'
                  ? 'bg-white text-blue-700 border border-slate-200/80 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Semua Perangkat</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                activeView === 'fleet' ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600'
              }`}>
                {fleetSummary.total || devices.length}
              </span>
            </button>

            <button
              onClick={() => onChangeView('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeView === 'map'
                  ? 'bg-white text-blue-700 border border-slate-200/80 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>Denah &amp; Heatmap</span>
            </button>

            <button
              onClick={() => onChangeView('locator')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeView === 'locator'
                  ? 'bg-white text-blue-700 border border-slate-200/80 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Footprints className="w-3.5 h-3.5 text-blue-600" />
              <span>Pelacak Klien / Roaming</span>
            </button>

            <button
              onClick={() => onChangeView('device')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeView === 'device'
                  ? 'bg-white text-blue-700 border border-slate-200/80 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Detail Router</span>
              {activeDevice && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono truncate max-w-[120px] ${
                  activeView === 'device' ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {activeDevice.name}
                </span>
              )}
            </button>
          </div>

          {/* Device Selector Dropdown - only in Detail Router mode */}
          {activeView === 'device' && (
            <div className="flex items-center gap-2">
              <select
                value={activeDeviceId}
                onChange={(e) => {
                  onSelectDevice(e.target.value);
                  if (activeView !== 'device') onChangeView('device');
                }}
                className="bg-white text-xs font-mono text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-500/20 max-w-[320px] sm:max-w-[380px] truncate shadow-sm cursor-pointer"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id} className="bg-white text-slate-900">
                    {d.name} ({d.host}) {d.group ? `[${d.group}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Right: Fleet Health Badges, Quick Search & Actions */}
        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          {/* Fleet Status Pills */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1">
            <span className="text-slate-500">Perangkat:</span>
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {fleetSummary.online} Online
            </span>
            {fleetSummary.offline > 0 && (
              <span className="flex items-center gap-1.5 text-rose-700 font-semibold border-l border-slate-200 pl-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                {fleetSummary.offline} Offline
              </span>
            )}
            <span className="text-slate-500 border-l border-slate-200 pl-2">
              Avg CPU: <b className="text-slate-800 font-semibold">{fleetSummary.avg_cpu}%</b>
            </span>
          </div>

          {/* Search / Command Palette Trigger */}
          <button
            onClick={onOpenCommandPalette}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 hover:border-slate-400 rounded-lg text-xs text-slate-700 transition-colors shadow-sm cursor-pointer"
            title="Buka Pencarian Router (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline font-medium">Cari...</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.2 text-[10px] font-mono bg-white text-slate-600 border border-slate-200 rounded shadow-xs">
              Ctrl+K
            </kbd>
          </button>

          {/* Polling Selector */}
          <div className="flex items-center gap-1 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 text-xs">
            <SlidersHorizontal className="w-3 h-3 text-slate-500 hidden sm:inline" />
            <select
              value={pollingInterval}
              onChange={(e) => onChangePolling(Number(e.target.value))}
              className="bg-transparent text-[11px] font-mono text-slate-700 font-medium focus:outline-none cursor-pointer"
            >
              <option value={1} className="bg-white text-slate-800">Poll: 1s</option>
              <option value={2} className="bg-white text-slate-800">Poll: 2s</option>
              <option value={5} className="bg-white text-slate-800">Poll: 5s</option>
              <option value={10} className="bg-white text-slate-800">Poll: 10s</option>
              <option value={0} className="bg-white text-slate-800">Pause</option>
            </select>
          </div>

          {/* Manual Refresh Button */}
          {onManualRefresh && (
            <button
              onClick={onManualRefresh}
              className={`p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-300 rounded-lg transition-colors shadow-sm cursor-pointer ${
                isRefreshing ? 'animate-spin text-blue-600' : ''
              }`}
              title="Refresh Data Sekarang"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Telegram Alert Bot Trigger */}
          {onOpenTelegramModal && (
            <button
              onClick={onOpenTelegramModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-xs font-semibold transition-all shadow-sm cursor-pointer"
              title="Konfigurasi Notifikasi Bot Telegram RSAM NOC"
            >
              <Send className="w-3.5 h-3.5 text-sky-600" />
              <span className="hidden sm:inline">Telegram Alert</span>
            </button>
          )}

          {/* Batch Script Automation Button */}
          <button
            onClick={onOpenBatchModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition-all shadow-sm cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-600" />
            <span>Batch Script</span>
          </button>

          {/* Add Device Button */}
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-lg text-xs transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Tambah Router</span>
          </button>

          {/* User Profile & Logout */}
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="hidden lg:flex flex-col text-right">
                <span className="text-[11px] font-bold text-slate-800 leading-tight">
                  {user.name || user.username}
                </span>
                <span className="text-[9px] text-blue-600 font-mono font-medium leading-tight">
                  {user.role}
                </span>
              </div>
              <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-300 hover:border-rose-300 rounded-lg transition-colors cursor-pointer"
                  title="Logout dari Fleet Controller"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
