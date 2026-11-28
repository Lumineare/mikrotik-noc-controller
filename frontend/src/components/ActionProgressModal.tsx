import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface ActionProgressState {
  status: 'idle' | 'loading' | 'success' | 'error';
  title: string;
  message?: string;
  errorTitle?: string;
  errorMessage?: string;
}

export interface RunActionOptions {
  loadingTitle: string;
  loadingMessage?: string;
  successTitle?: string;
  errorTitle?: string;
}

export const INITIAL_ACTION_PROGRESS: ActionProgressState = {
  status: 'idle',
  title: '',
};

/**
 * Reusable hook to execute async add/delete/update actions with a non-closable
 * loading modal that auto-closes on success and displays the error on failure.
 */
export function useActionProgress() {
  const [progress, setProgress] = useState<ActionProgressState>(INITIAL_ACTION_PROGRESS);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const closeProgress = useCallback(() => {
    setProgress((prev) => (prev.status === 'loading' ? prev : INITIAL_ACTION_PROGRESS));
  }, []);

  const runAction = useCallback(
    async <T,>(opts: RunActionOptions, fn: () => Promise<T>): Promise<{ ok: boolean; data?: T; error?: string }> => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setProgress({
        status: 'loading',
        title: opts.loadingTitle,
        message: opts.loadingMessage || 'Menghubungi controller & perangkat MikroTik...',
      });

      try {
        const data = await fn();
        setProgress({
          status: 'success',
          title: opts.successTitle || 'Berhasil!',
          message: 'Perubahan telah diterapkan.',
        });
        timerRef.current = window.setTimeout(() => {
          setProgress(INITIAL_ACTION_PROGRESS);
          timerRef.current = null;
        }, 450);
        return { ok: true, data };
      } catch (err: any) {
        const msg =
          (typeof err === 'string' ? err : err?.message || err?.detail) ||
          'Terjadi kesalahan saat memproses permintaan.';
        setProgress({
          status: 'error',
          title: opts.errorTitle || 'Operasi Gagal',
          errorTitle: opts.errorTitle || 'Operasi Gagal',
          errorMessage: msg,
        });
        return { ok: false, error: msg };
      }
    },
    []
  );

  return { progress, runAction, closeProgress };
}

interface ActionProgressModalProps {
  state: ActionProgressState;
  onClose: () => void;
}

export const ActionProgressModal: React.FC<ActionProgressModalProps> = ({ state, onClose }) => {
  const isOpen = state.status !== 'idle';
  const isLoading = state.status === 'loading';
  const isSuccess = state.status === 'success';
  const isError = state.status === 'error';

  // Intercept Escape key in capture phase so loading modal cannot be bypassed
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isError) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, isError, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-xs animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-busy={isLoading}
      aria-live="assertive"
      onClick={(e) => {
        e.stopPropagation();
        // Never allow closing via backdrop while loading or success; only allow closing on error via explicit button
      }}
    >
      <div
        className="relative w-full max-w-md bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Strip */}
        <div
          className={`h-1.5 bg-gradient-to-r ${
            isError
              ? 'from-rose-500 via-red-500 to-orange-500'
              : isSuccess
              ? 'from-emerald-500 via-teal-500 to-green-500'
              : 'from-blue-600 via-sky-500 to-indigo-500'
          }`}
        />

        <div className="p-6 space-y-4">
          {isLoading && (
            <div className="flex flex-col items-center text-center space-y-3 py-2">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-xs">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 tracking-tight">{state.title}</h3>
                {state.message && (
                  <p className="text-xs text-slate-600 leading-relaxed max-w-sm">{state.message}</p>
                )}
              </div>
              <div className="w-full pt-1">
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-blue-600 rounded-full animate-pulse" />
                </div>
                <p className="mt-2 text-[11px] font-mono text-slate-400">
                  Mohon tunggu hingga selesai — pop-up akan tertutup otomatis
                </p>
              </div>
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col items-center text-center space-y-2.5 py-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-xs">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-emerald-800 tracking-tight">{state.title}</h3>
              {state.message && <p className="text-xs text-slate-500">{state.message}</p>}
            </div>
          )}

          {isError && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0 shadow-xs">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 tracking-tight">
                      {state.errorTitle || state.title || 'Operasi Gagal'}
                    </h3>
                    <p className="text-[11px] text-rose-600 font-mono mt-0.5">
                      Proses tidak dapat diselesaikan
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Tutup pesan error"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50/80 border border-rose-200 text-xs font-mono text-rose-800 leading-relaxed break-words max-h-48 overflow-y-auto">
                {state.errorMessage || 'Terjadi kesalahan tidak dikenal.'}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
