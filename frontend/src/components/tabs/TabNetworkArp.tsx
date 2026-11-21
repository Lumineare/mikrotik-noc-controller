import React, { useState } from 'react';
import { Network, Search, Database, Navigation, Globe, CheckCircle2 } from 'lucide-react';
import { ArpItem, DnsCacheItem } from '../../types';

interface RouteItem {
  dst: string;
  gateway: string;
  distance: string | number;
  active: boolean;
  static: boolean;
}

interface AddressItem {
  address: string;
  network: string;
  interface: string;
  disabled: boolean;
  dynamic: boolean;
}

interface TabNetworkArpProps {
  arp: ArpItem[];
  dnsCache: DnsCacheItem[];
  routes?: RouteItem[];
  addresses?: AddressItem[];
}

export const TabNetworkArp: React.FC<TabNetworkArpProps> = ({
  arp = [],
  dnsCache = [],
  routes = [],
  addresses = [],
}) => {
  const [arpSearch, setArpSearch] = useState('');
  const [subTab, setSubTab] = useState<'arp' | 'routes' | 'addresses' | 'dns'>('arp');

  const filteredArp = arp.filter((item) => {
    const q = arpSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      item.address.toLowerCase().includes(q) ||
      item.mac_address.toLowerCase().includes(q) ||
      (item.interface && item.interface.toLowerCase().includes(q)) ||
      (item.comment && item.comment.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-3.5">
      {/* Sub Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setSubTab('arp')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors shrink-0 cursor-pointer ${
              subTab === 'arp' ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Tabel ARP ({arp.length})</span>
          </button>

          <button
            onClick={() => setSubTab('routes')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors shrink-0 cursor-pointer ${
              subTab === 'routes' ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>IP Routes ({routes.length})</span>
          </button>

          <button
            onClick={() => setSubTab('addresses')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors shrink-0 cursor-pointer ${
              subTab === 'addresses' ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>IP Addresses ({addresses.length})</span>
          </button>

          <button
            onClick={() => setSubTab('dns')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors shrink-0 cursor-pointer ${
              subTab === 'dns' ? 'bg-white text-blue-700 border border-slate-200 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Cache DNS ({dnsCache.length})</span>
          </button>
        </div>

        {subTab === 'arp' && (
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={arpSearch}
              onChange={(e) => setArpSearch(e.target.value)}
              placeholder="Filter IP atau MAC address..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
            />
          </div>
        )}
      </div>

      {/* SUBTAB 1: ARP TABLE */}
      {subTab === 'arp' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4">MAC Address</th>
                <th className="py-3 px-4">Interface</th>
                <th className="py-3 px-4">Flags</th>
                <th className="py-3 px-4">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredArp.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    Tidak ada entri ARP ditemukan
                  </td>
                </tr>
              ) : (
                filteredArp.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-blue-600">{item.address}</td>
                    <td className="py-3 px-4 text-slate-900 font-medium">{item.mac_address}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                        {item.interface}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {item.dynamic && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-semibold">
                            D (Dynamic)
                          </span>
                        )}
                        {item.complete && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-semibold">
                            C (Complete)
                          </span>
                        )}
                        {item.DHCP && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-mono font-semibold">
                            DHCP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{item.comment || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 2: IP ROUTES */}
      {subTab === 'routes' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">Dst. Address</th>
                <th className="py-3 px-4">Gateway</th>
                <th className="py-3 px-4">Distance</th>
                <th className="py-3 px-4">Flags</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {routes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    Tidak ada route ditemukan
                  </td>
                </tr>
              ) : (
                routes.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {r.dst === '0.0.0.0/0' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-amber-700 font-bold">{r.dst}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                            Default Gateway
                          </span>
                        </div>
                      ) : (
                        <span className="text-blue-700 font-bold">{r.dst}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-800 font-medium">{r.gateway || '-'}</td>
                    <td className="py-3 px-4 text-slate-600">{r.distance ?? 1}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {r.active && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-semibold">
                            A (Active)
                          </span>
                        )}
                        {r.static && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono font-semibold">
                            S (Static)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {r.active ? (
                        <span className="text-emerald-700 flex items-center gap-1 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Reachable</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 3: IP ADDRESSES */}
      {subTab === 'addresses' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">IP Address / Netmask</th>
                <th className="py-3 px-4">Network</th>
                <th className="py-3 px-4">Interface</th>
                <th className="py-3 px-4">Tipe</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {addresses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    Tidak ada IP address terdaftar
                  </td>
                </tr>
              ) : (
                addresses.map((a, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-blue-700 text-sm">{a.address}</td>
                    <td className="py-3 px-4 text-slate-700">{a.network}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                        {a.interface}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {a.dynamic ? (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold">
                          DHCP Dynamic
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                          Static
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {a.disabled ? (
                        <span className="text-rose-700 text-[11px] font-semibold">Disabled</span>
                      ) : (
                        <span className="text-emerald-700 text-[11px] font-semibold">Enabled</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 4: DNS CACHE */}
      {subTab === 'dns' && (
        <div className="overflow-x-auto bg-white border border-slate-200/90 rounded-2xl shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-3 px-4">Domain / Hostname</th>
                <th className="py-3 px-4">Tipe</th>
                <th className="py-3 px-4">IP / Data</th>
                <th className="py-3 px-4">TTL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {dnsCache.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500">
                    Cache DNS kosong
                  </td>
                </tr>
              ) : (
                dnsCache.slice(0, 50).map((d, idx) => (
                  <tr key={d.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 text-slate-900 font-bold">{d.name}</td>
                    <td className="py-3 px-4 text-slate-600">{d.type}</td>
                    <td className="py-3 px-4 text-blue-600 font-medium">{d.data}</td>
                    <td className="py-3 px-4 text-slate-500">{d.ttl}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
