import React, { useEffect, useState } from 'react';
import {
  X,
  Radio,
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  MapPin,
  Tag,
  Wifi,
  Smartphone,
  Tablet,
  Laptop,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { ClientPresence, RoamingEvent } from '../../types';
import { api } from '../../api/client';

interface ClientTrailDrawerProps {
  mac: string | null;
  onClose: () => void;
  onOpenAliasModal?: (client: ClientPresence) => void;
  onSelectFloorMap?: (floorId: string, deviceId: string) => void;
}

export const ClientTrailDrawer: React.FC<ClientTrailDrawerProps> = ({
  mac,
  onClose,
  onOpenAliasModal,
  onSelectFloorMap,
}) => {
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<ClientPresence | null>(null);
  const [trail, setTrail] = useState<RoamingEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTrail = async (targetMac: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getClientTrail(targetMac);
      setClient(res.client);
      setTrail(res.trail || []);
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat riwayat roaming klien');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mac) {
      loadTrail(mac);
    } else {
      setClient(null);
      setTrail([]);
    }
  }, [mac]);

  if (!mac) return null;

  const getDeviceIcon = (type?: string) => {
    switch (type) {
      case 'tablet':
        return <Tablet className="w-5 h-5 text-indigo-600" />;
      case 'laptop':
        return <Laptop className="w-5 h-5 text-sky-600" />;
      case 'mobile':
      case 'phone':
        return <Smartphone className="w-5 h-5 text-blue-600" />;
      default:
        return <Wifi className="w-5 h-5 text-slate-600" />;
    }
  };

  const getSignalBadge = (dbm?: number) => {
    if (dbm == null) return <span className="text-slate-400 text-xs">-</span>;
    if (dbm >= -65) {
      return (
        <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          {dbm} dBm (Bagus)
        </span>
      );
    }
    if (dbm >= -75) {
      return (
        <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          {dbm} dBm (Sedang)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        {dbm} dBm (Lemah)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end transition-opacity">
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 border border-blue-200">
              {getDeviceIcon(client?.device_type)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {client?.device_name || 'Pelacak Klien'}
                </h3>
                {Boolean(client?.is_custom_name) && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded">
                    Alias Medis
                  </span>
                )}
                {client?.status === 'online' ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    Offline
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-slate-500 mt-0.5">
                MAC: <span className="font-semibold text-slate-800">{mac}</span>
                {client?.ip && (
                  <> &bull; IP: <span className="text-slate-700">{client.ip}</span></>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadTrail(mac)}
              disabled={loading}
              title="Segarkan riwayat"
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Current Status Card */}
          {client && (
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/90 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Lokasi Terkini
                </span>
                <div className="flex items-center gap-2">
                  {onOpenAliasModal && (
                    <button
                      onClick={() => onOpenAliasModal(client)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      Edit Label
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">AP Terhubung</span>
                  <span className="font-semibold text-slate-800 text-sm flex items-center gap-1 mt-0.5">
                    <Radio className="w-3.5 h-3.5 text-blue-600" />
                    {client.ap_name}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Kekuatan Sinyal (RSSI)</span>
                  <div className="mt-0.5">{getSignalBadge(client.signal_dbm)}</div>
                </div>
                <div>
                  <span className="text-slate-500 block">Band / Frekuensi</span>
                  <span className="font-medium text-slate-700 mt-0.5 block font-mono">
                    {client.band || '-'} &bull; {client.interface || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Uptime Koneksi</span>
                  <span className="font-medium text-slate-700 mt-0.5 block font-mono">
                    {client.uptime || '-'}
                  </span>
                </div>
              </div>

              {/* Denah Floor Badge if placed */}
              {client.has_floor_map && client.floor_id && (
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-700">
                    <MapPin className="w-3.5 h-3.5 text-rose-500" />
                    <span>Terpetakan di: <b>{client.floor_name || client.floor_id}</b></span>
                  </div>
                  {onSelectFloorMap && (
                    <button
                      onClick={() => {
                        onClose();
                        onSelectFloorMap(client.floor_id!, client.ap_id);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      Buka di Denah
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium">Total Roam</span>
              <p className="text-lg font-bold text-slate-900 mt-0.5">
                {client?.roam_count ?? 0}×
              </p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium">Link Rate</span>
              <p className="text-xs font-bold font-mono text-slate-800 mt-1 truncate" title={client?.tx_rate}>
                {client?.tx_rate || '-'}
              </p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium">Jejak Tercatat</span>
              <p className="text-lg font-bold text-indigo-700 mt-0.5">
                {trail.length}
              </p>
            </div>
          </div>

          {/* Timeline of Movement */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                Jejak Kronologis Roaming ({trail.length})
              </h4>
              <span className="text-[11px] text-slate-500">Urutan: Terbaru &darr;</span>
            </div>

            {loading && trail.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                Memuat riwayat jejak roaming...
              </div>
            ) : trail.length === 0 ? (
              <div className="p-8 bg-slate-50 rounded-2xl border border-slate-200 text-center text-slate-500 text-xs">
                <Radio className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                Belum ada perpindahan AP (roaming) yang tercatat untuk perangkat ini.
                Klien masih berada di AP pertamanya sejak sistem mencatat.
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {trail.map((ev, idx) => {
                  const isRoam = ev.event_type === 'ROAMED';
                  const isFirst = ev.event_type === 'ASSOCIATED';
                  const isLatest = idx === 0;

                  return (
                    <div key={ev.id || idx} className="relative group">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white shadow-2xs ${
                          isLatest
                            ? 'border-blue-600 text-blue-600 ring-4 ring-blue-50'
                            : isRoam
                            ? 'border-amber-500 text-amber-600'
                            : 'border-emerald-500 text-emerald-600'
                        }`}
                      >
                        {isLatest ? (
                          <span className="w-2 h-2 rounded-full bg-blue-600" />
                        ) : isRoam ? (
                          <Radio className="w-2.5 h-2.5" />
                        ) : (
                          <CheckCircle2 className="w-2.5 h-2.5" />
                        )}
                      </div>

                      {/* Event Card */}
                      <div
                        className={`p-3.5 rounded-xl border text-xs transition-all ${
                          isLatest
                            ? 'bg-blue-50/40 border-blue-200 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                          <span className="font-mono">{ev.time_str}</span>
                          {isLatest && (
                            <span className="px-1.5 py-0.2 bg-blue-600 text-white font-semibold text-[10px] rounded">
                              Posisi Terkini
                            </span>
                          )}
                          {!isLatest && isRoam && (
                            <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 font-semibold text-[10px] rounded">
                              Roaming
                            </span>
                          )}
                          {!isLatest && isFirst && (
                            <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 font-semibold text-[10px] rounded">
                              Koneksi Awal
                            </span>
                          )}
                        </div>

                        {/* Event description */}
                        {isRoam ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 font-medium text-slate-900 flex-wrap">
                              <span className="text-slate-500 line-through">
                                {ev.from_ap_name}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-blue-700 font-semibold">
                                {ev.to_ap_name}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {/* RSSI at new AP */}
                              <span className="font-mono text-slate-700 font-semibold">
                                RSSI: {ev.to_signal_dbm != null ? `${ev.to_signal_dbm} dBm` : '-'}
                              </span>

                              {/* Delta signal */}
                              {ev.delta_signal != null && (
                                <span
                                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    ev.delta_signal > 0
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : ev.delta_signal < 0
                                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {ev.delta_signal > 0 ? (
                                    <>
                                      <TrendingUp className="w-3 h-3 text-emerald-600" />
                                      +{ev.delta_signal} dBm (Lebih Kuat)
                                    </>
                                  ) : ev.delta_signal < 0 ? (
                                    <>
                                      <TrendingDown className="w-3 h-3 text-rose-600" />
                                      {ev.delta_signal} dBm (Drop)
                                    </>
                                  ) : (
                                    '0 dBm'
                                  )}
                                </span>
                              )}

                              {ev.to_band && (
                                <span className="text-[11px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded font-mono">
                                  {ev.to_band}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="font-medium text-slate-900">
                              Terhubung pertama kali ke <b>{ev.to_ap_name}</b>
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-slate-600 font-mono text-[11px]">
                              <span>RSSI: {ev.to_signal_dbm != null ? `${ev.to_signal_dbm} dBm` : '-'}</span>
                              {ev.to_band && <span>&bull; {ev.to_band}</span>}
                              {ev.to_interface && <span>&bull; {ev.to_interface}</span>}
                            </div>
                          </div>
                        )}

                        {/* Floor information if mapped */}
                        {ev.to_floor && (
                          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="flex items-center gap-1 text-slate-600">
                              <MapPin className="w-3 h-3 text-rose-500" />
                              {ev.to_floor.floor_name || ev.to_floor.floor_id}
                            </span>
                            {onSelectFloorMap && ev.to_floor.floor_id && (
                              <button
                                onClick={() => {
                                  onClose();
                                  onSelectFloorMap(ev.to_floor!.floor_id!, ev.to_ap_id);
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                              >
                                Tampilkan Denah &rarr;
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Pelacak Jejak &amp; Audit Roaming Medis RSAM</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium rounded-xl transition-colors cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
