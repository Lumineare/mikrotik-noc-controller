import React, { useEffect, useState } from 'react';
import {
  Users,
  X,
  RefreshCw,
  Signal,
  Wifi,
  Trash2,
  AlertCircle,
  Search,
  Check,
  Edit2,
  Smartphone,
  Laptop,
  Tablet,
  Radio,
  Tag,
  Sparkles,
} from 'lucide-react';
import { ApPlacement } from '../../types';
import { api } from '../../api/client';

interface ApClientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  placement: ApPlacement | null;
}

interface ClientInfo {
  mac: string;
  ip?: string;
  brand?: string;
  model_series?: string;
  device_name?: string;
  vendor?: string;
  is_custom_name?: boolean;
  device_type?: 'custom' | 'mobile' | 'laptop' | 'tablet' | 'vendor' | 'unknown';
  signal: string;
  signal_dbm: number | null;
  tx_rate: string;
  rx_rate: string;
  uptime: string;
  bytes: string;
  interface: string;
}

const BRAND_PRESETS = [
  'Samsung',
  'Apple',
  'Xiaomi',
  'Infinix',
  'OPPO',
  'vivo',
  'Realme',
  'Lenovo',
  'ASUS',
  'Dell',
  'HP',
  'Huawei',
];

const MODEL_PRESETS: Record<string, string[]> = {
  Samsung: ['Galaxy S24 Ultra', 'Galaxy S23 5G', 'Galaxy A54 5G', 'Galaxy A34 5G', 'Galaxy A14', 'Galaxy Tab S9', 'Galaxy Tab A8'],
  Apple: ['iPhone 15 Pro', 'iPhone 14 (iOS)', 'iPhone 13 (iOS)', 'iPhone 12', 'iPad Air', 'iPad 10th Gen', 'MacBook Air'],
  Xiaomi: ['Redmi Note 13 Pro', 'Redmi Note 12', 'POCO X5 Pro 5G', 'POCO F5', 'Xiaomi 13T', 'Redmi 12'],
  Infinix: ['Hot 40 Pro', 'Hot 30', 'Note 30 Pro', 'Note 12', 'Smart 8', 'Zero 30 5G'],
  OPPO: ['Reno10 5G', 'Reno8 5G', 'A78 5G', 'A57', 'A17', 'Find N2 Flip'],
  vivo: ['V29 5G', 'V27 5G', 'Y36 5G', 'Y22', 'Y16', 'X90 Pro'],
  Realme: ['Realme 11 Pro+', 'Realme 10', 'C55 NFC', 'C33', 'GT Neo 5'],
  Lenovo: ['ThinkPad L14', 'ThinkPad E14', 'IdeaPad Slim 3', 'Yoga 7'],
  ASUS: ['ExpertBook B1', 'VivoBook 14', 'ROG Phone 7', 'ZenFone 10'],
  Dell: ['Latitude 3420', 'Inspiron 15', 'Vostro 3510'],
  HP: ['ProBook 440 G8', 'HP 240 G8', 'Pavilion 14'],
  Huawei: ['Nova 11', 'Nova 10', 'MatePad 11', 'P60 Pro'],
};

export const ApClientsModal: React.FC<ApClientsModalProps> = ({
  isOpen,
  onClose,
  placement,
}) => {
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [kickingMac, setKickingMac] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Modal Ubah Brand & Seri
  const [editingClient, setEditingClient] = useState<ClientInfo | null>(null);
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editCustomName, setEditCustomName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const fetchClients = async () => {
    if (!placement) return;
    setLoading(true);
    try {
      const res: any = await api.getDashboard(placement.device_id);
      const raw = res?.wireless;
      const rawClients: any[] = Array.isArray(raw) ? raw : raw?.clients || [];
      setClients(rawClients);
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !placement) return;
    fetchClients();
    const t = window.setInterval(fetchClients, 10000);
    return () => window.clearInterval(t);
  }, [isOpen, placement?.device_id]);

  if (!isOpen || !placement) return null;

  const handleKick = async (mac: string) => {
    setKickingMac(mac);
    try {
      await api.kickWirelessClient(placement.device_id, undefined, mac);
      setFeedback(`Klien ${mac} berhasil diputus.`);
      setClients((prev) => prev.filter((c) => c.mac !== mac));
    } catch (err: any) {
      setFeedback(`Gagal: ${err.message || 'Error'}`);
    } finally {
      setKickingMac(null);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  const handleOpenEdit = (c: ClientInfo) => {
    setEditingClient(c);
    setEditBrand(c.brand || 'Samsung');
    setEditModel(c.model_series || '');
    setEditCustomName(c.is_custom_name ? (c.device_name || '') : '');
    setEditNotes('');
  };

  const handleSaveEdit = async () => {
    if (!editingClient) return;
    setSavingAlias(true);
    try {
      const finalBrand = editBrand.trim();
      const finalModel = editModel.trim();
      const finalName = editCustomName.trim() || `${finalBrand} ${finalModel}`.trim();

      await api.setClientAlias({
        mac: editingClient.mac,
        brand: finalBrand,
        model_series: finalModel,
        name: finalName,
        vendor: finalBrand ? `${finalBrand} Electronics` : undefined,
        notes: editNotes.trim(),
      });

      const isLap = ['lenovo', 'dell', 'hp', 'asus'].includes(finalBrand.toLowerCase()) || finalName.toLowerCase().includes('laptop');
      const isTab = finalName.toLowerCase().includes('tab') || finalModel.toLowerCase().includes('tab') || finalModel.toLowerCase().includes('ipad');

      setClients((prev) =>
        prev.map((c) =>
          c.mac === editingClient.mac
            ? {
                ...c,
                brand: finalBrand,
                model_series: finalModel,
                device_name: finalName,
                vendor: finalBrand ? `${finalBrand} Electronics` : c.vendor,
                is_custom_name: true,
                device_type: isLap ? 'laptop' : (isTab ? 'tablet' : 'mobile'),
              }
            : c
        )
      );

      setFeedback(`Perangkat ${editingClient.mac} berhasil diidentifikasi sebagai "${finalBrand} ${finalModel}".`);
      setEditingClient(null);
    } catch (err: any) {
      alert('Gagal menyimpan identitas perangkat: ' + err.message);
    } finally {
      setSavingAlias(false);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  const filtered = clients.filter((c) =>
    (c.mac || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.brand || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.model_series || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.device_name || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.vendor || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.ip || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
    (c.interface || '').toLowerCase().includes(filterQuery.toLowerCase())
  );

  const getSignalBadge = (dbm: number | null) => {
    if (dbm === null) return { text: 'N/A', color: 'text-slate-400 bg-slate-100' };
    if (dbm >= -60) return { text: `${dbm} dBm`, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    if (dbm >= -75) return { text: `${dbm} dBm`, color: 'text-amber-700 bg-amber-50 border-amber-200' };
    return { text: `${dbm} dBm`, color: 'text-rose-700 bg-rose-50 border-rose-200' };
  };

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
    if (b.includes('huawei')) return 'bg-red-600 text-white';
    return 'bg-slate-700 text-white';
  };

  const getDeviceIcon = (client: ClientInfo) => {
    const name = (client.device_name || '').toLowerCase();
    const model = (client.model_series || '').toLowerCase();
    if (client.device_type === 'laptop' || name.includes('laptop') || name.includes('pc') || model.includes('thinkpad')) {
      return <Laptop className="w-3.5 h-3.5 text-slate-700 shrink-0" />;
    }
    if (client.device_type === 'tablet' || name.includes('tablet') || name.includes('ipad') || model.includes('tab')) {
      return <Tablet className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
    }
    if (client.device_type === 'mobile' || client.brand) {
      return <Smartphone className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    }
    return <Radio className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-3xl w-full shadow-2xl text-slate-900 space-y-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900">
                  Klien Terhubung — {placement.device_name || placement.device_id}
                </h3>
                <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  {clients.length} Perangkat
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-500">
                IP: {placement.device_host || '192.168.88.x'} • Ch {placement.channel_2g} (2.4G) / Ch {placement.channel_5g} (5G)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchClients}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="Refresh daftar klien"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback message */}
        {feedback && (
          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold flex items-center justify-between animate-in fade-in">
            <span>{feedback}</span>
            <Check className="w-4 h-4 text-blue-600" />
          </div>
        )}

        {/* Search & Filter */}
        <div className="relative shrink-0">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Cari brand (Samsung, Apple, Xiaomi, Infinix), seri model, nama alias, IP, atau MAC..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-slate-800"
          />
        </div>

        {/* Clients Table */}
        <div className="flex-1 overflow-y-auto border border-slate-200 rounded-2xl bg-white">
          {loading && clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono">Mengidentifikasi brand &amp; seri perangkat klien...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              {clients.length === 0 ? 'Tidak ada klien yang terhubung ke AP ini.' : 'Tidak ada hasil yang cocok dengan pencarian.'}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Brand &amp; Seri Perangkat</th>
                  <th className="py-2.5 px-3">Identitas &amp; MAC / IP</th>
                  <th className="py-2.5 px-3">Band / Radio</th>
                  <th className="py-2.5 px-3">Sinyal (RSSI)</th>
                  <th className="py-2.5 px-3">Speed (Tx / Rx)</th>
                  <th className="py-2.5 px-3">Uptime</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const sig = getSignalBadge(c.signal_dbm);
                  const is5g = c.interface.includes('wlan2') || c.interface.includes('5');

                  return (
                    <tr key={c.mac} className="hover:bg-slate-50/70 transition-colors">
                      {/* Brand & Model / Seri */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 shadow-2xs ${getBrandBadge(c.brand)}`}>
                            {c.brand || 'Perangkat'}
                          </span>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {getDeviceIcon(c)}
                            <span className="font-bold text-slate-900 text-xs truncate">
                              {c.model_series || c.device_name || 'Seri Standar'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Identitas / Custom Alias & MAC / IP */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 group">
                            {c.is_custom_name ? (
                              <span className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                                <Tag className="w-2.5 h-2.5" />
                                {c.device_name}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">
                                Belum ada alias unit
                              </span>
                            )}
                            <button
                              onClick={() => handleOpenEdit(c)}
                              className="text-slate-300 group-hover:text-blue-600 p-0.5 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                              title="Ubah Brand, Seri &amp; Nama Unit"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                            <span className="font-semibold text-slate-700">{c.mac}</span>
                            {c.ip && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="text-blue-600 font-medium">{c.ip}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Band / Radio */}
                      <td className="py-2.5 px-3 font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            is5g
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {is5g ? '5 GHz' : '2.4 GHz'} ({c.interface})
                        </span>
                      </td>

                      {/* Sinyal (RSSI) */}
                      <td className="py-2.5 px-3 font-mono">
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${sig.color}`}>
                          {sig.text}
                        </span>
                      </td>

                      {/* Throughput Tx/Rx */}
                      <td className="py-2.5 px-3 text-[11px] font-mono text-slate-600">
                        <span>{c.tx_rate || '-'}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span>{c.rx_rate || '-'}</span>
                      </td>

                      {/* Uptime */}
                      <td className="py-2.5 px-3 text-slate-500 text-[11px] font-mono">
                        {c.uptime || '-'}
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(c)}
                            className="px-2 py-1 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200 text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                            title="Edit Brand &amp; Seri"
                          >
                            <Edit2 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleKick(c.mac)}
                            disabled={kickingMac === c.mac}
                            className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-[11px] font-semibold transition-colors cursor-pointer"
                            title="Putus koneksi klien ini"
                          >
                            {kickingMac === c.mac ? 'Memutus...' : 'Kick'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 shrink-0">
          <span>* Klik tombol <b>Edit</b> pada klien untuk memilih Brand &amp; Seri model atau menetapkan label unit RSAM.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* MODAL EDIT BRAND & SERI PERANGKAT */}
      {editingClient && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-60 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-lg w-full shadow-2xl text-slate-900 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    Identifikasi Brand &amp; Seri Perangkat
                  </h4>
                  <p className="text-[11px] font-mono text-slate-500">
                    MAC: {editingClient.mac} {editingClient.ip ? `• IP: ${editingClient.ip}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingClient(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Brand Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                1. Pilih Brand Pabrikan:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {BRAND_PRESETS.map((b) => {
                  const isSelected = editBrand.toLowerCase() === b.toLowerCase();
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        setEditBrand(b);
                        const presets = MODEL_PRESETS[b];
                        if (presets && presets.length > 0 && (!editModel || !presets.includes(editModel))) {
                          setEditModel(presets[0]);
                        }
                      }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? `${getBrandBadge(b)} shadow-xs scale-105`
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder="Atau ketik nama brand lain..."
                value={editBrand}
                onChange={(e) => setEditBrand(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-slate-800 font-medium"
              />
            </div>

            {/* Quick Model / Series Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                2. Pilih Seri / Model Perangkat:
              </label>
              {MODEL_PRESETS[editBrand] && (
                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PRESETS[editBrand].map((m) => {
                    const isSelected = editModel.toLowerCase() === m.toLowerCase();
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEditModel(m)}
                        className={`px-2 py-0.5 text-[11px] rounded-lg transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
              <input
                type="text"
                placeholder="Ketik seri spesifik (misal: Galaxy A54 5G, iPhone 14 Pro, Redmi Note 12)..."
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-slate-800 font-semibold"
              />
            </div>

            {/* Custom Label / Unit Name */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                3. Label Unit / Nama Khusus RSAM (Opsional):
              </label>
              <input
                type="text"
                placeholder="Contoh: Laptop Dokter Jaga IGD, Tablet Visite Poli Bedah..."
                value={editCustomName}
                onChange={(e) => setEditCustomName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-slate-800 font-medium"
              />
            </div>

            {/* Preview Card */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getBrandBadge(editBrand)}`}>
                  {editBrand || 'Brand'}
                </span>
                <span className="font-bold text-xs text-slate-900">
                  {editModel || 'Seri / Model'}
                </span>
                {editCustomName && (
                  <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-semibold">
                    🏷️ {editCustomName}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-slate-400">Preview Tampilan</span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="px-4 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 font-medium text-xs transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingAlias || !editBrand.trim()}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {savingAlias ? 'Menyimpan...' : 'Simpan Identitas Perangkat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};