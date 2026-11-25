import React, { useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Wifi,
  Layers,
  Network,
  Shield,
  Sliders,
  Activity,
  FileText,
  Server,
  Terminal,
  RotateCcw,
  Tag,
  AlertCircle,
  CheckCircle2,
  X,
  FileDown,
  Download,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import { DashboardData, WirelessClient } from '../types';
import { Oscilloscope } from './Oscilloscope';
import { TabOverview } from './tabs/TabOverview';
import { TabWireless } from './tabs/TabWireless';
import { TabInterfaces } from './tabs/TabInterfaces';
import { TabNetworkArp } from './tabs/TabNetworkArp';
import { TabFirewall } from './tabs/TabFirewall';
import { TabServices } from './tabs/TabServices';
import { TabPing } from './tabs/TabPing';
import { TabLogs } from './tabs/TabLogs';
import { TabTerminal } from './tabs/TabTerminal';
import { TabAiOptimizer } from './tabs/TabAiOptimizer';
import { RfScanDrawer } from './map/RfScanDrawer';
import { api } from '../api/client';

interface DeviceWorkspaceProps {
  data: DashboardData;
  onBackToFleet: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

type TabKey =
  | 'overview'
  | 'ai'
  | 'wireless'
  | 'interfaces'
  | 'network'
  | 'firewall'
  | 'services'
  | 'ping'
  | 'logs'
  | 'terminal';

export const DeviceWorkspace: React.FC<DeviceWorkspaceProps> = ({
  data,
  onBackToFleet,
  onRefresh,
  isRefreshing,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Reboot modal state
  const [showRebootModal, setShowRebootModal] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  // Identity modal state
  const [showIdentModal, setShowIdentModal] = useState(false);
  const [newIdent, setNewIdent] = useState(data.system.identity || data.device_name || '');
  const [isSavingIdent, setIsSavingIdent] = useState(false);

  // Export & Backup modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportConfig, setExportConfig] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [copiedExport, setCopiedExport] = useState(false);

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{ filename: string; message: string } | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  // RF Spectrum Scan state
  const [showRfScan, setShowRfScan] = useState(false);
  const [rfScanBand, setRfScanBand] = useState<'2g' | '5g'>('2g');

  // Feedback notification
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4500);
  };

  const handleExportConfig = async () => {
    setIsExporting(true);
    setShowExportModal(true);
    setExportConfig('');
    try {
      const res = await api.exportRouterConfig(data.device_id, true);
      setExportConfig(res.content || '');
    } catch (err: any) {
      showToast('err', `Gagal mengekspor konfigurasi: ${err.message}`);
      setShowExportModal(false);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    setShowBackupModal(true);
    setBackupInfo(null);
    try {
      const res = await api.createRouterBackup(data.device_id);
      setBackupInfo({ filename: res.filename, message: res.message });
      showToast('ok', `Backup sistem "${res.filename}" berhasil dibuat di MikroTik!`);
    } catch (err: any) {
      showToast('err', `Gagal membuat backup: ${err.message}`);
      setShowBackupModal(false);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleCopyExport = () => {
    navigator.clipboard.writeText(exportConfig);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2000);
  };

  const handleDownloadExport = () => {
    const blob = new Blob([exportConfig], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.system.identity || data.device_name || 'mikrotik'}-export.rsc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReboot = async () => {
    setIsRebooting(true);
    try {
      await api.rebootRouter(data.device_id);
      showToast('ok', `Perintah reboot berhasil dikirim ke router ${data.device_name}. Router sedang memulai ulang.`);
      setShowRebootModal(false);
    } catch (err: any) {
      showToast('err', `Gagal reboot router: ${err.message}`);
    } finally {
      setIsRebooting(false);
    }
  };

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdent.trim()) return;
    setIsSavingIdent(true);
    try {
      await api.setRouterIdentity(data.device_id, newIdent.trim());
      showToast('ok', `Identity router berhasil diubah menjadi "${newIdent.trim()}"`);
      setShowIdentModal(false);
      onRefresh();
    } catch (err: any) {
      showToast('err', `Gagal mengubah identity: ${err.message}`);
    } finally {
      setIsSavingIdent(false);
    }
  };

  const { system, interfaces = [], network, firewall, logs = [], throughput } = data;

  const wirelessData = data.wireless as any;
  const wirelessClients: WirelessClient[] = Array.isArray(wirelessData)
    ? wirelessData
    : (wirelessData?.clients || []);
  const wirelessCount = wirelessData?.client_count ?? wirelessClients.length;

  const serviceItems = Array.isArray(data.services)
    ? data.services
    : ((data.services as any)?.services || []);
  const userItems = Array.isArray((data as any).users)
    ? (data as any).users
    : ((data.services as any)?.users || []);

  const arpItems = (network?.arp || []).map((a: any) => ({
    ...a,
    mac_address: a.mac_address || a.mac,
  }));

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; badge?: number }> = [
    { key: 'overview', label: 'Ringkasan', icon: <Server className="w-3.5 h-3.5" /> },
    { key: 'ai', label: 'AI Optimizer', icon: <Sparkles className="w-3.5 h-3.5 text-indigo-600" /> },
    { key: 'wireless', label: 'Wireless (SSID & Klien)', icon: <Wifi className="w-3.5 h-3.5" />, badge: wirelessCount },
    { key: 'interfaces', label: 'Interfaces', icon: <Layers className="w-3.5 h-3.5" />, badge: interfaces.length },
    { key: 'terminal', label: 'Web Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
    { key: 'network', label: 'Network & ARP', icon: <Network className="w-3.5 h-3.5" />, badge: arpItems.length },
    { key: 'firewall', label: 'Firewall & NAT', icon: <Shield className="w-3.5 h-3.5" />, badge: (firewall?.filter?.length || 0) + (firewall?.nat?.length || 0) },
    { key: 'services', label: 'Service & Akun', icon: <Sliders className="w-3.5 h-3.5" />, badge: serviceItems.length + userItems.length },
    { key: 'ping', label: 'Diagnostik Ping', icon: <Activity className="w-3.5 h-3.5" /> },
    { key: 'logs', label: 'Router Logs', icon: <FileText className="w-3.5 h-3.5" />, badge: logs.length },
  ];

  return (
    <div className="space-y-4 pb-20 font-mono">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`flex items-center gap-2 p-3.5 rounded-xl border text-xs transition-all animate-fadeIn shadow-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span className="flex-1 font-semibold">{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub-Header / Breadcrumb */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToFleet}
            className="p-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 hover:text-slate-900 border border-slate-300 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs"
            title="Kembali ke Daftar Perangkat"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline font-semibold">Perangkat</span>
          </button>

          <div className="h-6 w-px bg-slate-200" />

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-base text-slate-900 font-mono flex items-center gap-2">
                <span>{system.identity || data.device_name}</span>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  Online
                </span>
              </h2>
            </div>
            <div className="text-xs font-mono text-slate-500 flex items-center gap-2 mt-0.5">
              <span>MikroTik {system.board || system.model || system.board_name || ''}</span>
              <span>·</span>
              <span className="text-blue-600 font-semibold">ROS {system.version || system.routeros_version || 'v7'}</span>
              <span>·</span>
              <span className="flex items-center gap-1 text-slate-500">
                <Clock className="w-3 h-3 text-slate-400" />
                Uptime: {system.uptime || '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons: Winbox Tools */}
        <div className="flex items-center gap-2 self-end md:self-auto">

          {/* AI Optimizer Quick Button */}
          <button
            onClick={() => setActiveTab('ai')}
            className={`p-2 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs ${
              activeTab === 'ai' ? 'ring-2 ring-indigo-500 font-bold' : ''
            }`}
            title="Buka AI Optimizer & Diagnostik Router"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
            <span className="hidden sm:inline font-bold">AI Optimize</span>
          </button>

          {/* Export Compact RSC */}
          <button
            onClick={handleExportConfig}
            className="p-2 text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs"
            title="Export Konfigurasi Compact RouterOS (/export compact)"
          >
            <FileDown className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline font-medium">Export</span>
          </button>

          {/* Backup Router */}
          <button
            onClick={handleCreateBackup}
            className="p-2 text-slate-700 hover:text-amber-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs"
            title="Buat File Backup Binary RouterOS (/system backup save)"
          >
            <Database className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline font-medium">Backup</span>
          </button>

          {/* Change Identity Button */}
          <button
            onClick={() => {
              setNewIdent(system.identity || data.device_name || '');
              setShowIdentModal(true);
            }}
            className="p-2 text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs"
            title="Ganti Identity Router"
          >
            <Tag className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline font-medium">Identity</span>
          </button>

          {/* Reboot Router Button */}
          <button
            onClick={() => setShowRebootModal(true)}
            className="p-2 text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs"
            title="Reboot Router"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
            <span className="hidden sm:inline font-medium">Reboot</span>
          </button>

          {/* Refresh Router */}
          <button
            onClick={onRefresh}
            className={`p-2 text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-xl text-xs transition-colors flex items-center gap-1.5 font-mono cursor-pointer shadow-xs ${
              isRefreshing ? 'animate-pulse text-blue-600' : ''
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            <span className="hidden sm:inline font-medium">Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Gauges Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* CPU */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono text-slate-500 uppercase flex justify-between font-semibold">
              <span>CPU Load</span>
              <span className={system.cpu_load >= 80 ? 'text-rose-600 font-bold' : system.cpu_load >= 50 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
                {system.cpu_load || 0}%
              </span>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full ${system.cpu_load >= 80 ? 'bg-rose-500' : system.cpu_load >= 50 ? 'bg-amber-500' : 'bg-emerald-500'} transition-all duration-300`}
                style={{ width: `${Math.min(100, Math.max(0, system.cpu_load || 0))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Free Memory */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Database className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Free Memory</div>
            <div className="text-base font-bold font-mono text-slate-900 mt-0.5 truncate">
              {system.memory_free_mb != null
                ? `${system.memory_free_mb} MB`
                : system.free_memory
                ? `${Math.round(system.free_memory / 1024 / 1024)} MB`
                : '0 MB'}
            </div>
          </div>
        </div>

        {/* Free Storage */}
        {(() => {
          const freeMb = system.disk_free_mb != null
            ? system.disk_free_mb
            : system.free_hdd
            ? Math.round(system.free_hdd / 1024 / 1024)
            : 0;
          const isLowStorage = freeMb < 2;
          return (
            <div className={`bg-white border ${isLowStorage ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200/90'} rounded-2xl p-4 flex items-center gap-3.5 shadow-sm`}>
              <div className={`w-10 h-10 rounded-xl ${isLowStorage ? 'bg-amber-50 border border-amber-300 text-amber-600' : 'bg-indigo-50 border border-indigo-200 text-indigo-600'} flex items-center justify-center`}>
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono text-slate-500 uppercase flex justify-between font-semibold">
                  <span>Free Storage</span>
                  {isLowStorage && <span className="text-[9px] text-amber-600 font-bold">MENIPIS</span>}
                </div>
                <div className={`text-base font-bold font-mono ${isLowStorage ? 'text-amber-600' : 'text-slate-900'} mt-0.5 truncate`}>
                  {freeMb} MB
                </div>
              </div>
            </div>
          );
        })()}

        {/* Connected Clients */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Wifi className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Klien Wireless</div>
            <div className="text-base font-bold font-mono text-amber-600 mt-0.5 truncate">
              {wirelessCount} Klien Aktif
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Navbar (Tab Selector) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin border-b border-slate-200">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-t-xl text-xs font-mono font-medium transition-colors shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-white text-blue-700 border-t-2 border-blue-600 border-x border-slate-200 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && (
                <span
                  className={`text-[10px] px-2 py-0.2 rounded-full font-semibold ${
                    isActive ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Real-time Oscilloscope Banner (Show on Overview tab) */}
      {activeTab === 'overview' && (
        <Oscilloscope
          rxBps={throughput?.rx_bps || 0}
          txBps={throughput?.tx_bps || 0}
          deviceName={system.identity}
        />
      )}

      {/* Tab Panels */}
      <div>
        {activeTab === 'overview' && <TabOverview system={system} deviceId={data.device_id} />}
        {activeTab === 'ai' && (
          <TabAiOptimizer
            deviceId={data.device_id}
            deviceName={system.identity || data.device_name}
            onRefreshParent={onRefresh}
          />
        )}
        {activeTab === 'wireless' && (
          <TabWireless
            deviceId={data.device_id}
            clients={wirelessClients}
            onRefresh={onRefresh}
            onOpenRfScan={(band) => {
              setRfScanBand(band || '2g');
              setShowRfScan(true);
            }}
          />
        )}
        {activeTab === 'interfaces' && (
          <TabInterfaces
            deviceId={data.device_id}
            interfaces={interfaces}
            onRefresh={onRefresh}
          />
        )}
        {activeTab === 'terminal' && (
          <TabTerminal
            deviceId={data.device_id}
            deviceName={system.identity || data.device_name}
          />
        )}
        {activeTab === 'network' && (
          <TabNetworkArp
            arp={arpItems}
            dnsCache={network?.dns_cache || []}
            routes={network?.routes || []}
            addresses={network?.addresses || []}
          />
        )}
        {activeTab === 'firewall' && (
          <TabFirewall filter={firewall?.filter || []} nat={firewall?.nat || []} />
        )}
        {activeTab === 'services' && (
          <TabServices services={serviceItems} users={userItems} />
        )}
        {activeTab === 'ping' && <TabPing deviceId={data.device_id} />}
        {activeTab === 'logs' && <TabLogs logs={logs} />}
      </div>

      {/* MODAL: REBOOT CONFIRMATION */}
      {showRebootModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-rose-200 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Reboot Router MikroTik</h3>
                <p className="text-slate-500 text-[11px]">Konfirmasi tindakan reboot hardware</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-slate-700 space-y-2">
              <p>
                Apakah Anda yakin ingin me-restart router <b className="text-slate-900">{system.identity || data.device_name}</b>?
              </p>
              <p className="text-[11px] text-rose-700 font-semibold">
                Semua koneksi klien WiFi dan link jaringan pada router ini akan terputus sementara (sekitar 30-60 detik) selama proses booting.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowRebootModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors font-semibold cursor-pointer shadow-xs"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleReboot}
                disabled={isRebooting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isRebooting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Mengirim Sinyal...</span>
                  </>
                ) : (
                  <span>Ya, Reboot Sekarang</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT IDENTITY */}
      {showIdentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Ubah Router Identity</h3>
                <p className="text-slate-500 text-[11px]">Nama perangkat di sistem MikroTik (/system identity)</p>
              </div>
            </div>

            <form onSubmit={handleSaveIdentity} className="space-y-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Nama Identity Baru
                </label>
                <input
                  type="text"
                  required
                  value={newIdent}
                  onChange={(e) => setNewIdent(e.target.value)}
                  placeholder="Contoh: APM-HRD / RSU-Melati-Lt2"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-blue-600 font-mono shadow-xs"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowIdentModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors font-semibold cursor-pointer shadow-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingIdent}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {isSavingIdent ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>Simpan Identity</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXPORT CONFIGURATION */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <FileDown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">System Configuration Export (/export compact)</h3>
                  <p className="text-slate-500 text-[11px]">
                    Router: {data.system.identity || data.device_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isExporting ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                <p>Mengekspor konfigurasi dari RouterOS socket API...</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] font-semibold">
                    Total {exportConfig.split('\n').length} baris script RouterOS (.rsc)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyExport}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1.5 transition-colors font-semibold cursor-pointer shadow-xs"
                    >
                      {copiedExport ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700">Tersalin!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Salin Script</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDownloadExport}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 transition-colors font-semibold cursor-pointer shadow-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .rsc</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto bg-slate-50 border border-slate-300 rounded-xl p-3.5 text-[11px] font-mono text-slate-800 select-all max-h-[50vh] shadow-inner">
                  <pre className="whitespace-pre-wrap">{exportConfig}</pre>
                </div>
              </>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors font-semibold cursor-pointer shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BACKUP SYSTEM */}
      {showBackupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">System Backup (/system backup)</h3>
                  <p className="text-slate-500 text-[11px]">Membuat snapshot binary router</p>
                </div>
              </div>
              <button
                onClick={() => setShowBackupModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isBackingUp ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                <RefreshCw className="w-8 h-8 text-amber-600 animate-spin" />
                <p>Membuat file binary backup di router...</p>
              </div>
            ) : backupInfo ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">File Backup Berhasil Dibuat!</div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      File backup telah tersimpan di penyimpanan flash router MikroTik dan siap diunduh atau di-restore kapan saja.
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium">Nama File:</span>
                    <span className="font-bold text-slate-900">{backupInfo.filename}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium">Status:</span>
                    <span className="text-blue-600 font-semibold">{backupInfo.message || 'Selesai'}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium">Lokasi Router:</span>
                    <span className="text-slate-700 font-mono">/file print</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors font-semibold cursor-pointer shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RF Spectrum Scan Drawer */}
      <RfScanDrawer
        isOpen={showRfScan}
        onClose={() => setShowRfScan(false)}
        devices={[{
          id: data.device_id,
          name: system.identity || data.device_name,
          host: '',
          port: 8728,
          user: '',
          group: 'default',
          is_default: false,
        }]}
        defaultDeviceId={data.device_id}
        defaultBand={rfScanBand}
      />
    </div>
  );
};
