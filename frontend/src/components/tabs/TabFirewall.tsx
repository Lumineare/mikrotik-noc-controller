import React, { useState } from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { FirewallRule } from '../../types';

interface TabFirewallProps {
  filter: FirewallRule[];
  nat: FirewallRule[];
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

export const TabFirewall: React.FC<TabFirewallProps> = ({ filter = [], nat = [] }) => {
  const [subTab, setSubTab] = useState<'filter' | 'nat'>('filter');

  const rules = subTab === 'filter' ? filter : nat;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setSubTab('filter')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
              subTab === 'filter'
                ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Filter Rules ({filter.length})</span>
          </button>
          <button
            onClick={() => setSubTab('nat')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
              subTab === 'nat'
                ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>NAT Rules ({nat.length})</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
            <tr>
              <th className="py-3 px-4">Chain</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Src / Dst Address</th>
              <th className="py-3 px-4">Protocol / Port</th>
              <th className="py-3 px-4">Bytes / Packets</th>
              <th className="py-3 px-4">Keterangan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  Tidak ada rules terkonfigurasi di chain ini
                </td>
              </tr>
            ) : (
              rules.map((r, idx) => {
                const isAccept = r.action === 'accept' || r.action === 'masquerade';
                const isDrop = r.action === 'drop' || r.action === 'reject';

                return (
                  <tr key={r.id || idx} className={`hover:bg-slate-50 transition-colors ${r.disabled ? 'opacity-50' : ''}`}>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                        {r.chain}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] uppercase font-bold border ${
                          isAccept
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : isDrop
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-800">
                      <div><span className="text-slate-400">Src:</span> {r.src_address || 'any'}</div>
                      <div><span className="text-slate-400">Dst:</span> {r.dst_address || 'any'}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div><span className="text-slate-400">Proto:</span> {r.protocol || 'any'}</div>
                      {r.dst_port && <div><span className="text-slate-400">Port:</span> {r.dst_port}</div>}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      <div className="text-blue-600 font-bold">{formatBytes(r.bytes)}</div>
                      <div className="text-slate-400">{r.packets?.toLocaleString() || 0} pkts</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {r.comment || (r.to_addresses ? `to: ${r.to_addresses}` : '-')}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
