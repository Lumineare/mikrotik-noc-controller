import React, { useEffect, useMemo, useState } from 'react';
import {
  Wifi,
  KeyRound,
  Plus,
  Edit3,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { FleetDevice } from '../types';
import { api } from '../api/client';

interface FleetWifiSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  fleet: FleetDevice[];
  initialSelectedIds?: string[];
}

type SyncAction = 'rotate_password' | 'create_ssid' | 'rename_ssid';

interface FleetSsidItem {
  ssid: string;
  ap_count: number;
  interfaces: number;
  bands: string[];
  profiles: string[];
  device_ids: string[];
}

interface SyncResultItem {
  device_id: string;
  device_name: string;
  host: string;
  status: 'ok' | 'skipped' | 'error';
  actions: string[];
  message: string;
}

export const FleetWifiSyncModal: React.FC<FleetWifiSyncModalProps> = ({
  isOpen,
  onClose,
  fleet,
  initialSelectedIds,
}) => {
  const [action, setAction] = useState<SyncAction>('rotate_password');
  const [targetSsid, setTargetSsid] = useState('');
  const [newSsid, setNewSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [securityMode, setSecurityMode] = useState<'password' | 'open'>('password');
  const [bands, setBands] = useState<string[]>(['2g', '5g']);
  const [vlanMode, setVlanMode] = useState<'no-tag' | 'use-tag'>('no-tag');
  const [vlanId, setVlanId] = useState('');
  const [hideSsid, setHideSsid] = useState(false);
  const [addBridge, setAddBridge] = useState(true);
  const [bridgeName, setBridgeName] = useState('bridge1');

  // Target AP selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [apSearch, setApSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');

  // Discovered SSIDs
  const [ssids, setSsids] = useState<FleetSsidItem[]>([]);
  const [scanningSsids, setScanningSsids] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // Execution state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResp, setSyncResp] = useState<{
    dry_run: boolean;
    summary: { total: number; success: number; skipped: number; failed: number };
    results: SyncResultItem[];
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialSelectedIds && initialSelectedIds.length > 0) {
      setSelectedIds(new Set(initialSelectedIds));
    } else {
      setSelectedIds(new Set(fleet.filter((d) => d.online).map((d) => d.id)));
    }
    setError(null);
    setSyncResp(null);
  }, [isOpen, initialSelectedIds, fleet]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, running, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of fleet) {
      const g = d.group || 'Default';
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [fleet]);

  const visibleFleet = useMemo(() => {
    const q = apSearch.trim().toLowerCase();
    return fleet.filter((d) => {
      if (groupFilter !== 'ALL' && (d.group || 'Default') !== groupFilter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.host.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [fleet, apSearch, groupFilter]);

  const handleScanSsids = async () => {
    setScanningSsids(true);
    setError(null);
    try {
      const res = await api.getFleetWifiSsids();
      setSsids(res.ssids || []);
      setScanNote(`Terdeteksi ${res.ssids.length} SSID unik dari ${res.scanned_ok}/${res.total_devices} AP.`);
      if (!targetSsid && res.ssids.length > 0 && action !== 'create_ssid') {
        setTargetSsid(res.ssids[0].ssid);
      }
    } catch (err: any) {
      setError(err?.message || 'Gagal memindai SSID armada');
    } finally {
      setScanningSsids(false);
    }
  };

  const handlePickDiscoveredSsid = (item: FleetSsidItem) => {
    setTargetSsid(item.ssid);
    setSelectedIds(new Set(item.device_ids));
  };

  const toggleBand = (b: '2g' | '5g') => {
    setBands((prev) => {
      if (prev.includes(b)) {
        return prev.length > 1 ? prev.filter((x) => x !== b) : prev;
      }
      return [...prev, b];
    });
  };

  const toggleDevice = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runSync = async (dryRun: boolean) => {
    setError(null);
    if (!targetSsid.trim()) {
      setError('Nama SSID target wajib diisi.');
      return;
    }
    if (action === 'rename_ssid' && !newSsid.trim()) {
      setError('Nama SSID baru wajib diisi.');
      return;
    }
    const needsPwd =
      action === 'rotate_password' || (action === 'create_ssid' && securityMode === 'password');
    if (needsPwd && password.trim().length < 8) {
      setError('Password WPA2-PSK minimal 8 karakter.');
      return;
    }
    if (action === 'rename_ssid' && password.trim() && password.trim().length < 8) {
      setError('Jika mengganti password, minimal 8 karakter.');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Pilih minimal 1 AP target.');
      return;
    }

    if (!dryRun) {
      const actionLabel =
        action === 'rotate_password'
          ? `ganti password SSID "${targetSsid.trim()}"`
          : action === 'create_ssid'
          ? `buat SSID baru "${targetSsid.trim()}"`
          : `ubah SSID "${targetSsid.trim()}" menjadi "${newSsid.trim()}"`;
      const ok = window.confirm(
        `Terapkan ${actionLabel} ke ${selectedIds.size} AP terpilih?\n\nKlien yang sedang terhubung ke SSID terkait mungkin perlu menyambung ulang.`
      );
      if (!ok) return;
    }

    setRunning(true);
    setSyncResp(null);
    try {
      const res = await api.syncFleetWifi({
        action,
        device_ids: Array.from(selectedIds),
        target_ssid: targetSsid.trim(),
        new_ssid: action === 'rename_ssid' ? newSsid.trim() : undefined,
        password: password.trim() || undefined,
        security_mode: securityMode,
        bands,
        vlan_mode: vlanMode,
        vlan_id: vlanMode === 'use-tag' && vlanId ? Number(vlanId) : undefined,
        hide_ssid: hideSsid,
        add_bridge: addBridge,
        bridge_name: bridgeName.trim() || 'bridge1',
        dry_run: dryRun,
      });
      setSyncResp({
        dry_run: res.dry_run,
        summary: res.summary,
        results: res.results,
      });
    } catch (err: any) {
      setError(err?.message || 'Gagal menjalankan sinkronisasi Wi-Fi');
    } finally {
      setRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      onClick={() => !running && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[92vh] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 font-mono">
                Fleet Wi-Fi Sync · Sinkronisasi SSID &amp; Password Massal
              </h2>
              <p className="text-[11px] text-slate-500">
                Rotasi password WPA2-PSK, tambah Virtual AP, atau ubah nama SSID lintas armada AP dengan aman.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            aria-label="Tutup modal Wi-Fi Sync"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Action Mode Tabs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: 'rotate_password',
                  label: 'Ganti Password Wi-Fi',
                  sub: 'Rotasi WPA2-PSK aman tanpa ganggu SSID lain',
                  icon: <KeyRound className="w-4 h-4" />,
                },
                {
                  id: 'create_ssid',
                  label: 'Tambah SSID Baru',
                  sub: 'Deploy Virtual AP + VLAN ke banyak AP',
                  icon: <Plus className="w-4 h-4" />,
                },
                {
                  id: 'rename_ssid',
                  label: 'Ganti Nama SSID',
                  sub: 'Ubah nama SSID (opsional + password baru)',
                  icon: <Edit3 className="w-4 h-4" />,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setAction(tab.id);
                  setSyncResp(null);
                  setError(null);
                }}
                className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                  action === tab.id
                    ? 'bg-blue-50 border-blue-500 text-blue-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className={action === tab.id ? 'text-blue-600' : 'text-slate-500'}>{tab.icon}</span>
                  <span>{tab.label}</span>
                </div>
                <div className="text-[10.5px] text-slate-500 mt-0.5">{tab.sub}</div>
              </button>
            ))}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 2-Column Configuration + Target AP Picker */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left: Wi-Fi Parameters */}
            <div className="lg:col-span-6 space-y-3 bg-slate-50/70 border border-slate-200 rounded-xl p-4 text-xs">
              {/* Scan Existing SSIDs (for rotate_password / rename_ssid) */}
              {action !== 'create_ssid' && (
                <div className="space-y-2 pb-2.5 border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-700">Deteksi SSID di Armada</span>
                    <button
                      type="button"
                      onClick={handleScanSsids}
                      disabled={scanningSsids}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-mono font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${scanningSsids ? 'animate-spin text-blue-600' : ''}`} />
                      <span>{scanningSsids ? 'Memindai...' : 'Scan SSID Armada'}</span>
                    </button>
                  </div>
                  {scanNote && <p className="text-[10.5px] font-mono text-slate-500">{scanNote}</p>}
                  {ssids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-0.5">
                      {ssids.map((s) => (
                        <button
                          key={s.ssid}
                          type="button"
                          onClick={() => handlePickDiscoveredSsid(s)}
                          className={`px-2 py-1 rounded-md border text-[11px] font-mono transition-colors cursor-pointer ${
                            targetSsid === s.ssid
                              ? 'bg-blue-600 text-white border-blue-600 font-bold'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400'
                          }`}
                          title={`Aktif di ${s.ap_count} AP (${s.bands.join('/')}) · klik untuk pilih SSID & AP-nya`}
                        >
                          {s.ssid} <span className="opacity-75">({s.ap_count} AP)</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Target SSID */}
              <div className="space-y-1">
                <label className="block font-semibold text-slate-700">
                  {action === 'create_ssid' ? 'Nama SSID Baru' : 'Nama SSID Target (persis)'}
                </label>
                <input
                  type="text"
                  value={targetSsid}
                  onChange={(e) => setTargetSsid(e.target.value)}
                  placeholder={action === 'create_ssid' ? 'Contoh: RSAM-TAMU-2026' : 'Contoh: RSAM-PEGAWAI'}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-xs text-slate-900"
                />
              </div>

              {/* New SSID Name (rename_ssid only) */}
              {action === 'rename_ssid' && (
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Nama SSID Baru</label>
                  <input
                    type="text"
                    value={newSsid}
                    onChange={(e) => setNewSsid(e.target.value)}
                    placeholder="Masukkan nama SSID pengganti"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-xs text-slate-900"
                  />
                </div>
              )}

              {/* Security Mode (create_ssid only) */}
              {action === 'create_ssid' && (
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Keamanan</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSecurityMode('password')}
                      className={`py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        securityMode === 'password'
                          ? 'bg-blue-50 border-blue-500 text-blue-700'
                          : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      WPA2-PSK (Password)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSecurityMode('open')}
                      className={`py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        securityMode === 'open'
                          ? 'bg-blue-50 border-blue-500 text-blue-700'
                          : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      Open (Tanpa Sandi)
                    </button>
                  </div>
                </div>
              )}

              {/* Password Field */}
              {(action === 'rotate_password' ||
                action === 'rename_ssid' ||
                (action === 'create_ssid' && securityMode === 'password')) && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-700">
                      Password WPA2-PSK Baru {action === 'rename_ssid' ? '(Opsional)' : ''}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showPassword ? 'Sembunyikan' : 'Tampilkan'}</span>
                    </button>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 8 karakter"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-xs text-slate-900"
                  />
                  {action === 'rotate_password' && (
                    <p className="text-[10.5px] text-slate-500 flex items-center gap-1 pt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>
                        Jika security profile dipakai bersama SSID lain, sistem otomatis membuat profile khusus agar SSID lain tidak ikut berubah.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Extra options for create_ssid */}
              {action === 'create_ssid' && (
                <div className="space-y-2.5 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">Band Radio Master</span>
                    <div className="flex items-center gap-2">
                      {(['2g', '5g'] as const).map((b) => (
                        <label key={b} className="inline-flex items-center gap-1.5 cursor-pointer font-mono">
                          <input
                            type="checkbox"
                            checked={bands.includes(b)}
                            onChange={() => toggleBand(b)}
                            className="accent-blue-600"
                          />
                          <span>{b === '2g' ? '2.4 GHz' : '5 GHz'}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">VLAN Tagging</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={vlanMode}
                        onChange={(e) => setVlanMode(e.target.value as any)}
                        className="px-2 py-1 rounded-lg bg-white border border-slate-300 font-mono text-xs"
                      >
                        <option value="no-tag">Untagged</option>
                        <option value="use-tag">Tag VLAN</option>
                      </select>
                      {vlanMode === 'use-tag' && (
                        <input
                          type="number"
                          value={vlanId}
                          onChange={(e) => setVlanId(e.target.value)}
                          placeholder="VLAN ID"
                          className="w-24 px-2 py-1 rounded-lg bg-white border border-slate-300 font-mono text-xs"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addBridge}
                        onChange={(e) => setAddBridge(e.target.checked)}
                        className="accent-blue-600"
                      />
                      <span>Tambah ke bridge</span>
                    </label>
                    {addBridge && (
                      <input
                        type="text"
                        value={bridgeName}
                        onChange={(e) => setBridgeName(e.target.value)}
                        className="w-24 px-2 py-0.5 rounded bg-white border border-slate-300 font-mono text-[11px]"
                      />
                    )}
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideSsid}
                        onChange={(e) => setHideSsid(e.target.checked)}
                        className="accent-blue-600"
                      />
                      <span>Hide SSID</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Target AP Picker */}
            <div className="lg:col-span-6 flex flex-col bg-slate-50/70 border border-slate-200 rounded-xl p-4 text-xs">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-slate-800 font-mono">
                  Target AP ({selectedIds.size} / {fleet.length} dipilih)
                </span>
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(visibleFleet.filter((d) => d.online).map((d) => d.id)))}
                    className="px-2 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Online
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(visibleFleet.map((d) => d.id)))}
                    className="px-2 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="px-2 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-500 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={apSearch}
                    onChange={(e) => setApSearch(e.target.value)}
                    placeholder="Cari nama atau IP AP..."
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-mono text-[11px]"
                  />
                </div>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 font-mono text-[11px] max-w-[140px]"
                >
                  <option value="ALL">Semua Lokasi</option>
                  {groups.map(([g, cnt]) => (
                    <option key={g} value={g}>
                      {g} ({cnt})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-h-[190px] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {visibleFleet.map((d) => {
                  const checked = selectedIds.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer text-[11px] font-mono ${
                        checked ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDevice(d.id)}
                          className="accent-blue-600 shrink-0"
                        />
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            d.online ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        <span className="font-semibold text-slate-800 truncate">{d.name}</span>
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">{d.host}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Results Table */}
          {syncResp && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                <span className="font-bold text-slate-800">
                  {syncResp.dry_run ? 'Hasil Preview (Dry-Run — belum dikirim ke router)' : 'Hasil Sinkronisasi Wi-Fi'}
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-700 font-bold">{syncResp.summary.success} berhasil</span>
                  <span className="text-slate-500 font-semibold">{syncResp.summary.skipped} dilewati</span>
                  {syncResp.summary.failed > 0 && (
                    <span className="text-rose-600 font-bold">{syncResp.summary.failed} gagal</span>
                  )}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 text-[11px] font-mono">
                {syncResp.results.map((r) => (
                  <div key={r.device_id} className="px-4 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800">
                        {r.device_name} <span className="font-normal text-slate-400">({r.host})</span>
                      </div>
                      <div className="text-slate-600 mt-0.5">{r.message}</div>
                      {r.actions.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {r.actions.join(' · ')}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                        r.status === 'ok'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : r.status === 'skipped'
                          ? 'bg-slate-100 text-slate-600 border-slate-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {r.status === 'ok' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : r.status === 'skipped' ? (
                        <MinusCircle className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {r.status === 'ok' ? 'OK' : r.status === 'skipped' ? 'Lewati' : 'Gagal'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap shrink-0">
          <span className="text-[11px] font-mono text-slate-500">
            Disarankan klik <b>Preview (Dry-Run)</b> terlebih dahulu sebelum mengirim ke seluruh AP.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={running}
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              Tutup
            </button>
            <button
              type="button"
              disabled={running || selectedIds.size === 0}
              onClick={() => runSync(true)}
              className="px-3.5 py-2 rounded-xl border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Preview (Dry-Run)</span>
            </button>
            <button
              type="button"
              disabled={running || selectedIds.size === 0}
              onClick={() => runSync(false)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
            >
              {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              <span>Terapkan ke {selectedIds.size} AP</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
