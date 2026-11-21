import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Radio,
  Sparkles,
  Zap,
  BarChart3,
  X,
  Info,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { CrowdedAnalysis, ChannelConflict } from '../../types';

interface ChannelAnalyzerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: CrowdedAnalysis | null;
  loading: boolean;
  onRefresh: () => void;
  onApplyAiRecommendations?: () => void;
  onSyncAllHardware?: () => Promise<any>;
  onOptimizeAndPushAll?: () => Promise<any>;
}

export const ChannelAnalyzerDrawer: React.FC<ChannelAnalyzerDrawerProps> = ({
  isOpen,
  onClose,
  analysis,
  loading,
  onRefresh,
  onApplyAiRecommendations,
  onSyncAllHardware,
  onOptimizeAndPushAll,
}) => {
  const [activeTab, setActiveTab] = useState<'ai' | 'channels'>('ai');
  const [syncingAll, setSyncingAll] = useState(false);
  const [optimizingPush, setOptimizingPush] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const standard2g = [1, 6, 11];
  const standard5g = [149, 153, 157, 161, 165, 36, 40, 44, 48];

  const handleSyncAll = async () => {
    if (!onSyncAllHardware) return;
    setSyncingAll(true);
    setSyncStatusMsg(null);
    try {
      const res = await onSyncAllHardware();
      setSyncStatusMsg(res?.message || 'Sinkronisasi hardware selesai');
    } catch (e: any) {
      setSyncStatusMsg('Gagal: ' + (e.message || 'Error'));
    } finally {
      setSyncingAll(false);
      setTimeout(() => setSyncStatusMsg(null), 5000);
    }
  };

  const handleOptimizeAndPush = async () => {
    if (!onOptimizeAndPushAll) return;
    setOptimizingPush(true);
    setSyncStatusMsg(null);
    try {
      const res = await onOptimizeAndPushAll();
      setSyncStatusMsg(res?.message || 'Optimasi & push massal selesai!');
      onRefresh();
    } catch (e: any) {
      setSyncStatusMsg('Gagal: ' + (e.message || 'Error'));
    } finally {
      setOptimizingPush(false);
      setTimeout(() => setSyncStatusMsg(null), 6000);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-white border-l border-slate-200/90 shadow-2xl z-50 flex flex-col text-slate-900 animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-600">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Analisis Kepadatan Channel</h3>
            <p className="text-[11px] text-slate-500 font-mono">
              Deteksi Tabrakan Sinyal &amp; RF AI Advisor
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

      {/* Sub-nav Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50/80 px-4 pt-2 gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab('ai')}
          className={`pb-2 px-1 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'ai'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Tabrakan &amp; AI ({analysis?.conflicts_count || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`pb-2 px-1 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'channels'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Beban Kanal 2.4/5G</span>
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">Menganalisis frekuensi radio...</span>
          </div>
        ) : !analysis ? (
          <div className="text-center py-8 text-xs text-slate-500">
            Tidak ada data analisis denah.
          </div>
        ) : activeTab === 'ai' ? (
          <>
            {/* Status Banner */}
            {analysis.conflicts_count > 0 ? (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                <div className="flex items-center gap-2 font-bold text-xs text-rose-700">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Ditemukan {analysis.conflicts_count} Tabrakan Co-Channel</span>
                </div>
                <p className="text-[11px] text-rose-800 leading-relaxed">
                  Terdapat AP yang berada dalam radius jangkauan berdekatan dan memancarkan frekuensi yang sama. Hal ini memicu tabrakan paket (packet collisions) dan degradasi airtime.
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                <div className="flex items-center gap-2 font-bold text-xs text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Frekuensi Channel Bersih</span>
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Tidak terdeteksi benturan channel co-channel pada denah ini. Distribusi frekuensi AP saat ini aman dan efisien.
                </p>
              </div>
            )}

            {/* Dedicated AI Optimizer Advisor Card */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-50/80 to-blue-50/80 border border-indigo-200 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>Rekomendasi AI Advisor</span>
                </div>
                <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">
                  Auto-Plan
                </span>
              </div>

              <div className="space-y-1.5">
                {analysis.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-xl bg-white/90 border border-indigo-100 text-[11px] text-slate-700 flex items-start gap-1.5 shadow-2xs leading-snug"
                  >
                    <span className="text-indigo-600 font-bold shrink-0 mt-0.5">•</span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>

              {analysis.conflicts_count > 0 && onApplyAiRecommendations && (
                <button
                  onClick={onApplyAiRecommendations}
                  className="w-full mt-2 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Terapkan Penataan Channel AI</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              )}
            </div>

            {/* List of Detected Conflicts */}
            {analysis.conflicts.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                  <span>Rincian Tabrakan Terdeteksi:</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">
                    {analysis.conflicts.length} Konflik
                  </span>
                </div>

                <div className="space-y-2">
                  {analysis.conflicts.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 text-[11px]">
                          {c.device_a.name} ↔ {c.device_b.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-mono text-[10px] font-bold">
                          {c.band} • Ch {c.channel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 leading-relaxed">
                        {c.reason}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        Jarak Estimasi: <span className="font-bold text-slate-700">{c.distance_m} meter</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 2.4 GHz Visual Channel Load Bar Chart */}
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                  Kepadatan 2.4 GHz (Non-overlapping)
                </span>
                <span className="text-[10px] font-mono text-slate-500">Ch 1 / 6 / 11</span>
              </div>

              <div className="space-y-2 pt-0.5">
                {standard2g.map((ch) => {
                  const count = analysis.channel_distribution_2g[String(ch)] || 0;
                  const isCrowded = count >= 2;
                  const percent = Math.min(100, count * 50);

                  return (
                    <div key={ch} className="space-y-1">
                      <div className="flex justify-between items-center text-[11px] font-mono">
                        <span className="font-semibold text-slate-700">Channel {ch}</span>
                        <span
                          className={`font-bold ${
                            isCrowded
                              ? 'text-rose-600'
                              : count > 0
                              ? 'text-blue-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {count} AP {isCrowded ? '(Padat)' : ''}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCrowded
                              ? 'bg-rose-500'
                              : count > 0
                              ? 'bg-blue-600'
                              : 'bg-slate-200'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5 GHz Channel Distribution */}
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-600" />
                  Kepadatan 5 GHz (High Speed)
                </span>
                <span className="text-[10px] font-mono text-slate-500">UNII-1 &amp; UNII-3</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                {standard5g.map((ch) => {
                  const count = analysis.channel_distribution_5g[String(ch)] || 0;
                  return (
                    <div
                      key={ch}
                      className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-center text-slate-800"
                    >
                      <div className="text-[9px] font-mono font-bold text-slate-500">Ch {ch}</div>
                      <div className="text-xs font-bold font-mono text-slate-900">{count} AP</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drawer Footer */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/70 flex flex-col gap-2">
        {syncStatusMsg && (
          <div className="text-[11px] font-bold text-center text-indigo-800 bg-indigo-50 border border-indigo-200 p-1.5 rounded-lg whitespace-pre-wrap">
            {syncStatusMsg}
          </div>
        )}

        {/* 1-Click mass channel allocation + push to every AP */}
        {onOptimizeAndPushAll && (
          <button
            onClick={handleOptimizeAndPush}
            disabled={optimizingPush}
            className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-60"
            title="Hitung alokasi channel bebas interferensi untuk SEMUA AP lalu terapkan serentak ke hardware"
          >
            {optimizingPush ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{optimizingPush ? 'Menerapkan ke Semua AP...' : '1-Click Optimasi & Push Semua AP'}</span>
          </button>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-500">
            2.4G: 1/6/11 · 5G: UNII-3 149–161
          </span>
          <div className="flex items-center gap-2">
            {onSyncAllHardware && (
              <button
                onClick={handleSyncAll}
                disabled={syncingAll}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                title="Terapkan rekomendasi channel yang sedang tampil ke seluruh router MikroTik lantai ini"
              >
                {syncingAll ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span>Push Rekomendasi</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
            >
              <span>Hitung Ulang</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
