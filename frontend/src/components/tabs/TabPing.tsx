import React, { useState } from 'react';
import { Send, Play, Activity, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { PingResult } from '../../types';
import { api } from '../../api/client';

interface TabPingProps {
  deviceId: string;
}

export const TabPing: React.FC<TabPingProps> = ({ deviceId }) => {
  const [target, setTarget] = useState('192.168.88.1');
  const [count, setCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPing = async (overrideTarget?: string) => {
    const t = overrideTarget || target;
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.ping(deviceId, t.trim(), count);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Gagal menjalankan ping via router');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Ping Input Box */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <span>Diagnostik Hardware Ping (Langsung dari Router MikroTik)</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex-1">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Masukkan IP atau Hostname target (contoh: 192.168.88.1, 8.8.8.8)..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-600 shadow-xs"
            >
              <option value={3}>3 Paket</option>
              <option value={5}>5 Paket</option>
              <option value={10}>10 Paket</option>
            </select>

            <button
              onClick={() => runPing()}
              disabled={loading || !target}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-mono font-semibold transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
            >
              <Play className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Ping...' : 'Jalankan Ping'}</span>
            </button>
          </div>
        </div>

        {/* Quick Target Presets */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-200 text-xs font-mono">
          <span className="text-slate-500 text-[11px] uppercase font-semibold">Preset Cepat:</span>
          <button
            onClick={() => {
              setTarget('192.168.88.1');
              runPing('192.168.88.1');
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 hover:text-slate-900 text-[11px] transition-colors font-medium cursor-pointer shadow-xs"
          >
            Gateway Default (192.168.88.1)
          </button>
          <button
            onClick={() => {
              setTarget('1.1.1.1');
              runPing('1.1.1.1');
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 hover:text-slate-900 text-[11px] transition-colors font-medium cursor-pointer shadow-xs"
          >
            Cloudflare DNS (1.1.1.1)
          </button>
          <button
            onClick={() => {
              setTarget('8.8.8.8');
              runPing('8.8.8.8');
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 hover:text-slate-900 text-[11px] transition-colors font-medium cursor-pointer shadow-xs"
          >
            Google DNS (8.8.8.8)
          </button>
        </div>
      </div>

      {/* Ping Results */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs font-mono text-rose-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 font-mono text-xs shadow-sm">
          {/* Summary Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Packet Transmitted / Received</div>
              <div className="text-slate-900 font-bold text-sm mt-0.5">
                {result.transmitted} / {result.received}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Packet Loss</div>
              <div className={`font-bold text-sm mt-0.5 ${result.packet_loss === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {result.packet_loss}%
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Rata-rata Latensi (Avg RTT)</div>
              <div className="text-blue-600 font-bold text-sm mt-0.5">
                {result.avg_rtt || '-'}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Min / Max Latensi</div>
              <div className="text-slate-700 font-bold text-sm mt-0.5">
                {result.min_rtt || '-'} / {result.max_rtt || '-'}
              </div>
            </div>
          </div>

          {/* Sequence Details */}
          {result.raw && result.raw.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Seq</th>
                    <th className="py-2.5 px-3">Host</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">TTL</th>
                    <th className="py-2.5 px-3">Latency RTT</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {result.raw.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-slate-400">{r.seq ?? i + 1}</td>
                      <td className="py-2 px-3 text-slate-900 font-medium">{r.host}</td>
                      <td className="py-2 px-3 text-slate-500">{r.size || 56} B</td>
                      <td className="py-2 px-3 text-slate-500">{r.ttl || '-'}</td>
                      <td className="py-2 px-3 text-blue-600 font-bold">{r.time}</td>
                      <td className="py-2 px-3">
                        <span className="text-emerald-700 flex items-center gap-1 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> OK
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
