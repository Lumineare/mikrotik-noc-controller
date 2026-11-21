import React, { useEffect } from 'react';
import {
  LogOut,
  AlertTriangle,
  Trash2,
  CheckCircle2,
  X,
  ShieldAlert,
  Server,
  User,
} from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info' | 'logout';
  userName?: string;
  userRole?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Konfirmasi',
  cancelText = 'Batal',
  type = 'warning',
  userName,
  userRole,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const isLogout = type === 'logout';
  const isDanger = type === 'danger' || isLogout;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-900/10 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Strip */}
        <div
          className={`h-1.5 bg-gradient-to-r ${
            isDanger
              ? 'from-rose-500 via-red-500 to-orange-500'
              : 'from-amber-500 via-orange-400 to-yellow-500'
          }`}
        />

        {/* Modal Header */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border shadow-xs ${
                  isLogout
                    ? 'bg-rose-50 border-rose-200 text-rose-600'
                    : isDanger
                    ? 'bg-red-50 border-red-200 text-red-600'
                    : 'bg-amber-50 border-amber-200 text-amber-600'
                }`}
              >
                {isLogout ? (
                  <LogOut className="w-5 h-5" />
                ) : isDanger ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  {title}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  RSAM NOC • Fleet Controller Gateway
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* User Info Box (For Logout) */}
          {isLogout && userName && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">{userName}</div>
                  <div className="text-[10px] text-blue-600 font-mono font-medium">{userRole || 'NOC Lead'}</div>
                </div>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-semibold">
                Sesi Aktif
              </span>
            </div>
          )}

          {/* Description Message */}
          <div className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            {message}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 transition-colors cursor-pointer"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-sm cursor-pointer flex items-center gap-2 ${
                isLogout
                  ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 shadow-rose-500/20'
                  : isDanger
                  ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 shadow-red-500/20'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-500/20'
              }`}
            >
              {isLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isLogout ? (
                <LogOut className="w-3.5 h-3.5" />
              ) : null}
              <span>{confirmText}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
