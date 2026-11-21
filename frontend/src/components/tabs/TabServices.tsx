import React from 'react';
import { Sliders, Users, CheckCircle2, XCircle } from 'lucide-react';
import { ServiceItem, UserItem } from '../../types';

interface TabServicesProps {
  services: ServiceItem[];
  users: UserItem[];
}

export const TabServices: React.FC<TabServicesProps> = ({ services = [], users = [] }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Services Port Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span>Layanan Port RouterOS (/ip/service)</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-2.5 px-3">Service</th>
                <th className="py-2.5 px-3">Port</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">IP Whitelist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {services.map((s) => (
                <tr key={s.id || s.name} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-slate-900">{s.name}</td>
                  <td className="py-2.5 px-3 text-blue-600 font-bold">{s.port}</td>
                  <td className="py-2.5 px-3">
                    {s.disabled ? (
                      <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                        <XCircle className="w-3.5 h-3.5" /> Nonaktif
                      </span>
                    ) : (
                      <span className="text-emerald-700 flex items-center gap-1 text-[11px] font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Aktif
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">{s.address || 'Semua (0.0.0.0/0)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users & Accounts Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-mono text-blue-700 uppercase font-bold mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Users className="w-3.5 h-3.5" />
          </div>
          <span>Daftar Akun Login Router (/user)</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-2.5 px-3">Username</th>
                <th className="py-2.5 px-3">Group Hak Akses</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Terakhir Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {users.map((u) => (
                <tr key={u.id || u.name} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-slate-900">{u.name}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold">
                      {u.group}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {u.disabled ? (
                      <span className="text-rose-700 text-[11px] font-semibold">Disabled</span>
                    ) : (
                      <span className="text-emerald-700 text-[11px] font-semibold">Active</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">{u.last_logged_in || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
