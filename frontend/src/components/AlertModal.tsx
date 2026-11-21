import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X, Server, Cpu, Clock, Layers } from 'lucide-react';

export interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  type?: 'success' | 'error' | 'info';
  details?: {
    identity?: string;
    board?: string;
    version?: string;
    uptime?: string;
    cpu_load?: string | number;
  };
  onClose: () => void;
}

export const AlertModal: React.FC<AlertModalProps> = ({
  isOpen,
  title,
  message,
  type = 'info',
  details,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSuccess = type === 'success';
  const isError = type === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-900/10 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent Strip */}
        <div
          className={`h-1.5 bg-gradient-to-r ${
            isSuccess
              ? 'from-emerald-500 via-teal-500 to-emerald-600'
              : isError
              ? 'from-rose-500 via-red-500 to-orange-500'
              : 'from-blue-600 via-indigo-600 to-sky-500'
          }`}
        />

        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border shadow-xs ${
                  isSuccess
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                    : isError
                    ? 'bg-rose-50 border-rose-200 text-rose-600'
                    : 'bg-blue-50 border-blue-200 text-blue-600'
                }`}
              >
                {isSuccess ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : isError ? (
                  <AlertCircle className="w-5 h-5" />
                ) : (
                  <Info className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">{title}</h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  RSAM NOC • Socket API Port 8728
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Optional Message */}
          {message && (
            <div className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 font-mono whitespace-pre-wrap">
              {message}
            </div>
          )}

          {/* Rich Telemetry Grid if connection test succeeded */}
          {details && (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                <span className="text-[10px] text-slate-500 mb-0.5 flex items-center gap-1 font-medium">
                  <Server className="w-3 h-3 text-blue-600" /> Identity
                </span>
                <span className="text-slate-800 font-bold truncate block">{details.identity || '-'}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                <span className="text-[10px] text-slate-500 mb-0.5 flex items-center gap-1 font-medium">
                  <Layers className="w-3 h-3 text-blue-600" /> Hardware
                </span>
                <span className="text-blue-700 font-bold truncate block">{details.board || '-'}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                <span className="text-[10px] text-slate-500 mb-0.5 flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3 text-blue-600" /> Uptime
                </span>
                <span className="text-emerald-700 font-bold truncate block">{details.uptime || '-'}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                <span className="text-[10px] text-slate-500 mb-0.5 flex items-center gap-1 font-medium">
                  <Cpu className="w-3 h-3 text-blue-600" /> CPU Load
                </span>
                <span className="text-slate-900 font-bold block">{details.cpu_load}%</span>
              </div>
            </div>
          )}

          {/* Close button */}
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
