import React, { useState, useEffect } from 'react';
import {
  Clock,
  ArrowDown,
  ArrowUp,
  Search,
  User,
  Plus,
  Trash2,
  Power,
  Lock,
  Layers,
  Radio,
  UserMinus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Sliders,
  Wifi,
  Eye,
  EyeOff,
  Shield,
  Key,
  Edit2,
  Smartphone,
  Laptop,
  Tag,
  Radar,
  Footprints,
} from 'lucide-react';
import { ClientTrailDrawer } from '../locator/ClientTrailDrawer';
import {
  WirelessClient,
  WirelessInterface,
  WirelessUpdateData,
  SecurityProfileDetail,
  SupportedChannel,
} from '../../types';
import { api } from '../../api/client';
import { ConfirmModal } from '../ConfirmModal';
import { AlertModal } from '../AlertModal';

interface TabWirelessProps {
  deviceId?: string;
  clients: WirelessClient[];
  onRefresh?: () => void;
  onOpenRfScan?: (band?: '2g' | '5g') => void;
}

export const TabWireless: React.FC<TabWirelessProps> = ({
  deviceId = '',
  clients = [],
  onRefresh,
  onOpenRfScan,
}) => {
  const [subTab, setSubTab] = useState<'clients' | 'ssids' | 'secprofiles'>('clients');
  const [search, setSearch] = useState('');
  const [interfaces, setInterfaces] = useState<WirelessInterface[]>([]);
  const [securityProfiles, setSecurityProfiles] = useState<string[]>([]);
  const [detailedProfiles, setDetailedProfiles] = useState<SecurityProfileDetail[]>([]);
  const [masterOptions, setMasterOptions] = useState<string[]>([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Kick client state
  const [kickingMac, setKickingMac] = useState<string | null>(null);
  const [selectedMacForTrail, setSelectedMacForTrail] = useState<string | null>(null);

  // Add SSID Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [masterIface, setMasterIface] = useState('wlan1');
  const [customName, setCustomName] = useState('');
  const [ssidName, setSsidName] = useState('');
  const [secMode, setSecMode] = useState<'open' | 'password' | 'existing'>('password');
  const [secPassword, setSecPassword] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [vlanMode, setVlanMode] = useState<'no-tag' | 'use-tag'>('no-tag');
  const [vlanId, setVlanId] = useState('20');
  const [addBridge, setAddBridge] = useState(true);
  const [hideSsid, setHideSsid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Wireless Interface Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingIface, setEditingIface] = useState<WirelessInterface | null>(null);
  const [editSsid, setEditSsid] = useState('');
  const [editFreq, setEditFreq] = useState('auto');
  const [editWidth, setEditWidth] = useState('20mhz');
  const [editBand, setEditBand] = useState('');
  const [editSecMode, setEditSecMode] = useState<'keep' | 'password' | 'existing' | 'open'>('keep');
  const [editSecPassword, setEditSecPassword] = useState('');
  const [editSecProfile, setEditSecProfile] = useState('');
  const [editVlanMode, setEditVlanMode] = useState<'no-tag' | 'use-tag'>('no-tag');
  const [editVlanId, setEditVlanId] = useState('20');
  const [editHideSsid, setEditHideSsid] = useState(false);
  const [editDisabled, setEditDisabled] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  // Real channel list read from the router's own regulatory domain
  const [supportedChannels, setSupportedChannels] = useState<SupportedChannel[]>([]);
  const [channelSource, setChannelSource] = useState<{ country: string; band: string } | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Security Profiles Management State
  const [revealedKeys, setRevealedKeys] = useState<{ [id: string]: boolean }>({});
  const [showAddSecModal, setShowAddSecModal] = useState(false);
  const [newSecName, setNewSecName] = useState('');
  const [newSecKey, setNewSecKey] = useState('');
  const [newSecMode, setNewSecMode] = useState('dynamic-keys');
  const [newSecAuth, setNewSecAuth] = useState('wpa2-psk');
  const [isSavingSec, setIsSavingSec] = useState(false);

  // Edit Sec Profile Modal State
  const [showEditSecModal, setShowEditSecModal] = useState(false);
  const [editingSecProf, setEditingSecProf] = useState<SecurityProfileDetail | null>(null);
  const [editSecKeyVal, setEditSecKeyVal] = useState('');
  const [editSecModeVal, setEditSecModeVal] = useState('dynamic-keys');
  const [editSecAuthVal, setEditSecAuthVal] = useState('wpa2-psk');
  const [isUpdatingSec, setIsUpdatingSec] = useState(false);

  // Modern Confirmation & Alert Modal States
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
  });

  // Fetch wireless interfaces & security profiles
  const loadInterfaces = async () => {
    if (!deviceId) return;
    setLoadingInterfaces(true);
    try {
      const data = await api.getWirelessInterfaces(deviceId);
      setInterfaces(data.interfaces || []);
      setSecurityProfiles(data.security_profiles || []);
      setMasterOptions(data.master_options || ['wlan1', 'wlan2']);
      if (data.master_options?.length > 0 && !masterOptions.includes(masterIface)) {
        setMasterIface(data.master_options[0]);
      }
      if (data.security_profiles?.length > 0 && !selectedProfile) {
        setSelectedProfile(data.security_profiles[0]);
      }
    } catch (err: any) {
      console.error('Failed to load wireless interfaces:', err);
    } finally {
      setLoadingInterfaces(false);
    }
  };

  const loadSecProfiles = async () => {
    if (!deviceId) return;
    try {
      const res = await api.getDetailedSecurityProfiles(deviceId);
      setDetailedProfiles(res.profiles || []);
    } catch (err: any) {
      console.error('Failed to load detailed security profiles:', err);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadInterfaces();
      loadSecProfiles();
    }
  }, [deviceId]);

  // Flash action message
  const showFeedback = (type: 'ok' | 'err', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4500);
  };

  // Toggle SSID enabled/disabled
  const handleToggleSsid = async (iface: WirelessInterface) => {
    try {
      await api.toggleWirelessInterface(deviceId, iface.id, !iface.disabled);
      showFeedback('ok', `SSID ${iface.name} (${iface.ssid}) berhasil di-${iface.disabled ? 'aktifkan' : 'nonaktifkan'}`);
      loadInterfaces();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('err', `Gagal mengubah status: ${err.message}`);
    }
  };

  // Delete Virtual AP
  const handleDeleteSsid = (iface: WirelessInterface) => {
    if (iface.master_interface === 'none' || !iface.master_interface) {
      setAlertModal({
        isOpen: true,
        title: 'Operasi Dibatalkan',
        message: 'Physical Master Interface (wlan1 / wlan2) tidak boleh dihapus karena merupakan modul radio fisik MikroTik!',
        type: 'error',
      });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: `Hapus Virtual AP "${iface.name}"?`,
      message: `Virtual AP "${iface.name}" dengan SSID "${iface.ssid}" akan dihapus dari konfigurasi MikroTik. Klien yang sedang terhubung ke SSID ini akan terputus.`,
      type: 'danger',
      confirmText: 'Ya, Hapus Virtual AP',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        try {
          await api.deleteWirelessInterface(deviceId, iface.id, iface.name);
          showFeedback('ok', `Virtual AP ${iface.name} berhasil dihapus`);
          loadInterfaces();
          if (onRefresh) onRefresh();
        } catch (err: any) {
          showFeedback('err', `Gagal menghapus SSID: ${err.message}`);
        }
      },
    });
  };

  // Kick wireless client
  const handleKickClient = (mac: string, clientId?: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Putuskan Koneksi Klien?',
      message: `Putuskan sambungan klien wireless MAC "${mac}" dari Access Point ini? Klien akan dipaksa re-asosiasi atau roaming ke AP terdekat.`,
      type: 'danger',
      confirmText: 'Putuskan Klien',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setKickingMac(mac);
        try {
          await api.kickWirelessClient(deviceId, clientId, mac);
          showFeedback('ok', `Client ${mac} berhasil diputus`);
          if (onRefresh) onRefresh();
        } catch (err: any) {
          showFeedback('err', `Gagal kick client: ${err.message}`);
        } finally {
          setKickingMac(null);
        }
      },
    });
  };

  // Load the exact channel list this radio accepts (RouterOS country-info)
  const loadSupportedChannels = async (iface: WirelessInterface) => {
    setSupportedChannels([]);
    setChannelSource(null);
    setLoadingChannels(true);
    try {
      const res = await api.getSupportedChannels(deviceId || undefined, iface.id);
      setSupportedChannels(res.channels || []);
      setChannelSource({ country: res.country, band: res.band });
    } catch (err: any) {
      setSupportedChannels([]);
      setChannelSource(null);
    } finally {
      setLoadingChannels(false);
    }
  };

  // Open Edit Wireless Interface Modal
  const openEditModal = (iface: WirelessInterface) => {
    setEditingIface(iface);
    setEditSsid(iface.ssid || '');
    setEditFreq(iface.frequency || 'auto');
    setEditWidth(iface.channel_width || '20mhz');
    setEditBand(iface.band || '');
    setEditSecMode('keep');
    setEditSecPassword('');
    setEditSecProfile(iface.security_profile || 'default');
    setEditVlanMode((iface.vlan_mode as any) || 'no-tag');
    setEditVlanId(iface.vlan_id || '20');
    setEditHideSsid(!!iface.hide_ssid);
    setEditDisabled(!!iface.disabled);
    setShowEditPassword(false);
    setShowEditModal(true);
    if (!iface.master_interface || iface.master_interface === 'none') {
      loadSupportedChannels(iface);
    } else {
      setSupportedChannels([]);
      setChannelSource(null);
    }
  };

  // Submit Edit Wireless Interface
  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIface) return;
    if (!editSsid.trim()) {
      showFeedback('err', 'Nama SSID tidak boleh kosong!');
      return;
    }
    if (editSecMode === 'password' && editSecPassword.length < 8) {
      showFeedback('err', 'Password WPA2-PSK minimal harus 8 karakter!');
      return;
    }

    setIsUpdating(true);
    try {
      const isMaster = !editingIface.master_interface || editingIface.master_interface === 'none';
      const payload: WirelessUpdateData = {
        device: deviceId,
        interface_id: editingIface.id,
        ssid: editSsid.trim(),
        hide_ssid: editHideSsid,
        disabled: editDisabled,
        vlan_mode: editVlanMode,
        vlan_id: editVlanMode === 'use-tag' ? editVlanId : '',
      };

      if (isMaster) {
        payload.frequency = editFreq;
        payload.channel_width = editWidth;
        payload.band = editBand;
      }

      if (editSecMode === 'password') {
        payload.security_mode = 'password';
        payload.password = editSecPassword;
      } else if (editSecMode === 'existing') {
        payload.security_mode = 'existing';
        payload.security_profile = editSecProfile;
      } else if (editSecMode === 'open') {
        payload.security_mode = 'open';
      }

      const res = await api.updateWirelessInterface(payload);
      showFeedback('ok', res.message || `Konfigurasi wireless ${editingIface.name} berhasil disimpan`);
      setShowEditModal(false);
      loadInterfaces();
      loadSecProfiles();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('err', `Gagal menyimpan konfigurasi: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Submit Create SSID
  const handleCreateSsid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssidName.trim()) {
      showFeedback('err', 'Nama SSID tidak boleh kosong!');
      return;
    }
    if (secMode === 'password' && secPassword.length < 8) {
      showFeedback('err', 'Password WPA2 minimal harus 8 karakter!');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.addWirelessInterface({
        device: deviceId,
        master_interface: masterIface,
        name: customName.trim() || undefined,
        ssid: ssidName.trim(),
        security_mode: secMode,
        password: secMode === 'password' ? secPassword : undefined,
        security_profile: secMode === 'existing' ? selectedProfile : undefined,
        vlan_mode: vlanMode,
        vlan_id: vlanMode === 'use-tag' ? vlanId : undefined,
        add_bridge: addBridge,
        bridge_name: 'bridge1',
        hide_ssid: hideSsid,
      });

      showFeedback('ok', `Virtual AP SSID "${ssidName}" berhasil ditambahkan ke MikroTik!`);
      setShowAddModal(false);
      setSsidName('');
      setSecPassword('');
      setCustomName('');
      loadInterfaces();
      loadSecProfiles();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('err', `Gagal membuat SSID: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Security Profile Actions
  const handleAddSecurityProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecName.trim()) return;
    if (newSecMode === 'dynamic-keys' && newSecKey.length < 8) {
      showFeedback('err', 'Password WPA2 minimal harus 8 karakter!');
      return;
    }
    setIsSavingSec(true);
    try {
      await api.addSecurityProfile(deviceId, newSecName.trim(), newSecKey, newSecMode, newSecAuth);
      showFeedback('ok', `Security Profile "${newSecName.trim()}" berhasil dibuat`);
      setShowAddSecModal(false);
      setNewSecName('');
      setNewSecKey('');
      loadSecProfiles();
      loadInterfaces();
    } catch (err: any) {
      showFeedback('err', `Gagal membuat security profile: ${err.message}`);
    } finally {
      setIsSavingSec(false);
    }
  };

  const handleUpdateSecurityProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSecProf) return;
    if (editSecModeVal === 'dynamic-keys' && editSecKeyVal && editSecKeyVal.length < 8) {
      showFeedback('err', 'Password WPA2 minimal harus 8 karakter!');
      return;
    }
    setIsUpdatingSec(true);
    try {
      await api.updateSecurityProfile(
        deviceId,
        editingSecProf.id,
        editSecKeyVal,
        editSecModeVal,
        editSecAuthVal
      );
      showFeedback('ok', `Security Profile "${editingSecProf.name}" berhasil diperbarui`);
      setShowEditSecModal(false);
      loadSecProfiles();
    } catch (err: any) {
      showFeedback('err', `Gagal memperbarui security profile: ${err.message}`);
    } finally {
      setIsUpdatingSec(false);
    }
  };

  const handleDeleteSecurityProfile = (prof: SecurityProfileDetail) => {
    if (prof.default || prof.name === 'default') {
      setAlertModal({
        isOpen: true,
        title: 'Profil Default Dilindungi',
        message: "Profile 'default' bawaan sistem RouterOS tidak boleh dihapus demi keamanan konfigurasi dasar wireless MikroTik.",
        type: 'error',
      });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: `Hapus Security Profile "${prof.name}"?`,
      message: `Security Profile "${prof.name}" akan dihapus permanen. Pastikan tidak ada SSID yang saat ini sedang menggunakan profil ini.`,
      type: 'danger',
      confirmText: 'Ya, Hapus Profil',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        try {
          await api.deleteSecurityProfile(deviceId, prof.id, prof.name);
          showFeedback('ok', `Security Profile "${prof.name}" berhasil dihapus`);
          loadSecProfiles();
          loadInterfaces();
        } catch (err: any) {
          showFeedback('err', `Gagal menghapus security profile: ${err.message}`);
        }
      },
    });
  };

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      c.mac.toLowerCase().includes(q) ||
      (c.interface && c.interface.toLowerCase().includes(q)) ||
      (c.ip && c.ip.toLowerCase().includes(q)) ||
      (c.comment && c.comment.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-3.5">
      {/* Toast Feedback */}
      {actionMsg && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-mono transition-all animate-fadeIn ${
            actionMsg.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}
        >
          {actionMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="flex-1">{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub Navbar & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setSubTab('clients')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              subTab === 'clients'
                ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Klien Terhubung</span>
            <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">
              {clients.length}
            </span>
          </button>

          <button
            onClick={() => {
              setSubTab('ssids');
              loadInterfaces();
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              subTab === 'ssids'
                ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>SSID & Virtual APs</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold">
              {interfaces.length || '...'}
            </span>
          </button>

          <button
            onClick={() => {
              setSubTab('secprofiles');
              loadSecProfiles();
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              subTab === 'secprofiles'
                ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Security Profiles</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold">
              {detailedProfiles.length || '...'}
            </span>
          </button>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center gap-2.5">
          {subTab === 'clients' && (
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter MAC, IP, atau interface..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
              />
            </div>
          )}

          {subTab === 'ssids' && (
            <div className="flex items-center gap-2">
              {onOpenRfScan && (
                <button
                  onClick={() => onOpenRfScan('2g')}
                  className="px-3 py-1.5 rounded-xl border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-xs font-mono flex items-center gap-1.5 font-bold cursor-pointer shadow-xs transition-colors"
                  title="Scan Spektrum Frekuensi RF Live dari Router Ini"
                >
                  <Radar className="w-3.5 h-3.5 text-cyan-600" />
                  <span>Scan Frekuensi RF</span>
                </button>
              )}

              <button
                onClick={loadInterfaces}
                disabled={loadingInterfaces}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900 text-xs font-mono flex items-center gap-1.5 font-semibold cursor-pointer shadow-xs"
                title="Refresh Daftar SSID"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingInterfaces ? 'animate-spin text-blue-600' : ''}`} />
                <span>Reload</span>
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm shadow-blue-500/20 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tambah SSID</span>
              </button>
            </div>
          )}

          {subTab === 'secprofiles' && (
            <div className="flex items-center gap-2">
              <button
                onClick={loadSecProfiles}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900 text-xs font-mono flex items-center gap-1.5 font-semibold cursor-pointer shadow-xs"
                title="Refresh Profiles"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                <span>Reload</span>
              </button>

              <button
                onClick={() => {
                  setNewSecName('');
                  setNewSecKey('');
                  setShowAddSecModal(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm shadow-blue-500/20 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tambah Profile</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* VIEW 1: WIRELESS CLIENTS TABLE */}
      {subTab === 'clients' && (
        <>
          {filteredClients.length === 0 ? (
            <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl text-slate-500 text-xs font-mono shadow-sm">
              {clients.length === 0
                ? 'Tidak ada client wireless yang sedang terhubung'
                : 'Tidak ada hasil pencarian'}
            </div>
          ) : (
            <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="py-3 px-4">Brand, Seri &amp; MAC</th>
                    <th className="py-3 px-4">Interface AP</th>
                    <th className="py-3 px-4">Kualitas Sinyal (dBm)</th>
                    <th className="py-3 px-4">Rate TX / RX</th>
                    <th className="py-3 px-4">Uptime Koneksi</th>
                    <th className="py-3 px-4">Keterangan / IP</th>
                    <th className="py-3 px-4 text-center">Aksi (Winbox)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredClients.map((c, idx) => {
                    const rawSig =
                      (c as any).signal_dbm ?? (c as any).signal_strength ?? (c as any).signal;
                    const sig =
                      typeof rawSig === 'number'
                        ? rawSig
                        : parseInt(String(rawSig || '-70').split('@')[0], 10) || -70;

                    let sigText = 'text-emerald-700';
                    let sigBg = 'bg-emerald-500';
                    let sigQuality = 'Sangat Baik';
                    if (sig < -75) {
                      sigText = 'text-rose-700';
                      sigBg = 'bg-rose-500';
                      sigQuality = 'Lemah';
                    } else if (sig < -65) {
                      sigText = 'text-amber-700';
                      sigBg = 'bg-amber-500';
                      sigQuality = 'Cukup';
                    }

                    const sigPercent = Math.min(
                      100,
                      Math.max(10, Math.round(((sig + 90) / 50) * 100))
                    );

                    const isMobile = c.device_type === 'mobile';
                    const isLaptop =
                      c.device_type === 'laptop' ||
                      c.device_name?.toLowerCase().includes('laptop') ||
                      c.device_name?.toLowerCase().includes('pc') ||
                      (c.brand && ['lenovo', 'dell', 'hp', 'asus'].includes(c.brand.toLowerCase()));

                    const getBrandBadge = (brand?: string) => {
                      const b = (brand || '').toLowerCase();
                      if (b.includes('samsung')) return 'bg-blue-600 text-white';
                      if (b.includes('apple')) return 'bg-slate-900 text-white';
                      if (b.includes('xiaomi') || b.includes('poco') || b.includes('redmi')) return 'bg-amber-600 text-white';
                      if (b.includes('oppo')) return 'bg-emerald-700 text-white';
                      if (b.includes('vivo')) return 'bg-indigo-600 text-white';
                      if (b.includes('infinix') || b.includes('tecno')) return 'bg-teal-600 text-white';
                      if (b.includes('realme')) return 'bg-yellow-500 text-slate-900 font-bold';
                      if (b.includes('lenovo')) return 'bg-rose-700 text-white';
                      if (b.includes('asus')) return 'bg-sky-700 text-white';
                      if (b.includes('dell') || b.includes('hp')) return 'bg-cyan-700 text-white';
                      return 'bg-slate-700 text-white';
                    };

                    return (
                      <tr key={c.mac || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 text-slate-900">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 font-bold text-xs">
                              {c.brand && (
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${getBrandBadge(c.brand)}`}>
                                  {c.brand}
                                </span>
                              )}
                              {isMobile ? (
                                <Smartphone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              ) : isLaptop ? (
                                <Laptop className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                              ) : (
                                <User className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              )}
                              <span>{c.model_series || c.device_name || 'Perangkat Tanpa Nama'}</span>
                              {c.is_custom_name ? (
                                <span className="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5">
                                  <Tag className="w-2.5 h-2.5" />
                                  Kustom
                                </span>
                              ) : null}
                            </div>
                            {c.is_custom_name && c.device_name && (
                              <div className="text-[10px] text-blue-700 font-semibold flex items-center gap-1">
                                <span>Label: {c.device_name}</span>
                              </div>
                            )}
                            <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                              <span className="font-semibold text-slate-700">{c.mac}</span>
                              {c.ip && (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-blue-600">{c.ip}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                            {c.interface || 'wlan1'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${sigText}`}>{sig} dBm</span>
                            <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${sigBg}`}
                                style={{ width: `${sigPercent}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-400 font-medium">({sigQuality})</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 text-slate-600 text-[11px]">
                            <span className="flex items-center gap-0.5 text-blue-600 font-semibold">
                              <ArrowDown className="w-3 h-3" /> {c.rx_rate || '-'}
                            </span>
                            <span>/</span>
                            <span className="flex items-center gap-0.5 text-emerald-600 font-semibold">
                              <ArrowUp className="w-3 h-3" /> {c.tx_rate || '-'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{c.uptime || '-'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {c.ip ? (
                            <span className="text-slate-900 font-medium">{c.ip}</span>
                          ) : (
                            c.comment || '-'
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setSelectedMacForTrail(c.mac)}
                              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[11px] font-mono flex items-center gap-1 transition-colors font-semibold cursor-pointer shadow-xs"
                              title="Lihat riwayat roaming / jejak perangkat ini"
                            >
                              <Footprints className="w-3 h-3 text-blue-600" />
                              <span>Jejak</span>
                            </button>
                            <button
                              onClick={() => handleKickClient(c.mac, (c as any).id)}
                              disabled={kickingMac === c.mac}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-mono flex items-center gap-1 transition-colors font-semibold cursor-pointer shadow-xs"
                              title="Putuskan koneksi client ini (Winbox registration-table remove)"
                            >
                              <UserMinus className="w-3 h-3 text-rose-600" />
                              <span>{kickingMac === c.mac ? 'Memutus...' : 'Kick'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* VIEW 2: SSIDs & VIRTUAL APs TABLE */}
      {subTab === 'ssids' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">Interface</th>
                <th className="py-3 px-4">Nama SSID</th>
                <th className="py-3 px-4">Tipe & Master</th>
                <th className="py-3 px-4">Band / Channel</th>
                <th className="py-3 px-4">Keamanan Profile</th>
                <th className="py-3 px-4">VLAN Tag</th>
                <th className="py-3 px-4 text-center">Klien</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Aksi (Winbox)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {interfaces.map((w) => {
                const isVirtual = w.master_interface && w.master_interface !== 'none';
                return (
                  <tr
                    key={w.id || w.name}
                    className={`hover:bg-slate-50 transition-colors ${
                      w.disabled ? 'opacity-50 bg-slate-50/50' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-blue-600" />
                        <span>{w.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{w.ssid || '(Tanpa SSID)'}</div>
                      {w.hide_ssid && (
                        <span className="text-[10px] text-amber-600 font-semibold">
                          [Hidden SSID]
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isVirtual ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                          <Layers className="w-3 h-3" />
                          <span>Virtual AP ({w.master_interface})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                          Physical Master
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {w.band || w.frequency ? (
                        <div className="space-y-0.5">
                          <div>
                            <span className="text-slate-900 font-semibold">{w.frequency ? `${w.frequency} MHz` : 'Auto'}</span>
                            {w.channel_width && (
                              <span className="ml-1 text-[10px] text-blue-600 font-semibold">({w.channel_width})</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{w.band}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Ngikut Master</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-3 h-3 text-slate-400" />
                        <span
                          className={`font-semibold ${
                            w.security_profile === 'default'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {w.security_profile}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {w.vlan_mode === 'use-tag' && w.vlan_id ? (
                        <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-semibold">
                          VLAN {w.vlan_id}
                        </span>
                      ) : (
                        <span className="text-slate-400">Untagged</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold text-[11px] border border-slate-200">
                        {w.clients_count || 0}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {w.disabled ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] uppercase font-bold">
                          Disabled
                        </span>
                      ) : w.running ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] uppercase font-bold">
                          Running
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] uppercase font-semibold">
                          Enabled (Idle)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* RF Spectrum Scan for Master radio */}
                        {!isVirtual && onOpenRfScan && (
                          <button
                            onClick={() => onOpenRfScan(w.band?.includes('5ghz') ? '5g' : '2g')}
                            className="p-1.5 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-700 transition-colors cursor-pointer shadow-xs"
                            title={`Scan Spektrum Frekuensi ${w.band?.includes('5ghz') ? '5 GHz' : '2.4 GHz'} untuk ${w.name}`}
                          >
                            <Radar className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Edit Wireless & SSID Button */}
                        <button
                          onClick={() => openEditModal(w)}
                          className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 transition-colors cursor-pointer shadow-xs"
                          title="Edit Konfigurasi Wireless (Nama SSID, Channel, Keamanan, VLAN)"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>

                        {/* Power Toggle Button */}
                        <button
                          onClick={() => handleToggleSsid(w)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-xs ${
                            w.disabled
                              ? 'bg-slate-100 hover:bg-emerald-50 hover:border-emerald-300 text-slate-500 hover:text-emerald-700 border-slate-200'
                              : 'bg-emerald-50 hover:bg-rose-50 border-emerald-200 hover:border-rose-300 text-emerald-700 hover:text-rose-700'
                          }`}
                          title={w.disabled ? 'Aktifkan SSID ini' : 'Nonaktifkan SSID ini'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Virtual AP Button */}
                        {isVirtual ? (
                          <button
                            onClick={() => handleDeleteSsid(w)}
                            className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 transition-colors cursor-pointer shadow-xs"
                            title="Hapus Virtual AP ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span
                            className="p-1.5 text-slate-300 cursor-not-allowed"
                            title="Physical Master tidak dapat dihapus"
                          >
                            <Trash2 className="w-3.5 h-3.5 opacity-30" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: SECURITY PROFILES TABLE */}
      {subTab === 'secprofiles' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">Nama Profile</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4">Authentication Types</th>
                <th className="py-3 px-4">WPA2 Pre-Shared Key</th>
                <th className="py-3 px-4">Ciphers</th>
                <th className="py-3 px-4 text-center">Tipe</th>
                <th className="py-3 px-4 text-center">Aksi (Winbox)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {detailedProfiles.map((p) => {
                const isKeyRevealed = !!revealedKeys[p.id];
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <Key className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-slate-900 font-bold">{p.name}</span>
                        {p.default && (
                          <span className="text-[10px] px-2 py-0.2 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                            Default
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                        {p.mode}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {p.authentication_types || <span className="text-slate-400">None (Open)</span>}
                    </td>
                    <td className="py-3 px-4">
                      {p.mode === 'dynamic-keys' ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-900 font-semibold">
                            {isKeyRevealed ? p.wpa2_key || '(Kosong)' : '••••••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedKeys((prev) => ({
                                ...prev,
                                [p.id]: !prev[p.id],
                              }))
                            }
                            className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                            title={isKeyRevealed ? 'Sembunyikan Password' : 'Lihat Password'}
                          >
                            {isKeyRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px]">
                      {p.unicast_ciphers ? `unicast: ${p.unicast_ciphers}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {p.default ? (
                        <span className="text-slate-500 text-[11px] font-medium">System Builtin</span>
                      ) : (
                        <span className="text-emerald-700 text-[11px] font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          User Custom
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditingSecProf(p);
                            setEditSecKeyVal(p.wpa2_key || '');
                            setEditSecModeVal(p.mode || 'dynamic-keys');
                            setEditSecAuthVal(p.authentication_types || 'wpa2-psk');
                            setShowEditSecModal(true);
                          }}
                          className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 transition-colors cursor-pointer shadow-xs"
                          title="Edit Security Profile & Ganti Password"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {!p.default ? (
                          <button
                            onClick={() => handleDeleteSecurityProfile(p)}
                            className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 transition-colors cursor-pointer shadow-xs"
                            title="Hapus Profile ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span
                            className="p-1.5 text-slate-300 cursor-not-allowed"
                            title="Profile default tidak dapat dihapus"
                          >
                            <Trash2 className="w-3.5 h-3.5 opacity-30" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: EDIT WIRELESS INTERFACE & SSID */}
      {showEditModal && editingIface && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-4 animate-scaleIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <span>Edit Konfigurasi Wireless: {editingIface.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                      {editingIface.master_interface && editingIface.master_interface !== 'none'
                        ? 'Virtual AP'
                        : 'Physical Master Radio'}
                    </span>
                  </h3>
                  <p className="text-slate-500 text-[11px]">
                    Winbox Interface Wireless Configuration
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="space-y-4">
              {/* Field 1: Nama SSID */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-blue-600" />
                  <span>Nama SSID (Nama Sinyal WiFi yang Dipancarkan)</span>
                </label>
                <input
                  type="text"
                  required
                  value={editSsid}
                  onChange={(e) => setEditSsid(e.target.value)}
                  placeholder="Contoh: RSU Anwar Medika / Ruang Operasi"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono text-sm shadow-xs"
                />
              </div>

              {/* Field 2: Channel, Frekuensi & Band (Khusus Physical Master wlan1/wlan2) */}
              {(!editingIface.master_interface || editingIface.master_interface === 'none') ? (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2 text-blue-700 font-semibold text-xs">
                    <Radio className="w-4 h-4 text-blue-600" />
                    <span>Pengaturan Radio, Frekuensi & Channel</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Frekuensi / Channel */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-slate-600 text-[11px] font-medium">
                          Frekuensi / Channel
                        </label>
                        {onOpenRfScan && (
                          <button
                            type="button"
                            onClick={() => onOpenRfScan(editingIface.band?.includes('5ghz') ? '5g' : '2g')}
                            className="text-[10px] text-cyan-700 hover:text-cyan-800 font-mono font-semibold flex items-center gap-1 cursor-pointer"
                            title="Scan spektrum RF untuk melihat rekomendasi frekuensi terbaik"
                          >
                            <Radar className="w-3 h-3 text-cyan-600" />
                            <span>Cek Spektrum</span>
                          </button>
                        )}
                      </div>
                      <select
                        value={editFreq}
                        onChange={(e) => setEditFreq(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-slate-900 text-xs font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                      >
                        <option value="auto">auto - Pemilihan Frekuensi Otomatis</option>
                        {loadingChannels ? (
                          <option value="" disabled>
                            Membaca daftar channel dari router...
                          </option>
                        ) : supportedChannels.length > 0 ? (
                          supportedChannels.map((c) => (
                            <option key={c.freq} value={String(c.freq)}>
                              {c.freq} MHz — Channel {c.channel}
                              {c.is_dfs ? ' (DFS)' : ''}
                              {c.max_power ? ` · maks ${c.max_power}` : ''}
                            </option>
                          ))
                        ) : (
                          // Fallback when the router could not be queried
                          (editingIface.band?.includes('2ghz') || editingIface.name === 'wlan1') ? (
                            <>
                              <option value="2412">2412 MHz — Channel 1</option>
                              <option value="2417">2417 MHz — Channel 2</option>
                              <option value="2422">2422 MHz — Channel 3</option>
                              <option value="2427">2427 MHz — Channel 4</option>
                              <option value="2432">2432 MHz — Channel 5</option>
                              <option value="2437">2437 MHz — Channel 6</option>
                              <option value="2442">2442 MHz — Channel 7</option>
                              <option value="2447">2447 MHz — Channel 8</option>
                              <option value="2452">2452 MHz — Channel 9</option>
                              <option value="2457">2457 MHz — Channel 10</option>
                              <option value="2462">2462 MHz — Channel 11</option>
                              <option value="2467">2467 MHz — Channel 12</option>
                              <option value="2472">2472 MHz — Channel 13</option>
                            </>
                          ) : (
                            <>
                              <option value="5745">5745 MHz — Channel 149</option>
                              <option value="5765">5765 MHz — Channel 153</option>
                              <option value="5785">5785 MHz — Channel 157</option>
                              <option value="5805">5805 MHz — Channel 161</option>
                              <option value="5825">5825 MHz — Channel 165</option>
                            </>
                          )
                        )}
                      </select>
                      {!loadingChannels && supportedChannels.length > 0 && channelSource && (
                        <p className="text-[10px] text-slate-500 mt-1 font-mono">
                          {supportedChannels.length} channel valid · country {channelSource.country} ·{' '}
                          {channelSource.band === '5g' ? '5 GHz' : '2.4 GHz'}
                        </p>
                      )}
                      {!loadingChannels && supportedChannels.length === 0 && (
                        <p className="text-[10px] text-amber-700 mt-1 font-mono">
                          Daftar channel real belum terbaca — memakai daftar cadangan.
                        </p>
                      )}
                    </div>

                    {/* Channel Width */}
                    <div>
                      <label className="block text-slate-600 text-[11px] mb-1 font-medium">
                        Channel Width (Lebar Pita)
                      </label>
                      <select
                        value={editWidth}
                        onChange={(e) => setEditWidth(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-slate-900 text-xs font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                      >
                        <option value="20mhz">20 MHz (Stabil, Rendah Interferensi)</option>
                        <option value="20/40mhz-Ce">20/40 MHz Ce (Ekstensi Atas)</option>
                        <option value="20/40mhz-eC">20/40 MHz eC (Ekstensi Bawah)</option>
                        <option value="20/40mhz-XX">20/40 MHz XX (Otomatis)</option>
                        {editingIface.name === 'wlan2' || editingIface.band?.includes('5ghz') ? (
                          <>
                            <option value="20/40/80mhz-Ceee">20/40/80 MHz Ceee (High Throughput 80MHz)</option>
                            <option value="20/40/80mhz-eCee">20/40/80 MHz eCee</option>
                          </>
                        ) : null}
                      </select>
                    </div>
                  </div>

                  {/* Band Selector */}
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-medium">
                      Wireless Band Protocol
                    </label>
                    <select
                      value={editBand}
                      onChange={(e) => setEditBand(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-slate-900 text-xs font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                    >
                      {editingIface.name === 'wlan1' || editingIface.band?.includes('2ghz') ? (
                        <>
                          <option value="2ghz-b/g/n">2ghz-b/g/n (Kompatibel Semua Klien)</option>
                          <option value="2ghz-only-n">2ghz-only-n (High Speed N)</option>
                          <option value="2ghz-b/g">2ghz-b/g (Legacy)</option>
                        </>
                      ) : (
                        <>
                          <option value="5ghz-a/n/ac">5ghz-a/n/ac (Kompatibel 5GHz Paling Optimal)</option>
                          <option value="5ghz-only-ac">5ghz-only-ac (Pure 802.11ac)</option>
                          <option value="5ghz-only-n">5ghz-only-n</option>
                          <option value="5ghz-a/n">5ghz-a/n</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 flex items-start gap-2.5 text-indigo-900 text-[11px]">
                  <Layers className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-indigo-950">Virtual AP Berbagi Radio Fisik:</span> Interface ini adalah Virtual AP yang menumpang pada radio fisik <b>{editingIface.master_interface}</b>. Frekuensi radio, channel width, dan band diatur secara global melalui interface master <b>{editingIface.master_interface}</b>.
                  </div>
                </div>
              )}

              {/* Field 3: Keamanan & Password WiFi */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Keamanan & Password WiFi</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setEditSecMode('keep')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      editSecMode === 'keep'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Tetap Sama</div>
                    <div className="text-[9px] text-slate-500 truncate">({editingIface.security_profile})</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditSecMode('password')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      editSecMode === 'password'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Ganti Password</div>
                    <div className="text-[9px] text-slate-500">WPA2-PSK Baru</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditSecMode('existing')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      editSecMode === 'existing'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Profil Lain</div>
                    <div className="text-[9px] text-slate-500">Pilih dari Router</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditSecMode('open')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      editSecMode === 'open'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Open (Polos)</div>
                    <div className="text-[9px] text-slate-500">Tanpa Password</div>
                  </button>
                </div>

                {editSecMode === 'password' && (
                  <div className="mt-2 relative">
                    <input
                      type={showEditPassword ? 'text' : 'password'}
                      value={editSecPassword}
                      onChange={(e) => setEditSecPassword(e.target.value)}
                      placeholder="Ketik password WiFi baru (min 8 karakter)..."
                      className="w-full bg-slate-50 border border-blue-300 rounded-xl pl-3 pr-10 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                )}

                {editSecMode === 'existing' && (
                  <div className="mt-2">
                    <select
                      value={editSecProfile}
                      onChange={(e) => setEditSecProfile(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600 font-mono shadow-xs"
                    >
                      {securityProfiles.map((p) => (
                        <option key={p} value={p}>
                          Profile: {p}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Field 4: VLAN Mode & Tagging */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="block text-slate-700 font-semibold text-xs">
                  VLAN Tagging & Isolasi Jaringan
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                    <input
                      type="radio"
                      name="editVlanMode"
                      checked={editVlanMode === 'no-tag'}
                      onChange={() => setEditVlanMode('no-tag')}
                      className="text-blue-600 focus:ring-0"
                    />
                    <span>Untagged (no-tag)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                    <input
                      type="radio"
                      name="editVlanMode"
                      checked={editVlanMode === 'use-tag'}
                      onChange={() => setEditVlanMode('use-tag')}
                      className="text-blue-600 focus:ring-0"
                    />
                    <span>Gunakan VLAN (use-tag)</span>
                  </label>
                </div>

                {editVlanMode === 'use-tag' && (
                  <div className="pt-2 flex items-center gap-2">
                    <span className="text-slate-600 text-xs font-medium">VLAN ID:</span>
                    <input
                      type="number"
                      value={editVlanId}
                      onChange={(e) => setEditVlanId(e.target.value)}
                      placeholder="Contoh: 20"
                      className="w-32 bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                    />
                    <span className="text-[11px] text-slate-500">
                      (VLAN 20 = Ruang Pegawai/HRD, VLAN 200 = Tamu)
                    </span>
                  </div>
                )}
              </div>

              {/* Field 5: Options Checkboxes */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 select-none font-medium">
                  <input
                    type="checkbox"
                    checked={editHideSsid}
                    onChange={(e) => setEditHideSsid(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0"
                  />
                  <span>Sembunyikan SSID (Hide SSID broadcast dari pencarian WiFi)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-700 select-none font-medium">
                  <input
                    type="checkbox"
                    checked={!editDisabled}
                    onChange={(e) => setEditDisabled(!e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-0"
                  />
                  <span>Interface Wireless Aktif (Enabled)</span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menyimpan ke RouterOS...</span>
                    </>
                  ) : (
                    <span>Simpan Perubahan ke Router</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SSID (VIRTUAL AP) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-4 animate-scaleIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Tambah SSID Baru (Virtual AP)</h3>
                  <p className="text-slate-500 text-[11px]">
                    Membuat Virtual AP baru di cAP ac via native RouterOS API
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSsid} className="space-y-4">
              {/* Master Interface */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Master Interface (Radio Fisik)
                </label>
                <select
                  value={masterIface}
                  onChange={(e) => setMasterIface(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 font-mono shadow-xs"
                >
                  {masterOptions.map((m) => (
                    <option key={m} value={m}>
                      {m} {m === 'wlan1' ? '(2.4 GHz)' : m === 'wlan2' ? '(5 GHz)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Pilih wlan1 untuk jangkauan luas (2.4GHz) atau wlan2 untuk kecepatan tinggi (5GHz).
                </p>
              </div>

              {/* SSID Name */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Nama SSID (Nama WiFi)
                </label>
                <input
                  type="text"
                  required
                  value={ssidName}
                  onChange={(e) => setSsidName(e.target.value)}
                  placeholder="Contoh: RSU-Anwar-Ruang-Operasi / WiFi-Tamu"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono shadow-xs"
                />
              </div>

              {/* Interface Name (Optional) */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Nama Interface <span className="text-slate-500 font-normal">(Opsional)</span>
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Contoh: wlan-ruang-operasi (otomatis wlanX jika kosong)"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono text-xs shadow-xs"
                />
              </div>

              {/* Security Mode */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Keamanan WiFi</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSecMode('password')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      secMode === 'password'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Password Baru</div>
                    <div className="text-[9px] text-slate-500">WPA2-PSK</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSecMode('existing')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      secMode === 'existing'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Profil Ada</div>
                    <div className="text-[9px] text-slate-500">Gunakan Security Profile</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSecMode('open')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      secMode === 'open'
                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-[11px]">Open (Polos)</div>
                    <div className="text-[9px] text-slate-500">Tanpa Sandi</div>
                  </button>
                </div>

                {secMode === 'password' && (
                  <div className="mt-2">
                    <input
                      type="password"
                      value={secPassword}
                      onChange={(e) => setSecPassword(e.target.value)}
                      placeholder="Ketik password WPA2-PSK (minimal 8 karakter)..."
                      className="w-full bg-slate-50 border border-blue-300 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono shadow-xs"
                    />
                  </div>
                )}

                {secMode === 'existing' && (
                  <div className="mt-2">
                    <select
                      value={selectedProfile}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600 font-mono shadow-xs"
                    >
                      {securityProfiles.map((p) => (
                        <option key={p} value={p}>
                          Profile: {p}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* VLAN Settings */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="block text-slate-700 font-semibold text-xs">
                  VLAN Mode & Isolasi Jaringan
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                    <input
                      type="radio"
                      name="vlanMode"
                      checked={vlanMode === 'no-tag'}
                      onChange={() => setVlanMode('no-tag')}
                      className="text-blue-600 focus:ring-0"
                    />
                    <span>Untagged (no-tag)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                    <input
                      type="radio"
                      name="vlanMode"
                      checked={vlanMode === 'use-tag'}
                      onChange={() => setVlanMode('use-tag')}
                      className="text-blue-600 focus:ring-0"
                    />
                    <span>Tag VLAN (use-tag)</span>
                  </label>
                </div>

                {vlanMode === 'use-tag' && (
                  <div className="pt-2 flex items-center gap-2">
                    <span className="text-slate-600 text-xs font-medium">VLAN ID:</span>
                    <input
                      type="number"
                      value={vlanId}
                      onChange={(e) => setVlanId(e.target.value)}
                      placeholder="Contoh: 20"
                      className="w-28 bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                    />
                    <span className="text-[11px] text-slate-500">
                      (VLAN 20 = Pegawai, 200 = Tamu)
                    </span>
                  </div>
                )}
              </div>

              {/* Bridge & Hidden Checkboxes */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 select-none font-medium">
                  <input
                    type="checkbox"
                    checked={addBridge}
                    onChange={(e) => setAddBridge(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0"
                  />
                  <span>Tambahkan otomatis ke port <b>bridge1</b> (LAN)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-700 select-none font-medium">
                  <input
                    type="checkbox"
                    checked={hideSsid}
                    onChange={(e) => setHideSsid(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0"
                  />
                  <span>Sembunyikan SSID (Hide SSID broadcast)</span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menyimpan ke Router...</span>
                    </>
                  ) : (
                    <span>Buat SSID Sekarang</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SECURITY PROFILE */}
      {showAddSecModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Tambah Security Profile</h3>
                  <p className="text-slate-500 text-[11px]">Membuat profil enkripsi baru di RouterOS</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddSecModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSecurityProfile} className="space-y-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nama Profile</label>
                <input
                  type="text"
                  required
                  value={newSecName}
                  onChange={(e) => setNewSecName(e.target.value)}
                  placeholder="Contoh: VIP-Medis / Direksi-WPA2"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono shadow-xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Mode Enkripsi</label>
                <select
                  value={newSecMode}
                  onChange={(e) => setNewSecMode(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                >
                  <option value="dynamic-keys">dynamic-keys (WPA2-PSK / WPA-PSK Standar)</option>
                  <option value="none">none (Open / Tanpa Password)</option>
                </select>
              </div>

              {newSecMode === 'dynamic-keys' && (
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">WPA2 Pre-Shared Key</label>
                  <input
                    type="password"
                    required
                    value={newSecKey}
                    onChange={(e) => setNewSecKey(e.target.value)}
                    placeholder="Minimal 8 karakter..."
                    className="w-full bg-slate-50 border border-blue-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Password ini akan dipakai oleh semua SSID yang menggunakan profil ini.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddSecModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingSec}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  {isSavingSec ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Buat Profile</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SECURITY PROFILE */}
      {showEditSecModal && editingSecProf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scaleIn">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Edit Profile: {editingSecProf.name}</h3>
                  <p className="text-slate-500 text-[11px]">Ubah password & mode security profile</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditSecModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSecurityProfile} className="space-y-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Mode Enkripsi</label>
                <select
                  value={editSecModeVal}
                  onChange={(e) => setEditSecModeVal(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                >
                  <option value="dynamic-keys">dynamic-keys (WPA2-PSK)</option>
                  <option value="none">none (Open / Tanpa Password)</option>
                </select>
              </div>

              {editSecModeVal === 'dynamic-keys' && (
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    WPA2 Pre-Shared Key (Password Baru)
                  </label>
                  <input
                    type="text"
                    required
                    value={editSecKeyVal}
                    onChange={(e) => setEditSecKeyVal(e.target.value)}
                    placeholder="Minimal 8 karakter..."
                    className="w-full bg-slate-50 border border-blue-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-blue-600 shadow-xs"
                  />
                  <p className="text-[11px] text-amber-700 mt-1">
                    Mengubah password di sini otomatis mengubah password untuk seluruh SSID yang menggunakan profil ini.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEditSecModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingSec}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  {isUpdatingSec ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Simpan Perubahan</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern Confirmation Dialog */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        type={confirmModal.type}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Modern Alert Dialog */}
      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={() => setAlertModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Roaming Trail Drawer */}
      <ClientTrailDrawer
        mac={selectedMacForTrail}
        onClose={() => setSelectedMacForTrail(null)}
      />
    </div>
  );
};
