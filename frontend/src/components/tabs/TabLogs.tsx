import React, { useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { LogItem } from '../../types';

interface TabLogsProps {
  logs: LogItem[];
}

export const TabLogs: React.FC<TabLogsProps> = ({ logs = [] }) => {
  const [search, setSearch] = useState('');

  const filtered = logs.filter((l) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      l.message.toLowerCase().includes(q) ||
      (l.topics && l.topics.toLowerCase().includes(q)) ||
      (l.time && l.time.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <span className="font-mono text-xs font-bold text-slate-900">
            System Log Activity ({logs.length} Event Terakhir)
          </span>
        </div>

        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kata kunci log..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
          />
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
            <tr>
              <th className="py-3 px-4 w-36">Waktu</th>
              <th className="py-3 px-4 w-48">Topik / Severity</th>
              <th className="py-3 px-4">Pesan Log</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-12 text-center text-slate-500">
                  Tidak ada event log yang sesuai
                </td>
              </tr>
            ) : (
              filtered.map((l, idx) => {
                const isError = l.topics?.includes('error') || l.topics?.includes('critical');
                const isWarning = l.topics?.includes('warning');
                const isWireless = l.topics?.includes('wireless');
                const isAccount = l.topics?.includes('account');

                let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200 font-medium';
                if (isError) badgeClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
                else if (isWarning) badgeClass = 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
                else if (isWireless) badgeClass = 'bg-blue-50 text-blue-700 border-blue-200 font-semibold';
                else if (isAccount) badgeClass = 'bg-purple-50 text-purple-700 border-purple-200 font-semibold';

                return (
                  <tr key={l.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{l.time}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border uppercase ${badgeClass}`}>
                        {l.topics || 'info'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 font-mono">{l.message}</td>
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
