import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Shield,
  Wifi,
  HardDrive,
  Cpu,
  ArrowRight,
  Send,
  Bot,
  User,
  Zap,
  Copy,
  Check,
  Activity,
  Layers,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  AiDiagnoseResult,
  AiRecommendation,
  AiModelPreset,
} from '../../types';
import { api } from '../../api/client';
import { ConfirmModal } from '../ConfirmModal';
import { RrmPanel } from './RrmPanel';

interface TabAiOptimizerProps {
  deviceId: string;
  deviceName?: string;
  onRefreshParent?: () => void;
}

export const TabAiOptimizer: React.FC<TabAiOptimizerProps> = ({
  deviceId,
  deviceName = 'MikroTik Router',
  onRefreshParent,
}) => {
  const [data, setData] = useState<AiDiagnoseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [copiedCmdId, setCopiedCmdId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmRec, setConfirmRec] = useState<AiRecommendation | null>(null);

  // Chat AI State
  const [chatMessages, setChatMessages] = useState<
    Array<{ sender: 'user' | 'ai'; text: string; time: string; engine?: string }>
  >([
    {
      sender: 'ai',
      text: `Halo! Saya AI Network Assistant untuk router **${deviceName}**. Saya terhubung ke OmniRoute dengan telemetri live cAP ac RS Anwar Medika. Ada yang ingin Anda tanyakan atau optimalkan?`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      engine: 'OmniRoute',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);

  // AI Model Selection State
  const [aiModels, setAiModels] = useState<AiModelPreset[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('auto/best-chat');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelFeedback, setModelFeedback] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.getAiModels();
        if (!alive) return;
        setAiModels(res.popular_presets || []);
        setAvailableModels(res.available_models || []);
        if (res.current_model) setSelectedModel(res.current_model);
      } catch {
        /* silent: fallback preset list stays */
      }
    })();
    return () => { alive = false; };
  }, []);

  const handlePickModel = async (modelId: string) => {
    setSelectedModel(modelId);
    setShowModelMenu(false);
    try {
      await api.saveAiModel(modelId);
      setModelFeedback(`Model aktif: ${modelId}`);
      setTimeout(() => setModelFeedback(null), 3000);
    } catch (e: any) {
      setModelFeedback(`Gagal simpan model: ${e.message}`);
      setTimeout(() => setModelFeedback(null), 4000);
    }
  };

  const currentModelLabel = (() => {
    const hit = aiModels.find((m) => m.id === selectedModel);
    if (hit) return hit.name;
    return selectedModel;
  })();

  const fetchDiagnosis = async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAiDiagnose(deviceId);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Gagal memuat diagnosa AI');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnosis();
  }, [deviceId]);

  const handleApplyAction = (rec: AiRecommendation) => {
    if (rec.action_type === 'none') return;
    setConfirmRec(rec);
  };

  const executeApplyAction = async (rec: AiRecommendation) => {
    setConfirmRec(null);
    setApplyingId(rec.id);
    try {
      const res = await api.applyAiAction(deviceId, rec.action_type, rec.action_params);
      setActionFeedback({ type: 'ok', text: res.message });
      setTimeout(() => setActionFeedback(null), 5000);
      await fetchDiagnosis();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setActionFeedback({ type: 'err', text: `Gagal menerapkan: ${err.message}` });
      setTimeout(() => setActionFeedback(null), 5000);
    } finally {
      setApplyingId(null);
    }
  };

  const handleCopyCommand = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmdId(id);
    setTimeout(() => setCopiedCmdId(null), 2000);
  };

  const handleSendChat = async (presetText?: string) => {
    const textToSend = presetText || chatInput;
    if (!textToSend.trim() || isSendingChat) return;

    const userTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatMessages((prev) => [
      ...prev,
      { sender: 'user', text: textToSend.trim(), time: userTime },
    ]);
    if (!presetText) setChatInput('');
    setIsSendingChat(true);

    try {
      const res = await api.sendAiChat(deviceId, textToSend.trim(), selectedModel);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: res.reply,
          time: res.timestamp || userTime,
          engine: res.engine || 'OmniRoute',
        },
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `Maaf, terjadi kendala saat menghubungkan ke analitik router: ${err.message}`,
          time: userTime,
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  };

  const filteredRecs = (data?.recommendations || []).filter((r) => {
    if (categoryFilter === 'all') return true;
    if (categoryFilter === 'critical') return r.severity === 'critical';
    return r.category === categoryFilter;
  });

  const getScoreColor = (score: number) => {
    if (score >= 90) return { text: 'text-emerald-700', border: 'border-emerald-300', bg: 'bg-emerald-50', stroke: '#059669' };
    if (score >= 75) return { text: 'text-blue-700', border: 'border-blue-300', bg: 'bg-blue-50', stroke: '#2563eb' };
    if (score >= 60) return { text: 'text-amber-700', border: 'border-amber-300', bg: 'bg-amber-50', stroke: '#d97706' };
    return { text: 'text-rose-700', border: 'border-rose-300', bg: 'bg-rose-50', stroke: '#e11d48' };
  };

  const scoreTheme = data ? getScoreColor(data.score) : getScoreColor(100);

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div
          className={`flex items-center gap-2 p-3.5 rounded-xl border animate-fadeIn shadow-xs ${
            actionFeedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {actionFeedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span className="flex-1 font-semibold">{actionFeedback.text}</span>
        </div>
      )}

      {/* DIRECT-PUSH RRM: DCA + TPC + steering, autonomous */}
      <RrmPanel deviceId={deviceId} onApplied={onRefreshParent} />

      {/* HERO SECTION: AI HEALTH SCORE & TELEMETRY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card 1: Score Radial Gauge */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Sparkles className="w-32 h-32 text-blue-600" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-700 font-bold">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <span>AI Health Score</span>
              </div>
              <button
                onClick={fetchDiagnosis}
                disabled={loading}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 hover:text-slate-900 transition-colors flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer shadow-xs"
                title="Diagnosa Ulang"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
                <span>Analisis Ulang</span>
              </button>
            </div>

            <div className="mt-4 flex items-center gap-5">
              {/* Circular Gauge */}
              <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-slate-100"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    stroke={scoreTheme.stroke}
                    strokeDasharray={`${data?.score || 0}, 100`}
                    strokeLinecap="round"
                    strokeWidth="3.5"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className={`text-2xl font-bold ${scoreTheme.text}`}>
                    {data?.score ?? '--'}
                  </span>
                  <span className="text-[9px] text-slate-400 font-semibold uppercase">/ 100</span>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-base font-bold ${scoreTheme.text}`}>
                    {data?.status || 'Menganalisis...'}
                  </span>
                  {data?.grade && (
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${scoreTheme.border} ${scoreTheme.bg} ${scoreTheme.text}`}>
                      Grade {data.grade}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Evaluasi RF wireless, utilisasi radio 5GHz, keamanan service port, dan proteksi flash cAP ac.
                </p>
                <div className="text-[10px] text-slate-400 mt-2 font-medium">
                  Diagnosa terakhir: {data?.diagnosed_at || '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>Rekomendasi Terbuka:</span>
            <span className="font-bold text-slate-900">
              {data?.recommendations?.length || 0} Tindakan Optimasi
            </span>
          </div>
        </div>

        {/* Card 2: Live Diagnostic Vitals */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center gap-2 text-slate-900 font-bold mb-3">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>Vitals Hardware cAP ac</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Free Storage */}
            <div className={`p-3 rounded-xl border ${
              (data?.free_hdd_kb || 1000) < 1000
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                <HardDrive className="w-3.5 h-3.5 text-amber-600" />
                <span>Free Flash Storage</span>
              </div>
              <div className="text-sm font-bold mt-1 text-slate-900">
                {data ? `${Math.round(data.free_hdd_kb / 1024 * 10) / 10} MB` : '--'}
              </div>
              <div className="text-[9px] text-slate-400 font-medium">
                {(data?.free_hdd_kb || 0) < 1000 ? '⚠️ Sangat Menipis' : 'Kapasitas Aman'}
              </div>
            </div>

            {/* Free Memory */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                <span>Free RAM</span>
              </div>
              <div className="text-sm font-bold text-slate-900 mt-1">
                {data?.free_mem_mb ? `${data.free_mem_mb} MB` : '--'}
              </div>
              <div className="text-[9px] text-slate-400 font-medium">128 MB Bawaan</div>
            </div>

            {/* CPU Load */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                <Zap className="w-3.5 h-3.5 text-emerald-600" />
                <span>CPU Load</span>
              </div>
              <div className="text-sm font-bold text-emerald-600 mt-1">
                {data ? `${data.cpu_load}%` : '--'}
              </div>
              <div className="text-[9px] text-slate-400 font-medium">Normal Forwarding</div>
            </div>

            {/* Wireless Clients */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                <span>Klien Terhubung</span>
              </div>
              <div className="text-sm font-bold text-indigo-700 mt-1">
                {data?.client_count ?? '--'} User
              </div>
              <div className="text-[9px] text-slate-400 font-medium">Klien Aktif</div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-slate-500 truncate font-medium">
            Model: <b className="text-slate-800 font-bold">{data?.model || 'MikroTik cAP ac'}</b>
          </div>
        </div>

        {/* Card 3: Healthy Highlights */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center gap-2 text-emerald-700 font-bold mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Kondisi Aman / Optimal</span>
            </div>

            <div className="space-y-2">
              {data?.highlights?.length ? (
                data.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-slate-700 font-medium">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-400 text-[11px]">Memuat highlights...</div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium">
            Audit otomatis CIS Benchmark & Wireless RSAM.
          </div>
        </div>
      </div>

      {/* FILTER PILLS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {[
          { key: 'all', label: `Semua Rekomendasi (${data?.recommendations?.length || 0})` },
          { key: 'critical', label: `Kritis (${data?.recommendations?.filter((r) => r.severity === 'critical').length || 0})` },
          { key: 'wireless', label: `Wireless RF (${data?.recommendations?.filter((r) => r.category === 'wireless').length || 0})` },
          { key: 'storage', label: `Storage Flash (${data?.recommendations?.filter((r) => r.category === 'storage').length || 0})` },
          { key: 'performance', label: `Performa CPU (${data?.recommendations?.filter((r) => r.category === 'performance').length || 0})` },
          { key: 'security', label: `Keamanan (${data?.recommendations?.filter((r) => r.category === 'security').length || 0})` },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors shrink-0 cursor-pointer shadow-xs ${
              categoryFilter === f.key
                ? 'bg-blue-50 text-blue-700 border border-blue-300 font-bold'
                : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* RECOMMENDATIONS LIST */}
      <div className="space-y-3">
        {loading && !data ? (
          <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
            <p className="text-slate-500">Menjalankan diagnosa multi-layer RouterOS API socket...</p>
          </div>
        ) : filteredRecs.length === 0 ? (
          <div className="py-12 text-center bg-white border border-slate-200 rounded-2xl space-y-2 shadow-sm">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <p className="text-slate-900 font-bold">Tidak ada isu pada kategori ini!</p>
            <p className="text-slate-500 text-[11px]">Parameter router pada bagian ini sudah optimal.</p>
          </div>
        ) : (
          filteredRecs.map((rec) => {
            const isApplying = applyingId === rec.id;
            const isCopied = copiedCmdId === rec.id;

            let sevBorder = 'border-slate-200/90 bg-white';
            let sevBadge = 'bg-slate-100 text-slate-700 border border-slate-200';
            let sevText = 'Informasi';
            if (rec.severity === 'critical') {
              sevBorder = 'border-rose-200 bg-rose-50/20';
              sevBadge = 'bg-rose-50 text-rose-700 border border-rose-200';
              sevText = 'Prioritas Kritis';
            } else if (rec.severity === 'warning') {
              sevBorder = 'border-amber-200 bg-amber-50/20';
              sevBadge = 'bg-amber-50 text-amber-700 border border-amber-200';
              sevText = 'Peringatan Optimasi';
            } else {
              sevBorder = 'border-blue-200 bg-blue-50/20';
              sevBadge = 'bg-blue-50 text-blue-700 border border-blue-200';
              sevText = 'Saran Efisiensi';
            }

            return (
              <div
                key={rec.id}
                className={`border rounded-2xl p-4.5 transition-all ${sevBorder} space-y-3 shadow-sm`}
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-slate-100 border border-slate-200 text-blue-600 shrink-0">
                      {rec.category === 'wireless' ? (
                        <Wifi className="w-4 h-4" />
                      ) : rec.category === 'storage' ? (
                        <HardDrive className="w-4 h-4 text-amber-600" />
                      ) : rec.category === 'performance' ? (
                        <Zap className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Shield className="w-4 h-4 text-rose-600" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{rec.title}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-2 py-0.2 rounded font-bold uppercase ${sevBadge}`}>
                          {sevText}
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase font-medium">
                          Kategori: {rec.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Impact Tag */}
                  {rec.impact && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] self-start sm:self-auto font-semibold">
                      <Zap className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span>{rec.impact}</span>
                    </div>
                  )}
                </div>

                {/* Description */}
                <p className="text-slate-600 text-xs leading-relaxed pl-0 sm:pl-11 font-sans">
                  {rec.description}
                </p>

                {/* Command Preview */}
                {rec.command && (
                  <div className="pl-0 sm:pl-11">
                    <div className="bg-slate-100 border border-slate-200/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-[11px] shadow-xs">
                      <span className="text-slate-800 font-mono font-medium truncate">{rec.command}</span>
                      <button
                        onClick={() => handleCopyCommand(rec.id, rec.command)}
                        className="text-slate-400 hover:text-slate-700 p-1.5 hover:bg-slate-200/70 rounded-lg transition-colors shrink-0 cursor-pointer"
                        title="Salin Command RouterOS"
                      >
                        {isCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <div className="pl-0 sm:pl-11 pt-1 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">
                    Eksekusi langsung ke MikroTik via socket API port 8728
                  </span>

                  {rec.action_type !== 'none' ? (
                    <button
                      onClick={() => handleApplyAction(rec)}
                      disabled={isApplying}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold transition-all shadow-sm shadow-indigo-500/20 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {isApplying ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Menerapkan ke RouterOS...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                          <span>{rec.action_label || 'Terapkan Solusi AI'}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="text-slate-400 text-[11px] italic font-medium">Informasi Panduan</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* SECTION: AI NOC CONSULTATION CHAT */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-sm">Konsultasi AI NOC Engineer</h4>
              <p className="text-slate-500 text-[11px]">
                Tanya penyebab kelambatan, gangguan RF, atau konfigurasi terbaik untuk RS Anwar Medika
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setShowModelMenu((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold transition-colors cursor-pointer"
              title="Ganti model AI"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
              <span className="truncate max-w-[130px]">{currentModelLabel}</span>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              Realtime Telemetry Active
            </span>

            {showModelMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
                <div className="absolute right-0 top-8 z-50 w-80 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                    <p className="text-[11px] font-bold text-slate-900">Pilih Model AI</p>
                    <p className="text-[10px] text-slate-500">Berlaku untuk konsultasi NOC di perangkat ini</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {(aiModels.length ? aiModels : [{ id: 'auto/best-chat', name: 'Auto / Best Chat', desc: 'Otomatis' }]).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handlePickModel(m.id)}
                        className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors cursor-pointer flex items-start gap-2 ${
                          selectedModel === m.id ? 'bg-blue-50/60' : ''
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {selectedModel === m.id ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full border border-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11.5px] font-semibold text-slate-900 truncate">{m.name}</p>
                          <p className="text-[10px] text-slate-500 leading-snug">{m.desc}</p>
                          <p className="text-[9px] text-slate-400 font-mono truncate">{m.id}</p>
                        </div>
                      </button>
                    ))}
                    {availableModels.length > 0 && (
                      <div className="px-3 pt-2 pb-1 border-t border-slate-100 mt-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Model Upstream Tersedia ({availableModels.length})
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {availableModels.slice(0, 12).map((mid) => (
                            <button
                              key={mid}
                              onClick={() => handlePickModel(mid)}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                            >
                              {mid}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {modelFeedback && (
          <div className="text-[10.5px] px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-semibold">
            {modelFeedback}
          </div>
        )}

        {/* Quick Prompt Chips */}
        <div className="flex flex-wrap gap-2">
          {[
            'Kenapa klien di ruang ini sering lemot?',
            'Apa rekomendasi setting terbaik untuk WiFi bangsal?',
            'Bagaimana cara hardening cAP ac untuk standar RS?',
          ].map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendChat(prompt)}
              disabled={isSendingChat}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-600 hover:text-slate-900 text-[11px] transition-colors cursor-pointer"
            >
              "{prompt}"
            </button>
          ))}
        </div>

        {/* Message Thread */}
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 ${
                msg.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.sender === 'ai' && (
                <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-3.5 leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-50 border border-slate-200 text-slate-800 shadow-xs'
                }`}
              >
                <div className="whitespace-pre-wrap font-sans">{msg.text}</div>
                <div
                  className={`flex items-center justify-between text-[9px] mt-2 pt-1 border-t ${
                    msg.sender === 'user' ? 'border-blue-500/50 text-blue-100' : 'border-slate-200 text-slate-400'
                  }`}
                >
                  {msg.sender === 'ai' && msg.engine ? (
                    <span className="text-blue-600 font-mono flex items-center gap-1 font-semibold">
                      <Sparkles className="w-2.5 h-2.5" /> {msg.engine}
                    </span>
                  ) : <span></span>}
                  <span>{msg.time}</span>
                </div>
              </div>

              {msg.sender === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}

          {isSendingChat && (
            <div className="flex items-center gap-2 text-slate-500 text-xs pl-9">
              <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
              <span>AI sedang menganalisis kondisi live router...</span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendChat();
          }}
          className="flex items-center gap-2 pt-2 border-t border-slate-200"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Tanyakan analisis AI terkait router ini (contoh: kenapa sinyal drop?)..."
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 shadow-xs"
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || isSendingChat}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Kirim</span>
          </button>
        </form>
      </div>

      {/* AI Apply Action Confirmation Modal */}
      <ConfirmModal
        isOpen={!!confirmRec}
        title="Terapkan Optimasi AI?"
        message={`Aksi ini akan mengeksekusi parameter RouterOS API: "${confirmRec?.title}" pada router ${deviceName}. Konfigurasi akan langsung aktif dan dievaluasi ulang oleh mesin AI.`}
        confirmText="Terapkan Solusi Sekarang"
        cancelText="Batal"
        type="info"
        onConfirm={() => confirmRec && executeApplyAction(confirmRec)}
        onCancel={() => setConfirmRec(null)}
      />
    </div>
  );
};
