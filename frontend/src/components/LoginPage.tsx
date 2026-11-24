import React, { useState } from 'react';
import {
  Activity,
  Lock,
  User,
  Eye,
  EyeOff,
  ShieldCheck,
  Server,
  Sparkles,
  ArrowRight,
  AlertCircle,
  KeyRound,
} from 'lucide-react';
import { api } from '../api/client';
import { AuthUser } from '../types';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  // Prefill default username, keep password empty
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username dan kata sandi wajib diisi.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.login(username.trim(), password.trim());
      localStorage.setItem('rsam_noc_token', res.token);
      localStorage.setItem('rsam_noc_user', JSON.stringify(res.user));
      onLoginSuccess(res.user, res.token);
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa username dan password.');
    } finally {
      setLoading(false);
    }
  };

  const handleFillDefaults = () => {
    setUsername('Admin');
    setPassword('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 relative flex items-center justify-center p-4 overflow-hidden selection:bg-blue-100 selection:text-blue-800">
      {/* Background Soft Blue Ambient */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-blue-200/40 via-indigo-100/30 to-sky-100/40 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute -bottom-10 left-10 w-96 h-96 bg-emerald-100/40 blur-[100px] pointer-events-none rounded-full" />
      <div className="absolute -top-10 right-10 w-96 h-96 bg-sky-100/50 blur-[100px] pointer-events-none rounded-full" />

      {/* Subtle Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.4] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #cbd5e1 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Branding Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-slate-200 text-blue-600 shadow-md shadow-blue-500/10 mb-2">
            <Activity className="w-7 h-7 text-blue-600 animate-pulse" />
          </div>
          <div className="flex items-center justify-center gap-2 font-mono">
            <span className="text-2xl font-black tracking-wider text-slate-900">RSAM</span>
            <span className="text-2xl font-black text-blue-600">NOC</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-sans font-medium">
              v7 Socket API
            </span>
          </div>
          <p className="text-slate-500 text-xs">
            Fleet Controller & Router Management • RS Anwar Medika
          </p>
        </div>

        {/* Login Enterprise Clean White Box */}
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-200/60 overflow-hidden relative">
          {/* Top highlight bar */}
          <div className="h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />

          <div className="p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  Autentikasi Akses Perangkat
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Masuk untuk melihat dan mengelola 82+ router
                </p>
              </div>
              <span className="flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                Live Socket
              </span>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs animate-shake">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-blue-600" />
                  Username NOC
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Contoh: admin"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-blue-600" />
                    Kata Sandi
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[10px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {showPassword ? (
                      <>
                        <EyeOff className="w-3 h-3" /> Sembunyikan
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" /> Lihat Sandi
                      </>
                    )}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Masukkan kata sandi..."
                    className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                  />
                </div>
              </div>

              {/* Quick Fill Button */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleFillDefaults}
                  className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-blue-600/80" />
                  Isi Username Default (Admin)
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-semibold transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Memverifikasi Sesi NOC...</span>
                  </>
                ) : (
                  <>
                    <span>Masuk ke Dashboard Perangkat</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Card Footer Security Specs */}
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5 font-medium">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              RS Anwar Medika IT Infra
            </span>
            <span className="text-blue-700 font-mono text-[10px] font-semibold bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
              Port 8728 Encrypted Session
            </span>
          </div>
        </div>

        {/* Security Notice */}
        <div className="text-center space-y-1">
          <p className="text-[11px] text-slate-500">
            Akses dibatasi khusus untuk Administrator Jaringan RS Anwar Medika.
          </p>
          <p className="text-[10px] text-slate-600 font-mono font-medium">
            Lead NOC: Administrator
          </p>
        </div>
      </div>
    </div>
  );
};
