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
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-2.5">
      <div className="max-w-[1720px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        {/* Left: Branding & Views */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {/* Logo */}
          <div className="flex items-center gap-2.5 pr-1 shrink-0">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Activity className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-slate-900 flex items-center gap-1.5 font-mono">
                <span>RSAM</span>
                <span className="text-blue-600">NOC</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono font-medium">
                  ROS v7
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">Fleet Controller Gateway</div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200 hidden sm:block shrink-0" />

          {/* Navigation Mode: Perangkat vs Detail Router */}
          <nav
            aria-label="Navigasi utama"
            className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto max-w-full"
          >
            <button
              type="button"
              onClick={() => onChangeView('fleet')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${activeView === 'fleet'
                  ? 'bg-white text-blue-700 border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Semua Perangkat</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${activeView === 'fleet' ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                {fleetSummary.total || devices.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeView('map')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${activeView === 'map'
                  ? 'bg-white text-blue-700 border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
            >
              <MapPin className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>Denah &amp; Heatmap</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeView('locator')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${activeView === 'locator'
                  ? 'bg-white text-blue-700 border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
            >
              <Footprints className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>Pelacak Klien / Roaming</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeView('device')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${activeView === 'device'
                  ? 'bg-white text-blue-700 border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
            >
              <Server className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Detail Router</span>
              {activeDevice && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono truncate max-w-[120px] ${activeView === 'device' ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                  {activeDevice.name}
                </span>
              )}
            </button>
          </nav>

          {/* Device Selector Dropdown - only in Detail Router mode */}
          {activeView === 'device' && (
            <div className="flex items-center gap-2">
              <select
                value={activeDeviceId}
                aria-label="Pilih perangkat router aktif"
                onChange={(e) => {
                  onSelectDevice(e.target.value);
                  if (activeView !== 'device') onChangeView('device');
                }}
                className="bg-white text-xs font-mono text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 focus-visible:border-blue-600 max-w-[320px] sm:max-w-[380px] truncate"
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Fleet Status Strip */}
          <div className="hidden xl:flex items-center gap-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1">
            <span className="text-slate-500">Armada:</span>
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold tabular-nums">
              <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
              {fleetSummary.online} Online
            </span>
            {fleetSummary.offline > 0 && (
              <span className="flex items-center gap-1.5 text-rose-700 font-semibold border-l border-slate-200 pl-2 tabular-nums">
                <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
                {fleetSummary.offline} Offline
              </span>
            )}
            <span className="text-slate-500 border-l border-slate-200 pl-2 tabular-nums">
              Avg CPU: <b className="text-slate-800 font-semibold">{fleetSummary.avg_cpu}%</b>
            </span>
          </div>

          {/* Search / Command Palette Trigger */}
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-md text-xs text-slate-700 transition-colors"
            title="Buka Pencarian Router (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
            <span className="hidden sm:inline font-medium">Cari...</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.2 text-[10px] font-mono bg-white text-slate-600 border border-slate-200 rounded">
              Ctrl+K
            </kbd>
          </button>

          {/* Polling Selector */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs">
            <SlidersHorizontal className="w-3 h-3 text-slate-500 hidden sm:inline" aria-hidden="true" />
            <select
              value={pollingInterval}
              aria-label="Interval polling otomatis"
              onChange={(e) => onChangePolling(Number(e.target.value))}
              className="bg-transparent text-[11px] font-mono text-slate-700 font-medium"
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
              type="button"
              onClick={onManualRefresh}
              aria-label="Refresh data sekarang"
              className={`p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-md transition-colors ${isRefreshing ? 'animate-spin text-blue-600' : ''
                }`}
              title="Refresh Data Sekarang"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}

          {/* Telegram Alert Bot Trigger */}
          {onOpenTelegramModal && (
            <button
              type="button"
              onClick={onOpenTelegramModal}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md text-xs font-semibold transition-colors"
              title="Konfigurasi Notifikasi Bot Telegram"
            >
              <Send className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
              <span className="hidden sm:inline">Telegram</span>
            </button>
          )}

          {/* Batch Script Automation Button */}
          <button
            type="button"
            onClick={onOpenBatchModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md text-xs font-semibold transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            <span>Batch Script</span>
          </button>

          {/* Add Device Button */}
          <button
            type="button"
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-md text-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Tambah Router</span>
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
              <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                <User className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  aria-label="Logout dari Fleet Controller"
                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-md transition-colors"
                  title="Logout dari Fleet Controller"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
