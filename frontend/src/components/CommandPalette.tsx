import React, { useState, useEffect, useRef } from 'react';
import { Search, Server, Wifi, WifiOff, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import { FleetDevice, Device } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  devices: (Device | FleetDevice)[];
  onSelectDevice: (deviceId: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  devices,
  onSelectDevice,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Global Ctrl+K / '/' shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        if (!isOpen) {
          setQuery('');
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filtered = devices.filter((d) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.host.toLowerCase().includes(q) ||
      (d.group && d.group.toLowerCase().includes(q)) ||
      ('identity' in d && d.identity?.toLowerCase().includes(q)) ||
      ('board' in d && d.board?.toLowerCase().includes(q))
    );
  });

  // Handle arrow key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelectDevice(filtered[selectedIndex].id);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-2xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-5 py-4 border-b border-slate-200 bg-slate-50 gap-3">
          <Search className="w-5 h-5 text-blue-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Cari router berdasarkan nama, IP host, grup/ruangan (cth: Melati, 102.246)..."
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono bg-slate-200/80 text-slate-600 border border-slate-300 rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100 p-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Tidak ada MikroTik yang cocok dengan kata kunci "{query}"
            </div>
          ) : (
            filtered.map((d, idx) => {
              const isSelected = idx === selectedIndex;
              const isFleet = 'online' in d;
              const isOnline = isFleet ? (d as FleetDevice).online : true;

              return (
                <div
                  key={d.id}
                  onClick={() => {
                    onSelectDevice(d.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3.5 py-3 rounded-xl cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50/80 border border-blue-200 text-slate-900 shadow-2xs' : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        isOnline
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          : 'bg-rose-50 border-rose-200 text-rose-600'
                      }`}
                    >
                      <Server className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900 truncate">{d.name}</span>
                        {d.is_default && (
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-semibold">
                            Default
                          </span>
                        )}
                        {d.group && (
                          <span className="text-[11px] font-mono px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full border border-slate-200 font-medium">
                            {d.group}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono flex items-center gap-2.5 mt-0.5">
                        <span>{d.host}:{d.port || 8728}</span>
                        {isFleet && (
                          <>
                            <span>·</span>
                            <span>{(d as FleetDevice).board || 'MikroTik'}</span>
                            <span>·</span>
                            <span className={isOnline ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                              {isOnline ? `CPU ${(d as FleetDevice).cpu_load || 0}%` : 'Offline'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400 pl-3 shrink-0">
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[11px] text-blue-600 font-mono font-semibold">
                        Buka <CornerDownLeft className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Menampilkan {filtered.length} dari {devices.length} perangkat</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-[11px] shadow-2xs">↑↓</kbd> Navigasi
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-slate-700 font-mono text-[11px] shadow-2xs">↵</kbd> Pilih
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
