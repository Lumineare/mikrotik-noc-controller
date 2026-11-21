import React, { useState, useEffect } from 'react';
import {
  Send,
  Bell,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  Activity,
  Zap,
  Sliders,
  History,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '../api/client';
import { TelegramConfig, TelegramAlertRecord } from '../types';

interface TelegramSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TelegramSettingsModal: React.FC<TelegramSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [tokenDirty, setTokenDirty] = useState(false);
  const [history, setHistory] = useState<TelegramAlertRecord[]>([]);
  const [detectingBot, setDetectingBot] = useState(false);
  const [botInfo, setBotInfo] = useState<{ valid: boolean; username?: string; name?: string; message?: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<{ chat_id: string; type: string; label: string; username?: string }[]>([]);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<TelegramConfig>({
    enabled: false,
    bot_token: '',
    chat_id: '',
    notify_on_down: true,
    notify_on_recovery: true,
    notify_on_high_cpu: true,
    cpu_threshold_pct: 80,
    notify_on_ethernet_downgrade: true,
    notify_on_rf_conflict: true,
    check_interval_sec: 30,
  });

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await api.getTelegramConfig();
      if (res?.config) {
        setConfig({
          ...res.config,
          // Token mentah tidak pernah dikirim server — biarkan kosong,
          // tampilkan versi tersamar sebagai placeholder saja.
          bot_token: '',
        });
        setTokenDirty(false);
      }
    } catch (err) {
      console.error('Failed to load telegram config:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await api.getTelegramHistory();
      setHistory(res?.history || []);
    } catch (err) {
      console.error('Failed to load alert history:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadHistory();
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const payload: TelegramConfig = { ...config };
      // Hanya kirim token kalau user memang mengetik token baru.
      if (!tokenDirty) delete payload.bot_token;
      const res = await api.saveTelegramConfig(payload);
      setTestResult({ success: true, message: res.message || 'Pengaturan bot berhasil disimpan!' });
      setTokenDirty(false);
      setConfig((c) => ({ ...c, bot_token: '' }));
      await loadConfig();
    } catch (err: any) {
      setTestResult({ success: false, message: 'Gagal menyimpan: ' + (err.message || 'Error') });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testTelegramAlert({
        bot_token: config.bot_token,
        chat_id: config.chat_id,
      });
      setTestResult({ success: res.success, message: res.message });
      loadHistory();
    } catch (err: any) {
      setTestResult({ success: false, message: 'Gagal kirim tes: ' + (err.message || 'Error') });
    } finally {
      setTesting(false);
    }
  };

  const handleDetectBot = async () => {
    setDetectingBot(true);
    setBotInfo(null);
    try {
      // Simpan token dulu supaya endpoint bot-info bisa membacanya
      if (config.bot_token) {
        await api.saveTelegramConfig({ ...config });
      }
      const res = await api.getTelegramBotInfo();
      if (res.valid) {
        setBotInfo({ valid: true, username: res.bot_username, name: res.bot_name });
      } else {
        setBotInfo({ valid: false, message: res.message });
      }
    } catch (err: any) {
      setBotInfo({ valid: false, message: err.message || 'Gagal validasi token' });
    } finally {
      setDetectingBot(false);
    }
  };

  const handleDiscoverChatId = async () => {
    setDiscovering(true);
    setCandidates([]);
    try {
      const res = await api.discoverTelegramChatId({ bot_token: config.bot_token });
      setCandidates(res.candidates || []);
      setDiscoverMsg(res.message);
    } catch (err: any) {
      setDiscoverMsg('Gagal: ' + (err.message || 'Error'));
    } finally {
      setDiscovering(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await api.clearTelegramHistory();
      setHistory([]);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-xl w-full shadow-2xl text-slate-900 space-y-4 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl bg-sky-50 text-sky-600 border border-sky-200">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                Notifikasi Bot Telegram RSAM NOC
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Peringatan otomatis insiden AP Down, High CPU &amp; Flapping
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-slate-200 gap-2 shrink-0 text-xs font-bold">
          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Pengaturan Bot &amp; Alert</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('history');
              loadHistory();
            }}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Riwayat Alert ({history.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {activeTab === 'settings' ? (
            <>
              {/* Master Enable Switch */}
              <div className="p-3.5 rounded-2xl bg-sky-50/70 border border-sky-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs text-slate-900">Aktifkan Notifikasi Telegram</div>
                  <div className="text-[11px] text-slate-500">
                    Sistem akan memantau seluruh armada AP di background dan mengirimkan alert real-time.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
                </label>
              </div>

              {/* Bot Credentials Form */}
              <div className="space-y-3 p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xs">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Telegram Bot Token (dari @BotFather):
                  </label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      placeholder={
                        config.has_token && config.bot_token_masked
                          ? config.bot_token_masked
                          : 'Contoh: 7123456789:AAFlkJ...'
                      }
                      value={config.bot_token || ''}
                      onChange={(e) => {
                        setConfig({ ...config, bot_token: e.target.value });
                        setTokenDirty(e.target.value.trim().length > 0);
                      }}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-500 font-mono text-slate-800 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {config.has_token && !tokenDirty && (
                    <p className="text-[10px] text-emerald-700 mt-1 flex items-center gap-1 font-mono">
                      <Shield className="w-3 h-3" />
                      Token tersimpan di server & disembunyikan. Ketik token baru hanya jika ingin menggantinya.
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Buat bot di Telegram via <span className="text-sky-600 font-semibold">@BotFather</span>, lalu masukkan HTTP API token di sini.
                  </p>

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleDetectBot}
                      disabled={detectingBot || !config.bot_token}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {detectingBot ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                      <span>Cek Token</span>
                    </button>
                    {botInfo?.valid && (
                      <span className="text-[11px] text-emerald-700 font-mono flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        @{botInfo.username} ({botInfo.name})
                      </span>
                    )}
                    {botInfo && !botInfo.valid && (
                      <span className="text-[11px] text-rose-600 font-mono">{botInfo.message}</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Telegram Chat ID / Group ID:
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: -1001234567890 (Grup) atau 12345678 (Akun Pribadi)"
                    value={config.chat_id || ''}
                    onChange={(e) => setConfig({ ...config, chat_id: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-500 font-mono text-slate-800"
                  />

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleDiscoverChatId}
                      disabled={discovering || !config.bot_token}
                      className="px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Cari Chat ID otomatis dari pesan yang sudah masuk ke bot"
                    >
                      {discovering ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      <span>Cari Chat ID Otomatis</span>
                    </button>
                  </div>

                  {discoverMsg && (
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">{discoverMsg}</p>
                  )}

                  {candidates.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {candidates.map((c) => (
                        <button
                          key={c.chat_id}
                          type="button"
                          onClick={() => setConfig({ ...config, chat_id: c.chat_id })}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between transition-colors cursor-pointer ${
                            config.chat_id === c.chat_id
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={`px-1 rounded text-[9px] font-bold ${
                              c.type === 'private' ? 'bg-slate-200 text-slate-700' : 'bg-indigo-100 text-indigo-700'
                            }`}>
                              {c.type === 'private' ? 'PRIVAT' : 'GRUP'}
                            </span>
                            <span>{c.label}</span>
                          </span>
                          <span className="font-bold">{c.chat_id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                    Untuk ID grup NOC RSAM, undang bot ke grup lalu tekan <span className="font-semibold">Cari Chat ID Otomatis</span>.
                    Untuk akun pribadi, buka botnya di Telegram dan tekan <span className="font-semibold">/start</span> terlebih dahulu.
                  </p>
                </div>
              </div>

              {/* Alert Triggers & Thresholds */}
              <div className="space-y-2 p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xs">
                <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider mb-2">
                  Pemicu Alert Otomatis:
                </div>

                <div className="space-y-2 text-xs">
                  <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Alert AP Terputus / Down (Socket 8728 Unreachable)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.notify_on_down}
                      onChange={(e) => setConfig({ ...config, notify_on_down: e.target.checked })}
                      className="rounded accent-sky-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Alert AP Kembali Online (Auto-Recovery)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.notify_on_recovery}
                      onChange={(e) => setConfig({ ...config, notify_on_recovery: e.target.checked })}
                      className="rounded accent-sky-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Alert Beban CPU Tinggi (&gt; {config.cpu_threshold_pct}%)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.notify_on_high_cpu}
                      onChange={(e) => setConfig({ ...config, notify_on_high_cpu: e.target.checked })}
                      className="rounded accent-sky-600"
                    />
                  </label>

                  {config.notify_on_high_cpu && (
                    <div className="pl-6 pr-2 py-1 space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-slate-500">
                        <span>Ambang Batas CPU:</span>
                        <span className="font-bold text-amber-600">{config.cpu_threshold_pct}%</span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={95}
                        step={5}
                        value={config.cpu_threshold_pct}
                        onChange={(e) => setConfig({ ...config, cpu_threshold_pct: Number(e.target.value) })}
                        className="w-full accent-amber-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                      />
                    </div>
                  )}

                  <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      <span>Alert Link Ethernet Downgrade ke 100M (Bukan 1 Gbps)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.notify_on_ethernet_downgrade}
                      onChange={(e) => setConfig({ ...config, notify_on_ethernet_downgrade: e.target.checked })}
                      className="rounded accent-sky-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>Notifikasi Optimasi Saluran Frekuensi Wi-Fi Massal</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.notify_on_rf_conflict}
                      onChange={(e) => setConfig({ ...config, notify_on_rf_conflict: e.target.checked })}
                      className="rounded accent-sky-600"
                    />
                  </label>
                </div>
              </div>

              {/* Feedback banner */}
              {testResult && (
                <div
                  className={`p-3 rounded-2xl text-xs font-semibold flex items-start gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </>
          ) : (
            /* History Tab */
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs text-slate-500 font-mono">Daftar notifikasi yang dikirim ke Telegram:</span>
                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-[11px] text-rose-600 hover:text-rose-800 flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Bersihkan
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                  Belum ada rekaman notifikasi terkirim.
                </div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={h.id || i}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-500">{h.timestamp}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          h.status === 'success'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {h.status === 'success' ? 'TERKIRIM' : 'GAGAL'}
                      </span>
                    </div>
                    <div
                      className="text-[11px] font-mono text-slate-800 whitespace-pre-wrap leading-tight"
                      dangerouslySetInnerHTML={{ __html: h.text }}
                    />
                    {h.error && (
                      <div className="text-[10px] text-rose-600 font-mono">Error: {h.error}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={handleTestAlert}
            disabled={testing || !config.bot_token || !config.chat_id}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Kirim pesan uji coba ke bot Telegram"
          >
            {testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-600" />
            ) : (
              <Send className="w-3.5 h-3.5 text-sky-600" />
            )}
            <span>{testing ? 'Mengirim...' : 'Kirim Pesan Tes Telegram'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium text-xs transition-colors cursor-pointer"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
