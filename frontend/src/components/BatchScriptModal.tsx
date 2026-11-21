import React, { useState } from 'react';
import {
  X,
  Terminal,
  Play,
  CheckCircle2,
  AlertTriangle,
  Server,
  ShieldAlert,
  Clock,
  Layers,
  CheckSquare,
} from 'lucide-react';
import { Device, FleetDevice, BatchProgressItem } from '../types';
import { api } from '../api/client';

interface BatchScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: (Device | FleetDevice)[];
  initialSelectedIds?: string[];
}

export const BatchScriptModal: React.FC<BatchScriptModalProps> = ({
  isOpen,
  onClose,
  devices,
  initialSelectedIds,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (initialSelectedIds && initialSelectedIds.length > 0) {
      return new Set(initialSelectedIds);
    }
    return new Set(devices.map((d) => d.id));
  });

  const [action, setAction] = useState<'script' | 'dns' | 'ntp' | 'password'>('script');
  const [scriptText, setScriptText] = useState(':log info "Testing batch execution from RSAM NOC"');
  const [dnsServers, setDnsServers] = useState('192.168.88.1, 1.1.1.1');
  const [ntpServers, setNtpServers] = useState('192.168.88.1, id.pool.ntp.org');
  const [newPassword, setNewPassword] = useState('');

  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Map<string, BatchProgressItem>>(new Map());
  const [completedCount, setCompletedCount] = useState(0);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectAll = () => {
    setSelectedIds(new Set(devices.map((d) => d.id)));
  };

  const handleClearAll = () => {
    setSelectedIds(new Set());
  };

  const handleToggleDevice = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRunBatch = async () => {
    setErrorBanner(null);
    if (selectedIds.size === 0) {
      setErrorBanner('Pilih minimal 1 router target perangkat untuk dieksekusi.');
      return;
    }
    if (!confirmed) {
      setErrorBanner('Silakan centang konfirmasi keamanan sebelum menjalankan batch execution.');
      return;
    }

    setRunning(true);
    setCompletedCount(0);

    // Initialize map
    const initialMap = new Map<string, BatchProgressItem>();
    selectedIds.forEach((id) => {
      const dev = devices.find((d) => d.id === id);
      initialMap.set(id, {
        device_id: id,
        name: dev?.name || id,
        host: dev?.host || '',
        status: 'pending',
      });
    });
    setProgress(new Map(initialMap));

    try {
      const payload: any = {
        devices: Array.from(selectedIds),
        action,
      };

      if (action === 'script') {
        payload.script = scriptText;
      } else if (action === 'dns') {
        payload.dns = dnsServers.split(',').map((s) => s.trim()).filter(Boolean);
      } else if (action === 'ntp') {
        payload.ntp = ntpServers.split(',').map((s) => s.trim()).filter(Boolean);
      } else if (action === 'password') {
        if (!newPassword) {
          setErrorBanner('Password baru tidak boleh kosong.');
          setRunning(false);
          return;
        }
        payload.new_pass = newPassword;
      }

      await api.executeBatch(payload, (item) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(item.device_id, item);
          return next;
        });
        setCompletedCount((prev) => prev + 1);
      });
    } catch (err: any) {
      setErrorBanner(`Gagal menjalankan batch: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const progressArray = Array.from(progress.values());
  const percentComplete =
    selectedIds.size > 0 ? Math.round((completedCount / selectedIds.size) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-4xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden font-mono flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Terminal className="w-4 h-4 text-indigo-600" />
            <span>Batch Scripting & Fleet Automation Gateway</span>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {/* Error Banner */}
          {errorBanner && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3 animate-fade-in shadow-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{errorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-rose-400 hover:text-rose-700 p-1 rounded-md transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Target Router Selection Strip */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-slate-800">
                  Target Router: <b className="text-blue-600">{selectedIds.size}</b> dari {devices.length} Perangkat
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={running}
                  className="px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-700 hover:text-slate-900 hover:bg-slate-100 text-[11px] font-semibold transition-colors shadow-xs"
                >
                  Pilih Semua ({devices.length})
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={running}
                  className="px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-[11px] font-medium transition-colors shadow-xs"
                >
                  Kosongkan
                </button>
              </div>
            </div>

            {/* Target Pills list */}
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-white rounded-lg border border-slate-200">
              {devices.map((d) => {
                const isChecked = selectedIds.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={running}
                    onClick={() => handleToggleDevice(d.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                      isChecked
                        ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {d.name} ({d.host})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Tabs */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setAction('script')}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  action === 'script' ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Custom RouterOS Script
              </button>
              <button
                type="button"
                onClick={() => setAction('dns')}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  action === 'dns' ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Update DNS Server
              </button>
              <button
                type="button"
                onClick={() => setAction('ntp')}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  action === 'ntp' ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Update NTP Client
              </button>
              <button
                type="button"
                onClick={() => setAction('password')}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  action === 'password' ? 'bg-rose-50 text-rose-700 font-bold border border-rose-200 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Rotasi Password Admin
              </button>
            </div>

            {/* Tab Inputs */}
            {action === 'script' && (
              <div className="space-y-1.5">
                <label className="text-slate-700 font-semibold flex justify-between">
                  <span>Isi Script RouterOS (CLI)</span>
                  <span className="text-[10px] text-slate-500 font-sans">
                    Script akan diinject sementara ke /system/script lalu dihapus setelah eksekusi
                  </span>
                </label>
                <textarea
                  rows={4}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  disabled={running}
                  placeholder=":log info 'Executing batch commands...'"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-blue-600 shadow-xs"
                />
              </div>
            )}

            {action === 'dns' && (
              <div className="space-y-1.5">
                <label className="text-slate-700 font-semibold">Server DNS (pisahkan dengan koma)</label>
                <input
                  type="text"
                  value={dnsServers}
                  onChange={(e) => setDnsServers(e.target.value)}
                  disabled={running}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {action === 'ntp' && (
              <div className="space-y-1.5">
                <label className="text-slate-700 font-semibold">Server NTP (pisahkan dengan koma)</label>
                <input
                  type="text"
                  value={ntpServers}
                  onChange={(e) => setNtpServers(e.target.value)}
                  disabled={running}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {action === 'password' && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-rose-700 font-semibold">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Perhatian: Rotasi Password User 'admin' Serentak</span>
                </div>
                <p className="text-[11px] text-rose-800/80 font-sans">
                  Backend akan memperbarui password user 'admin' pada seluruh router yang dipilih via socket user 'API', kemudian menguji verifikasi login baru dan otomatis menyinkronkan password baru ke file <code>devices.json</code>.
                </p>
                <div className="pt-1">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={running}
                    placeholder="Masukkan Password Baru User Admin..."
                    className="w-full bg-white border border-rose-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Safety Confirmation */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-slate-800 text-xs font-medium">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={running}
                className="w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-0 accent-amber-600"
              />
              <span>
                Saya mengonfirmasi untuk mengeksekusi aksi ini serentak ke <b>{selectedIds.size} router</b>
              </span>
            </label>

            <button
              type="button"
              onClick={handleRunBatch}
              disabled={running || !confirmed || selectedIds.size === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all shadow-sm shadow-indigo-500/20 shrink-0 cursor-pointer"
            >
              <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
              <span>{running ? `Menjalankan (${completedCount}/${selectedIds.size})...` : 'Jalankan Batch Sekarang'}</span>
            </button>
          </div>

          {/* Progress Bar & Live Execution Stream Table */}
          {progressArray.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-600 font-medium">Progress Eksekusi Perangkat:</span>
                <span className="font-bold text-blue-600">
                  {completedCount} / {selectedIds.size} Selesai ({percentComplete}%)
                </span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>

              {/* Status Table */}
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-white shadow-xs">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-50 text-slate-600 text-[10px] uppercase border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Router</th>
                      <th className="py-2.5 px-3 font-semibold">Host IP</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 px-3 font-semibold">Output / Log</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {progressArray.map((p) => {
                      const isOk = p.status === 'ok';
                      const isFailed = p.status === 'failed';
                      const isPending = p.status === 'pending';

                      return (
                        <tr key={p.device_id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2 px-3 font-semibold text-slate-900">{p.name}</td>
                          <td className="py-2 px-3 text-slate-500">{p.host}</td>
                          <td className="py-2 px-3">
                            {isOk && (
                              <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Sukses
                              </span>
                            )}
                            {isFailed && (
                              <span className="text-rose-700 font-semibold flex items-center gap-1 text-[11px]">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Gagal
                              </span>
                            )}
                            {isPending && (
                              <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                                <Clock className="w-3.5 h-3.5 text-slate-400" /> Menunggu...
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {p.output ? (
                              <span className="text-emerald-700 font-medium">{p.output}</span>
                            ) : p.error ? (
                              <span className="text-rose-700 font-medium">{p.error}</span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
