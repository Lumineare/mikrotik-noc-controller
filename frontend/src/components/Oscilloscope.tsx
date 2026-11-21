import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Gauge, Activity } from 'lucide-react';

interface OscilloscopeProps {
  rxBps: number;
  txBps: number;
  deviceName?: string;
}

export function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

export const Oscilloscope: React.FC<OscilloscopeProps> = ({
  rxBps,
  txBps,
  deviceName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const historyRef = useRef<Array<{ rx: number; tx: number }>>([]);
  const peakRxRef = useRef<number>(100_000);
  const peakTxRef = useRef<number>(100_000);

  const [peakRxDisplay, setPeakRxDisplay] = useState(0);
  const [peakTxDisplay, setPeakTxDisplay] = useState(0);

  // Keep max 60 points history
  useEffect(() => {
    const hist = historyRef.current;
    hist.push({ rx: rxBps, tx: txBps });
    if (hist.length > 60) hist.shift();

    if (rxBps > peakRxRef.current) {
      peakRxRef.current = rxBps;
      setPeakRxDisplay(rxBps);
    }
    if (txBps > peakTxRef.current) {
      peakTxRef.current = txBps;
      setPeakTxDisplay(txBps);
    }
  }, [rxBps, txBps]);

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw grid lines
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;

      // Horizontal grid lines
      const hLines = 4;
      for (let i = 1; i < hLines; i++) {
        const y = (h / hLines) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Vertical grid lines
      const vLines = 8;
      for (let i = 1; i < vLines; i++) {
        const x = (w / vLines) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      const hist = historyRef.current;
      if (hist.length < 2) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Determine max scale
      let maxVal = Math.max(...hist.map((p) => Math.max(p.rx, p.tx, 50_000)));
      maxVal = maxVal * 1.2; // 20% headroom

      const stepX = w / (60 - 1);

      // Function to draw curve
      const drawWave = (
        data: number[],
        strokeColor: string,
        glowColor: string,
        fillGradient: CanvasGradient
      ) => {
        ctx.save();
        ctx.beginPath();

        const startIndex = 60 - data.length;
        data.forEach((val, i) => {
          const x = (startIndex + i) * stepX;
          const y = h - (val / maxVal) * (h - 15) - 5;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        // Fill under line
        ctx.save();
        ctx.lineTo(w, h);
        ctx.lineTo(startIndex * stepX, h);
        ctx.closePath();
        ctx.fillStyle = fillGradient;
        ctx.fill();
        ctx.restore();

        // Stroke line with glow
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.restore();
      };

      // Gradient for RX (Cobalt Blue)
      const gradRx = ctx.createLinearGradient(0, 0, 0, h);
      gradRx.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
      gradRx.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

      // Gradient for TX (Forest Emerald)
      const gradTx = ctx.createLinearGradient(0, 0, 0, h);
      gradTx.addColorStop(0, 'rgba(5, 150, 105, 0.25)');
      gradTx.addColorStop(1, 'rgba(5, 150, 105, 0.0)');

      // Draw RX
      drawWave(hist.map((p) => p.rx), '#2563eb', '#2563eb', gradRx);
      // Draw TX
      drawWave(hist.map((p) => p.tx), '#059669', '#059669', gradTx);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  // Handle canvas resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = 140;
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <div className="relative bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm p-4">
      {/* Oscilloscope Header */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600 animate-pulse" />
          <span className="font-mono text-xs font-bold text-slate-900">
            Real-Time Bandwidth Oscilloscope
          </span>
          {deviceName && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
              {deviceName}
            </span>
          )}
        </div>

        {/* Live Gauges Summary */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <ArrowDownCircle className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-slate-500 font-medium">RX:</span>
            <span className="font-bold text-blue-600">{formatBps(rxBps)}</span>
            <span className="text-[10px] text-slate-400 font-medium">(Peak: {formatBps(peakRxDisplay)})</span>
          </div>

          <div className="flex items-center gap-1.5">
            <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-slate-500 font-medium">TX:</span>
            <span className="font-bold text-emerald-600">{formatBps(txBps)}</span>
            <span className="text-[10px] text-slate-400 font-medium">(Peak: {formatBps(peakTxDisplay)})</span>
          </div>
        </div>
      </div>

      {/* Canvas Display */}
      <div ref={containerRef} className="relative w-full h-[140px] bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
        <div className="absolute top-2 left-2.5 pointer-events-none text-[9px] font-mono text-slate-500 uppercase tracking-wider font-semibold">
          Traffic Oscilloscope · 60s Rolling Buffer
        </div>
      </div>
    </div>
  );
};
