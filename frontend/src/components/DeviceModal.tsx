import React, { useState, useEffect } from 'react';
import { X, Server, CheckCircle2, AlertTriangle, RefreshCw, KeyRound, Globe, Shield } from 'lucide-react';
import { Device, DeviceCreate, DeviceTestResult } from '../types';
import { api } from '../api/client';

interface DeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (device: DeviceCreate) => Promise<void>;
  editDevice?: Device | null;
}

export const DeviceModal: React.FC<DeviceModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editDevice,
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(8728);
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [group, setGroup] = useState('Default');
  const [isDefault, setIsDefault] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DeviceTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editDevice) {
      setName(editDevice.name || '');
      setHost(editDevice.host || '');
      setPort(editDevice.port || 8728);
      setUser(editDevice.user || 'admin');
      setPass('');
      setGroup(editDevice.group || 'Default');
      setIsDefault(!!editDevice.is_default);
    } else {
      setName('');
      setHost('');
      setPort(8728);
      setUser('admin');
      setPass('');
      setGroup('Default');
      setIsDefault(false);
    }
    setTestResult(null);
    setError(null);
  }, [editDevice, isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!host) {
      setError('IP Host harus diisi sebelum melakukan tes koneksi');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await api.testDevice({
        host: host.trim(),
        port,
        user: user.trim(),
        pass,
      });
      setTestResult(res);
      // Auto-fill name if empty
      if (res.ok && res.identity && !name) {
        const boardStr = res.board && res.board !== 'MikroTik' ? ` (${res.board})` : '';
        setName(`${res.identity}${boardStr}`);
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || 'Koneksi gagal' });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host) {
      setError('IP Host router wajib diisi');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: DeviceCreate = {
        id: editDevice?.id,
        name: name.trim() || undefined,
        host: host.trim(),
        port,
        user: user.trim(),
        pass: pass || undefined,
        group: group.trim() || 'Default',
        is_default: isDefault,
      };
      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan perangkat');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900">
            <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Server className="w-4 h-4" />
            </div>
            <span>{editDevice ? 'Edit Perangkat MikroTik' : 'Tambah Router MikroTik Baru'}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs font-sans">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 flex items-center gap-2 font-mono">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Name Field (Optional auto-identity) */}
          <div className="space-y-1">
            <label className="text-slate-700 font-medium flex items-center justify-between">
              <span>Nama Perangkat / Label</span>
              <span className="text-[10px] text-slate-500 font-normal">(Opsional — otomatis dari identity router)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Otomatis mengikuti nama identity router (kosongkan saja)"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
            />
          </div>

          {/* Host IP & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-slate-700 font-medium">
                IP Host / Gateway <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="Contoh: 192.168.88.1"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-slate-700 font-medium">Port API</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
              />
            </div>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-700 font-medium">Username</label>
              <input
                type="text"
                required
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-slate-700 font-medium">Password</label>
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={editDevice ? '•••••••• (Biarkan jika tetap)' : 'Password'}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
              />
            </div>
          </div>

          {/* Group / Ruangan & Default Checkbox */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="space-y-1">
              <label className="text-slate-700 font-medium">Grup / Lokasi Ruangan</label>
              <input
                type="text"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Contoh: Melati / Lt 2"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs font-mono"
              />
            </div>
            <div className="pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-0 accent-blue-600"
                />
                <span className="font-medium">Jadikan Default</span>
              </label>
            </div>
          </div>

          {/* Connection Test Result Box */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-mono ${
                testResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testResult.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Koneksi API Sukses!</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Identity: <b className="text-slate-900">{testResult.identity}</b> · Model: {testResult.board} · ROS: {testResult.version} · Uptime: {testResult.uptime}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-rose-700">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Koneksi Gagal: {testResult.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !host}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors disabled:opacity-50 shadow-xs cursor-pointer font-sans"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-blue-600' : ''}`} />
              <span>{testing ? 'Menguji API...' : 'Tes Koneksi'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors font-medium cursor-pointer font-sans"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || !host}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all shadow-sm shadow-blue-500/20 cursor-pointer font-sans"
              >
                <span>{saving ? 'Menyimpan...' : 'Simpan Perangkat'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
