import React, { useState, useEffect, useMemo } from 'react';
import {
  Radar,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  SignalHigh,
  SignalLow,
  Wifi,
  Zap,
  TrendingUp,
  Info,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { RfScanResult, RfChannelInfo, Device } from '../../types';
import { api } from '../../api/client';

interface RfScanDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];
  defaultDeviceId?: string;
  defaultBand?: '2g' | '5g';
  onApplyFrequency?: (freq: number, channel: number) => void;
}

const GRADE_STYLES: Record<string, { bar: string; text: string; bg: string; border: string }> = {
  excellent: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  good: { bar: 'bg-lime-500', text: 'text-lime-700', bg: 'bg-lime-50', border: 'border-lime-200' },
  fair: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  poor: { bar: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  critical: { bar: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' },
};

GRADE_STYLES.unmeasured = {
  bar: 'bg-slate-300',
  text: 'text-slate-400',
  bg: 'bg-slate-50',
  border: 'border-slate-200',
};

const gradeStyle = (k: string) => GRADE_STYLES[k] || GRADE_STYLES.fair;

export const RfScanDrawer: React.FC<RfScanDrawerProps> = ({
  isOpen,
  onClose,
  devices,
  defaultDeviceId,
  defaultBand = '2g',
  onApplyFrequency,
}) => {
  const [deviceId, setDeviceId] = useState<string>(defaultDeviceId || '');
  const [band, setBand] = useState<'2g' | '5g'>(defaultBand);
  const [duration, setDuration] = useState<number>(8);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<RfScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showBssList, setShowBssList] = useState(false);

  useEffect(() => {
    if (defaultDeviceId) setDeviceId(defaultDeviceId);
    if (defaultBand) setBand(defaultBand);
  }, [defaultDeviceId, defaultBand, isOpen]);

  const runScan = async () => {
    if (!deviceId || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await api.scanRf(deviceId, band, duration);
      setResult(res);
      setExpanded(null);
    } catch (e: any) {
      setError(e.message || 'Scan gagal');
      setResult(null);
    } finally {
      setScanning(false);
    }
  };

  const sortedChannels = useMemo(() => {
    if (!result) return [];
    return [...result.channels].sort((a, b) => a.freq - b.freq);
  }, [result]);

  const maxAps = useMemo(() => {
    if (!sortedChannels.length) return 1;
    return Math.max(1, ...sortedChannels.map((c) => c.aps));
  }, [sortedChannels]);

  if (!isOpen) return null;

  const best = result?.best_channels?.[0];
  const currentQ = result?.current_channel_quality;

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-full bg-white border-l border-slate-200/90 shadow-2xl z-50 flex flex-col text-slate-900 animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-600">
            <Radar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Scan Frekuensi RF</h3>
            <p className="text-[11px] text-slate-500 font-mono">
              Spectrum occupancy &amp; channel scoring live
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-slate-200 bg-white space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Perangkat Scanner</label>
          <select
            value={deviceId}
            onChange={(e) => { setDeviceId(e.target.value); setResult(null); setError(null); }}
            className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none"
          >
            <option value="">— Pilih perangkat —</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.host})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Band</label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                onClick={() => { setBand('2g'); setResult(null); }}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  band === '2g' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                2.4 GHz
              </button>
              <button
                onClick={() => { setBand('5g'); setResult(null); }}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  band === '5g' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                5 GHz
              </button>
            </div>
          </div>
          <div className="w-24 space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Durasi</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-cyan-500 outline-none"
            >
              <option value={4}>4 s</option>
              <option value={8}>8 s</option>
              <option value={12}>12 s</option>
              <option value={20}>20 s</option>
            </select>
          </div>
        </div>

        <button
          onClick={runScan}
          disabled={!deviceId || scanning}
          className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? `Memindai spektrum ${duration}s...` : 'Mulai Scan Spektrum'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {scanning && (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-3">
            <div className="relative">
              <Radar className="w-10 h-10 text-cyan-500 animate-pulse" />
            </div>
            <span className="text-xs font-mono text-center leading-relaxed">
              Radio sedang menyapu spektrum...<br />
              <span className="text-[10px] text-slate-400">Jangan tutup halaman ini</span>
            </span>
          </div>
        )}

        {error && !scanning && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Scan Gagal
            </div>
            {error}
          </div>
        )}

        {!scanning && !result && !error && (
          <div className="text-center py-10 text-slate-400 text-xs space-y-2">
            <Radar className="w-8 h-8 mx-auto text-slate-300" />
            <p>Pilih perangkat dan tekan <b>Mulai Scan Spektrum</b>.</p>
            <p className="text-[10px] text-slate-400 leading-relaxed max-w-[280px] mx-auto">
              Sistem akan membaca seluruh BSSID di udara, menghitung tingkat okupansi tiap channel,
              lalu memberi peringkat frekuensi paling bersih.
            </p>
          </div>
        )}

        {!scanning && result && (
          <>
            {/* Rogue AP / Evil Twin Alert Banner */}
            {result.rogue_count && result.rogue_count > 0 ? (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-300 text-rose-950 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 font-bold text-xs text-rose-700">
                  <ShieldAlert className="w-4 h-4 text-rose-600 animate-pulse shrink-0" />
                  <span>PERINGATAN: {result.rogue_count} ROGUE AP / EVIL TWIN TERDETEKSI!</span>
                </div>
                <p className="text-[10.5px] text-rose-800 leading-relaxed">
                  Terdeteksi pemancar Wi-Fi yang menyiarkan nama SSID RSAM namun MAC Address (BSSID)-nya tidak terdaftar pada armada AP resmi controller.
                </p>
                <div className="space-y-1 pt-1">
                  {result.rogues?.map((rg) => (
                    <div key={rg.bssid} className="p-2 rounded-xl bg-white border border-rose-200 text-[10px] font-mono flex items-center justify-between">
                      <div>
                        <div className="font-bold text-rose-700 flex items-center gap-1.5">
                          <span>{rg.ssid}</span>
                          <span className="text-[8.5px] px-1 py-0.2 rounded bg-rose-100 text-rose-800 font-bold uppercase">
                            PALSU / ROGUE
                          </span>
                        </div>
                        <div className="text-slate-500 text-[9px]">MAC: {rg.bssid} · {rg.freq} MHz</div>
                      </div>
                      <span className="text-rose-700 font-bold">{rg.signal} dBm</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Current vs Best verdict */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-50 to-cyan-50/60 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                  Channel Sekarang
                </span>
                <span className="text-[9px] font-mono text-slate-400">
                  {result.interface} · {result.scanned_at}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xl font-bold font-mono text-slate-900">
                    Ch {result.current_channel.channel}
                    <span className="text-xs font-normal text-slate-500 ml-1.5">
                      {result.current_channel.freq} MHz
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {result.current_channel.width} · {result.current_channel.ssid}
                  </p>
                </div>
                {currentQ !== null && currentQ !== undefined && (
                  <div className="text-right">
                    <p className={`text-lg font-bold font-mono ${
                      gradeStyle(result.current_channel_grade === 'Sangat Baik' ? 'excellent'
                        : result.current_channel_grade === 'Baik' ? 'good'
                        : result.current_channel_grade === 'Cukup' ? 'fair'
                        : result.current_channel_grade === 'Buruk' ? 'poor' : 'critical').text
                    }`}>
                      {currentQ}
                    </p>
                    <p className="text-[9px] text-slate-500 uppercase font-bold">skor</p>
                  </div>
                )}
              </div>

              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    currentQ && currentQ >= 65 ? 'bg-emerald-500'
                      : currentQ && currentQ >= 45 ? 'bg-lime-500'
                      : currentQ && currentQ >= 25 ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(2, currentQ || 0)}%` }}
                />
              </div>

              {best && currentQ !== null && currentQ !== undefined && (
                <>
                  {best.channel !== result.current_channel.channel && best.quality > (currentQ || 0) + 8 ? (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 leading-snug flex items-start gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        Channel <b>{best.channel}</b> ({best.freq} MHz) lebih bersih —
                        skor <b>{best.quality}</b> vs {currentQ} sekarang.
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 leading-snug flex items-start gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Channel saat ini sudah termasuk yang terbaik di lokasi ini.</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Best channels */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-cyan-600" />
                <h4 className="text-xs font-bold text-slate-900">Rekomendasi Frekuensi Terbaik</h4>
                <span className="text-[9px] font-mono text-slate-400 ml-auto">
                  {result.total_bss_detected} BSS terdeteksi
                </span>
              </div>

              {result.best_channels.map((c, i) => {
                const st = gradeStyle(c.grade_key);
                return (
                  <div
                    key={c.channel}
                    className={`p-3 rounded-xl border ${st.border} ${st.bg} space-y-1.5`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-md ${st.bar} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900 font-mono flex items-center gap-1.5">
                            Channel {c.channel}
                            <span className="text-[10px] font-normal text-slate-500">{c.freq} MHz</span>
                            {c.is_dfs && (
                              <span className="text-[8.5px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold uppercase">
                                DFS
                              </span>
                            )}
                            {c.non_overlapping && (
                              <span className="text-[8.5px] px-1 py-0.2 rounded bg-blue-100 text-blue-800 font-semibold uppercase">
                                Std
                              </span>
                            )}
                          </p>
                          <p className={`text-[9.5px] font-semibold ${st.text}`}>{c.grade}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-base font-bold font-mono ${st.text}`}>{c.quality}</p>
                        <p className="text-[8.5px] text-slate-500 uppercase font-bold">skor</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[9.5px] text-slate-600 font-mono">
                      <span className="flex items-center gap-1">
                        <Wifi className="w-2.5 h-2.5" /> {c.aps} AP
                      </span>
                      <span className="flex items-center gap-1">
                        <SignalHigh className="w-2.5 h-2.5" /> {c.strong_aps} kuat
                      </span>
                      <span>Eff. {c.effective_dbm} dBm</span>
                    </div>

                    {onApplyFrequency && (
                      <button
                        onClick={() => {
                          onApplyFrequency(c.freq, c.channel);
                          onClose();
                        }}
                        className="mt-1 w-full py-1 px-2 rounded-lg bg-white/90 hover:bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-[10px] font-bold font-mono transition-colors cursor-pointer flex items-center justify-center gap-1 shadow-2xs"
                      >
                        <span>Pilih Frekuensi Ini ({c.freq} MHz)</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Spectrum bars */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <SignalLow className="w-3.5 h-3.5 text-slate-600" />
                  Okupansi Seluruh Channel
                </h4>
                <span className="text-[9px] text-slate-400 font-mono">makin tinggi = makin padat</span>
              </div>

              <div className="space-y-1">
                {sortedChannels.map((c) => {
                  const st = gradeStyle(c.grade_key);
                  const isCurrent = c.channel === result.current_channel.channel;
                  const isExpanded = expanded === c.channel;
                  const isMeasured = c.measured !== false && c.quality !== null;
                  const heightPct = c.usage_pct !== null && c.usage_pct !== undefined
                    ? Math.max(2, Math.min(100, c.usage_pct))
                    : Math.max(3, (c.aps / maxAps) * 100);
                  return (
                    <div key={c.channel}>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : c.channel)}
                        className={`w-full text-left px-2 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                          isCurrent
                            ? 'border-cyan-400 bg-cyan-50/70'
                            : 'border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold w-10 shrink-0 ${isCurrent ? 'text-cyan-700' : 'text-slate-600'}`}>
                            {isCurrent ? '▶ ' : ''}Ch {c.channel}
                          </span>
                          <div className="flex-1 h-3 rounded-sm bg-slate-100 overflow-hidden relative">
                            <div
                              className={`h-full ${st.bar} transition-all`}
                              style={{ width: `${heightPct}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-slate-500 w-8 text-right shrink-0">
                            {c.aps}
                          </span>
                          <span className={`text-[10px] font-mono font-bold w-9 text-right shrink-0 ${st.text}`}>
                            {isMeasured ? c.quality : '—'}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="ml-12 mr-2 mb-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9.5px] font-mono text-slate-600">
                            <span>Frekuensi: <b className="text-slate-900">{c.freq} MHz</b></span>
                            <span>Eff. level: <b className="text-slate-900">{c.effective_dbm} dBm</b></span>
                            {c.usage_pct !== null && c.usage_pct !== undefined ? (
                              <span>Usage terukur: <b className="text-slate-900">{c.usage_pct}%</b></span>
                            ) : (
                              <span>Usage terukur: <b className="text-slate-500">tidak tersedia</b></span>
                            )}
                            <span>AP terdeteksi: <b className="text-slate-900">{c.aps}</b></span>
                            <span>AP kuat (≥-70): <b className="text-slate-900">{c.strong_aps}</b></span>
                            {c.avg_signal !== null && (
                              <span>Rata RSSI: <b className="text-slate-900">{c.avg_signal} dBm</b></span>
                            )}
                            {c.max_signal !== null && (
                              <span>Terkuat: <b className="text-slate-900">{c.max_signal} dBm</b></span>
                            )}
                          </div>
                          {c.neighbours.length > 0 && (
                            <div className="pt-1 border-t border-slate-200 space-y-0.5">
                              <p className="text-[8.5px] font-bold text-slate-400 uppercase">Tetangga Terdekat</p>
                              {c.neighbours.map((n) => (
                                <div key={n.bssid + n.freq} className="flex items-center justify-between text-[9px] font-mono">
                                  <span className="text-slate-700 truncate max-w-[180px]">{n.ssid}</span>
                                  <span className={n.signal >= -70 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
                                    {n.signal} dBm
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Raw BSS list */}
            <div className="border-t border-slate-200 pt-3">
              <button
                onClick={() => setShowBssList((v) => !v)}
                className="w-full flex items-center justify-between text-[11px] font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Info className="w-3 h-3" />
                  Daftar BSSID Terdeteksi ({result.bss_list.length})
                </span>
                {showBssList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showBssList && (
                <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
                  {result.bss_list.map((b) => (
                    <div
                      key={b.bssid + b.freq}
                      className={`p-2 rounded-xl border text-[9.5px] font-mono transition-colors ${
                        b.is_rogue
                          ? 'bg-rose-50/70 border-rose-300'
                          : b.is_internal
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            b.is_rogue
                              ? 'bg-rose-600 animate-ping'
                              : b.is_internal
                              ? 'bg-emerald-500'
                              : b.signal >= -60
                              ? 'bg-blue-500'
                              : b.signal >= -75
                              ? 'bg-amber-500'
                              : 'bg-slate-300'
                          }`}
                        />
                        <span className="truncate flex-1 font-bold text-slate-800">
                          {b.ssid}
                        </span>

                        {b.is_rogue ? (
                          <span className="text-[8px] px-1.5 py-0.2 rounded-md bg-rose-600 text-white font-bold uppercase shrink-0">
                            🚨 ROGUE AP
                          </span>
                        ) : b.is_internal ? (
                          <span
                            className="text-[8px] px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800 font-semibold truncate max-w-[140px] shrink-0"
                            title={`AP Resmi: ${b.internal_device_name} (${b.internal_iface || ''})`}
                          >
                            🛡️ {b.internal_device_name || 'RSAM'}
                          </span>
                        ) : (
                          <span className="text-[8px] px-1 py-0.2 rounded bg-slate-200 text-slate-600 shrink-0">
                            Tetangga
                          </span>
                        )}

                        <span
                          className={`shrink-0 font-bold ml-1 ${
                            b.is_rogue
                              ? 'text-rose-700'
                              : b.signal >= -70
                              ? 'text-slate-900'
                              : 'text-slate-500'
                          }`}
                        >
                          {b.signal} dBm
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[8.5px] text-slate-400 pl-3.5">
                        <span>BSSID: <b className="text-slate-600">{b.bssid}</b></span>
                        <span>{b.freq} MHz · {b.width} MHz · SNR {b.snr}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
