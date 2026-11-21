import React, { useState, useRef, useEffect } from 'react';
import {
  Wifi,
  Radio,
  AlertTriangle,
  ExternalLink,
  Trash2,
  Sliders,
  Check,
  X,
  Signal,
  Users,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { ApPlacement, ChannelConflict } from '../../types';

interface ApMarkerProps {
  placement: ApPlacement;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  conflicts: ChannelConflict[];
  onUpdatePlacement: (placement: ApPlacement) => void | Promise<any>;
  onRemovePlacement: (deviceId: string) => void;
  onSelectDevice?: (deviceId: string) => void;
  onSyncHardware?: (
    deviceId: string,
    channels?: { channel_2g: number; channel_5g: number }
  ) => Promise<any>;
  onOpenClientsModal?: (placement: ApPlacement) => void;
}

export const ApMarker: React.FC<ApMarkerProps> = ({
  placement,
  containerRef,
  zoom,
  conflicts,
  onUpdatePlacement,
  onRemovePlacement,
  onSelectDevice,
  onSyncHardware,
  onOpenClientsModal,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [tempRadius, setTempRadius] = useState(placement.radius_meters);
  const [tempCh2, setTempCh2] = useState(placement.channel_2g);
  const [tempCh5, setTempCh5] = useState(placement.channel_5g || 149);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  useEffect(() => {
    setTempRadius(placement.radius_meters);
    setTempCh2(placement.channel_2g);
    setTempCh5(placement.channel_5g || 149);
  }, [placement.radius_meters, placement.channel_2g, placement.channel_5g]);

  const handleSyncToRouter = async () => {
    if (!onSyncHardware) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      // 1. Simpan perubahan ke denah & backend terlebih dahulu
      await onUpdatePlacement({
        ...placement,
        radius_meters: tempRadius,
        channel_2g: tempCh2,
        channel_5g: tempCh5,
      });
      // 2. Push frekuensi langsung ke hardware routerboard fisik via socket 8728
      const res = await onSyncHardware(placement.device_id, {
        channel_2g: tempCh2,
        channel_5g: tempCh5,
      });
      if (res?.success_count > 0) {
        const details = res?.results?.[0]?.details?.join('\n') || '';
        setSyncFeedback(`✅ Frekuensi radio disinkronkan:\n${details}`);
      } else {
        setSyncFeedback(res?.results?.[0]?.error || '⚠️ Gagal kontak socket router');
      }
    } catch (err: any) {
      setSyncFeedback('❌ Gagal: ' + (err.message || 'Error'));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncFeedback(null), 6000);
    }
  };

  // Check if this AP is involved in any co-channel conflict
  const hasConflict = conflicts.some(
    (c) => c.device_a.id === placement.device_id || c.device_b.id === placement.device_id
  );
  const primaryConflict = conflicts.find(
    (c) => c.device_a.id === placement.device_id || c.device_b.id === placement.device_id
  );

  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return; // Only left-click
    setIsDragging(true);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: placement.x,
      origY: placement.y,
    };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - dragStartRef.current.startX) / (rect.width * zoom);
    const deltaY = (e.clientY - dragStartRef.current.startY) / (rect.height * zoom);

    let newX = dragStartRef.current.origX + deltaX * 100;
    let newY = dragStartRef.current.origY + deltaY * 100;

    // Batas aman (boundary safety margin): jangan sampai pin AP keluar dari grid denah
    newX = Math.max(3.5, Math.min(96.5, Math.round(newX * 10) / 10));
    newY = Math.max(4.0, Math.min(96.0, Math.round(newY * 10) / 10));

    onUpdatePlacement({
      ...placement,
      x: newX,
      y: newY,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }
    }
  };

  const handleSaveSettings = () => {
    onUpdatePlacement({
      ...placement,
      radius_meters: tempRadius,
      channel_2g: tempCh2,
      channel_5g: tempCh5,
    });
    setShowPopover(false);
  };

  // Logika Deteksi Tabrakan Batas (Boundary Collision & Auto-Flip):
  // 1. Jika AP berada di separuh atas kanvas (y < 48%), popover DIBALIK KE BAWAH agar tidak terpotong header/grid.
  const isFlippedToBottom = placement.y < 48;

  // 2. Deteksi tepi horizontal (kiri/kanan) agar popover tidak meluber keluar kanvas.
  const isNearLeft = placement.x < 22;
  const isNearRight = placement.x > 78;

  // 3. Posisi pill nama jika di tepi paling bawah kanvas (y > 90%).
  const isPillFlippedToTop = placement.y > 90;

  return (
    <div
      style={{
        left: `${placement.x}%`,
        top: `${placement.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
      className={`absolute select-none ${showPopover || isDragging ? 'z-50' : 'z-20'}`}
    >
      {/* Coverage Ring on Hover or when selected */}
      <div
        className={`relative flex items-center justify-center cursor-grab active:cursor-grabbing transition-transform ${
          isDragging ? 'scale-110 z-30' : 'hover:scale-105'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDragging) {
            setShowPopover(!showPopover);
          }
        }}
      >
        {/* Pulsing conflict aura if co-channel interference */}
        {hasConflict && (
          <div className="absolute -inset-2.5 rounded-full bg-rose-500/20 animate-ping pointer-events-none" />
        )}

        {/* AP Pin Outer Circle */}
        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-md border-2 transition-all ${
            hasConflict
              ? 'bg-rose-50 border-rose-500 text-rose-600 shadow-rose-200'
              : placement.is_online !== false
              ? 'bg-white border-blue-600 text-blue-600 shadow-blue-100 hover:border-blue-700'
              : 'bg-slate-100 border-slate-400 text-slate-400'
          }`}
          title={`${placement.device_name || placement.device_id} (${hasConflict ? 'Tabrakan Channel' : 'Normal'})`}
        >
          <Wifi className="w-5 h-5 stroke-[2.2]" />

          {/* Conflict Badge */}
          {hasConflict && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs">
              !
            </span>
          )}

          {/* Online status dot */}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              placement.is_online !== false ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
        </div>

        {/* Device Name Pill below (disembunyikan saat popover terbuka agar tidak tumpang tindih) */}
        {!showPopover && (
          <div
            className={`absolute whitespace-nowrap px-2 py-0.5 rounded-md bg-white/95 border border-slate-200/90 shadow-xs backdrop-blur-xs flex items-center gap-1.5 pointer-events-none transition-all ${
              isPillFlippedToTop ? 'bottom-12' : 'top-11'
            } ${
              placement.x < 12
                ? 'left-0 translate-x-0'
                : placement.x > 88
                ? 'right-0 translate-x-0'
                : 'left-1/2 -translate-x-1/2'
            }`}
          >
            <span className="text-[11px] font-bold font-mono text-slate-800">
              {placement.device_name || placement.device_id}
            </span>
            <span className="text-[10px] font-mono px-1 rounded bg-slate-100 text-slate-600 border border-slate-200">
              {placement.has_5g === false
                ? `Ch ${placement.channel_2g} (2.4G)`
                : `Ch ${placement.channel_2g}/${placement.channel_5g || 149}`}
            </span>
            {typeof placement.clients_count === 'number' && (
              <span className="text-[10px] font-mono px-1 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold flex items-center gap-0.5">
                <Users className="w-2.5 h-2.5" />
                {placement.clients_count}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Popover Settings & Telemetry Modal (Auto-flip cerdas & aman dari tepi grid) */}
      {showPopover && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute w-80 bg-white/98 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-4 z-50 text-slate-900 animate-in fade-in zoom-in-95 duration-150 ring-1 ring-slate-900/5 ${
            isFlippedToBottom ? 'top-14' : 'bottom-14'
          } ${
            isNearLeft
              ? 'left-[-12px]'
              : isNearRight
              ? 'right-[-12px]'
              : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {/* Panah Indikator Penunjuk ke Pin AP */}
          <div
            className={`absolute w-3 h-3 bg-white border-slate-200 rotate-45 pointer-events-none shadow-2xs ${
              isFlippedToBottom
                ? '-top-1.5 border-t border-l'
                : '-bottom-1.5 border-b border-r'
            } ${
              isNearLeft
                ? 'left-7'
                : isNearRight
                ? 'right-7'
                : 'left-1/2 -translate-x-1/2'
            }`}
          />
          <div className="flex items-start justify-between pb-2 border-b border-slate-100">
            <div>
              <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-600" />
                {placement.device_name || placement.device_id}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {placement.device_host || 'MikroTik cAP ac'}
              </div>
            </div>
            <button
              onClick={() => setShowPopover(false)}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* View Connected Clients Action */}
          {onOpenClientsModal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenClientsModal(placement);
              }}
              className="w-full mt-2.5 py-1.5 px-2.5 rounded-xl bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200 text-blue-700 font-bold text-xs flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>Lihat Klien Terhubung</span>
              </span>
              <span className="text-[10px] font-mono bg-blue-200/80 text-blue-800 px-1.5 py-0.5 rounded-full">
                {placement.clients_count || 0} Klien
              </span>
            </button>
          )}

          {/* Conflict warning banner inside popover */}
          {hasConflict && primaryConflict && (
            <div className="mt-2.5 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-start gap-1.5 leading-snug">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Tabrakan Frekuensi:</span> {primaryConflict.reason}
              </div>
            </div>
          )}

          {/* Channel Selectors */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 uppercase font-mono">
                Channel 2.4G
              </label>
              <select
                value={tempCh2}
                onChange={(e) => setTempCh2(Number(e.target.value))}
                className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value={1}>Ch 1 (2412 MHz)</option>
                <option value={6}>Ch 6 (2437 MHz)</option>
                <option value={11}>Ch 11 (2462 MHz)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600 uppercase font-mono flex items-center justify-between">
                <span>Channel 5G</span>
                {placement.has_5g !== false && (
                  <span className="text-[9px] text-blue-600 lowercase font-normal">UNII-3 Reg-RI</span>
                )}
              </label>
              {placement.has_5g !== false ? (
                <select
                  value={tempCh5}
                  onChange={(e) => setTempCh5(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 font-semibold"
                >
                  <optgroup label="Standar RSAM / Regulasi Indonesia (UNII-3)">
                    <option value={149}>Ch 149 (5745 MHz)</option>
                    <option value={153}>Ch 153 (5765 MHz)</option>
                    <option value={157}>Ch 157 (5785 MHz)</option>
                    <option value={161}>Ch 161 (5805 MHz)</option>
                    <option value={165}>Ch 165 (5825 MHz)</option>
                  </optgroup>
                  <optgroup label="UNII-1 (Bebas / Router Non-Country Lock)">
                    <option value={36}>Ch 36 (5180 MHz)</option>
                    <option value={40}>Ch 40 (5200 MHz)</option>
                    <option value={44}>Ch 44 (5220 MHz)</option>
                    <option value={48}>Ch 48 (5240 MHz)</option>
                  </optgroup>
                </select>
              ) : (
                <div className="w-full mt-1 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-500 italic">
                  2.4G Only (Tanpa Radio 5G)
                </div>
              )}
            </div>
          </div>

          {/* Coverage Radius Slider */}
          <div className="mt-3">
            <div className="flex justify-between items-center text-[10px] font-mono text-slate-600 mb-1">
              <span>Radius Jangkauan</span>
              <span className="font-bold text-blue-600">{tempRadius} meter</span>
            </div>
            <input
              type="range"
              min={10}
              max={40}
              step={1}
              value={tempRadius}
              onChange={(e) => setTempRadius(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
            />
          </div>

          {/* Coordinate info */}
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
            <span>Posisi: ({placement.x}%, {placement.y}%)</span>
            <span>TX Power: {placement.tx_power_2g} dBm</span>
          </div>

          {/* Sync Hardware Button */}
          {onSyncHardware && (
            <div className="mt-2.5 pt-2 border-t border-slate-100">
              <button
                onClick={handleSyncToRouter}
                disabled={syncing}
                className="w-full py-1.5 px-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {syncing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span>{syncing ? 'Mengirim Socket MikroTik...' : '⚡ Push Frekuensi ke Router Fisik'}</span>
              </button>
              {syncFeedback && (
                <div className="mt-1.5 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-mono text-center font-bold text-slate-700 whitespace-pre-line leading-relaxed">
                  {syncFeedback}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-1.5">
            <button
              onClick={() => onRemovePlacement(placement.device_id)}
              className="px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              title="Lepas AP dari denah"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Lepas</span>
            </button>

            <div className="flex items-center gap-1.5">
              {onSelectDevice && (
                <button
                  onClick={() => onSelectDevice(placement.device_id)}
                  className="px-2.5 py-1.5 rounded-lg text-slate-700 hover:bg-slate-100 border border-slate-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Masuk ke detail router"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Detail</span>
                </button>
              )}
              <button
                onClick={handleSaveSettings}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Simpan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
