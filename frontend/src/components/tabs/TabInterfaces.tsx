import React, { useState } from 'react';
import {
  Layers,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  XCircle,
  Power,
  Edit2,
  Check,
  X,
  Search,
  AlertCircle,
} from 'lucide-react';
import { InterfaceItem } from '../../types';
import { formatBps } from '../Oscilloscope';
import { api } from '../../api/client';

interface TabInterfacesProps {
  deviceId?: string;
  interfaces: InterfaceItem[];
  onRefresh?: () => void;
}

function formatBytes(bytes: number = 0): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export const TabInterfaces: React.FC<TabInterfacesProps> = ({
  deviceId = '',
  interfaces = [],
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showFeedback = (type: 'ok' | 'err', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleToggle = async (iface: InterfaceItem) => {
    try {
      await api.toggleInterface(deviceId, iface.id, !iface.disabled);
      showFeedback(
        'ok',
        `Interface ${iface.name} berhasil di-${iface.disabled ? 'aktifkan' : 'nonaktifkan'}`
      );
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('err', `Gagal mengubah status interface: ${err.message}`);
    }
  };

  const handleSaveComment = async (iface: InterfaceItem) => {
    try {
      await api.setInterfaceComment(deviceId, iface.id, editComment.trim());
      showFeedback('ok', `Comment untuk ${iface.name} tersimpan`);
      setEditingId(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('err', `Gagal menyimpan comment: ${err.message}`);
    }
  };

  const filtered = interfaces.filter((i) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      i.name.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q) ||
      (i.mac_address && i.mac_address.toLowerCase().includes(q)) ||
      (i.comment && i.comment.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-3.5">
      {/* Toast Alert */}
      {actionMsg && (
        <div
          className={`flex items-center gap-2 p-3.5 rounded-xl border text-xs font-mono transition-all animate-fadeIn shadow-xs ${
            actionMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {actionMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span className="flex-1 font-semibold">{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span className="font-mono text-xs font-bold text-slate-900">
            Daftar Interface Router ({interfaces.length} Total)
          </span>
        </div>

        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari interface, tipe, MAC, comment..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
            <tr>
              <th className="py-3 px-4">Nama Interface</th>
              <th className="py-3 px-4">Tipe</th>
              <th className="py-3 px-4">Status Link</th>
              <th className="py-3 px-4">MAC / MTU</th>
              <th className="py-3 px-4">RX Counters</th>
              <th className="py-3 px-4">TX Counters</th>
              <th className="py-3 px-4">Keterangan / Comment</th>
              <th className="py-3 px-4 text-center">Kontrol (Winbox)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filtered.map((iface) => {
              const isRunning = iface.running;
              const isDisabled = iface.disabled;
              const isEditing = editingId === iface.id;

              return (
                <tr
                  key={iface.id || iface.name}
                  className={`hover:bg-slate-50 transition-colors ${
                    isDisabled ? 'opacity-50 bg-slate-50/50' : ''
                  }`}
                >
                  <td className="py-3 px-4 font-bold text-slate-900">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isDisabled
                            ? 'bg-slate-400'
                            : isRunning
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span>{iface.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                      {iface.type}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {isDisabled ? (
                      <span className="text-slate-400 flex items-center gap-1 text-[11px] font-medium">
                        <XCircle className="w-3.5 h-3.5" /> Disabled
                      </span>
                    ) : isRunning ? (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Running
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px] font-medium">Link Down</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    <div>{iface.mac_address || '-'}</div>
                    <div className="text-[10px] text-slate-400">MTU: {iface.mtu || 1500}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-blue-600 font-bold flex items-center gap-1">
                      <ArrowDown className="w-3 h-3" />
                      <span>{formatBytes(iface.rx_byte)}</span>
                    </div>
                    {iface.rx_bps ? (
                      <div className="text-[10px] text-slate-400 font-medium">{formatBps(iface.rx_bps)}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-emerald-600 font-bold flex items-center gap-1">
                      <ArrowUp className="w-3 h-3" />
                      <span>{formatBytes(iface.tx_byte)}</span>
                    </div>
                    {iface.tx_bps ? (
                      <div className="text-[10px] text-slate-400 font-medium">{formatBps(iface.tx_bps)}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editComment}
                          onChange={(e) => setEditComment(e.target.value)}
                          placeholder="Comment..."
                          className="bg-white border border-blue-500 rounded-lg px-2 py-0.5 text-xs text-slate-900 focus:outline-none shadow-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveComment(iface);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button
                          onClick={() => handleSaveComment(iface)}
                          className="p-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-slate-800 border border-slate-200 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="truncate max-w-[140px]">{iface.comment || '-'}</span>
                        <button
                          onClick={() => {
                            setEditingId(iface.id);
                            setEditComment(iface.comment || '');
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-blue-600 transition-opacity cursor-pointer"
                          title="Edit Comment"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggle(iface)}
                      className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-xs ${
                        isDisabled
                          ? 'bg-slate-100 hover:bg-emerald-50 hover:border-emerald-300 text-slate-500 hover:text-emerald-700 border-slate-200'
                          : 'bg-emerald-50 hover:bg-rose-50 border-emerald-200 hover:border-rose-300 text-emerald-700 hover:text-rose-700'
                      }`}
                      title={isDisabled ? 'Aktifkan Interface' : 'Nonaktifkan Interface'}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
