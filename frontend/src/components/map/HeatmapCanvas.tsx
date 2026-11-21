import React, { useEffect, useRef } from 'react';
import { ApPlacement } from '../../types';

interface HeatmapCanvasProps {
  placements: ApPlacement[];
  width: number;
  height: number;
  mode: 'none' | '2.4ghz' | '5ghz' | 'density';
  floorWidthMeters?: number;
  floorHeightMeters?: number;
}

export const HeatmapCanvas: React.FC<HeatmapCanvasProps> = ({
  placements,
  width,
  height,
  mode,
  floorWidthMeters = 60,
  floorHeightMeters = 40,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset and clear canvas
    ctx.clearRect(0, 0, width, height);

    if (mode === 'none' || placements.length === 0) {
      return;
    }

    // Set pixel density ratio for razor-sharp rendering on Retina/HiDPI
    const pixelsPerMeterX = width / floorWidthMeters;
    const pixelsPerMeterY = height / floorHeightMeters;
    const avgPixelsPerMeter = (pixelsPerMeterX + pixelsPerMeterY) / 2;

    if (mode === 'density') {
      ctx.globalCompositeOperation = 'lighter';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    placements.forEach((ap) => {
      const centerX = (ap.x / 100) * width;
      const centerY = (ap.y / 100) * height;

      // Base radius in meters
      let radiusM = ap.radius_meters || 20;
      if (mode === '5ghz') {
        // 5GHz has higher free-space path loss and wall attenuation (~70% range of 2.4G)
        radiusM = radiusM * 0.72;
      }

      const radiusPx = Math.max(20, radiusM * avgPixelsPerMeter);

      // Create radial gradient representing RF signal dissipation (Friis transmission equation curve)
      const grad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radiusPx
      );

      if (mode === 'density') {
        // Hotspot density mode: highlights overlapping AP congestion
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.45)');   // Red hotspot
        grad.addColorStop(0.3, 'rgba(249, 115, 22, 0.35)'); // Orange
        grad.addColorStop(0.6, 'rgba(234, 179, 8, 0.25)');  // Yellow
        grad.addColorStop(0.85, 'rgba(59, 130, 246, 0.15)'); // Blue fringe
        grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      } else if (mode === '2.4ghz') {
        // 2.4 GHz coverage
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.50)');   // > -50 dBm (Emerald Green)
        grad.addColorStop(0.35, 'rgba(16, 185, 129, 0.35)'); // -55 dBm
        grad.addColorStop(0.65, 'rgba(234, 179, 8, 0.25)');  // -67 dBm (Yellow/Amber)
        grad.addColorStop(0.85, 'rgba(249, 115, 22, 0.15)'); // -75 dBm (Orange fringe)
        grad.addColorStop(1, 'rgba(249, 115, 22, 0)');       // > -80 dBm
      } else {
        // 5 GHz high throughput coverage
        grad.addColorStop(0, 'rgba(59, 130, 246, 0.55)');    // > -50 dBm (Vibrant Blue)
        grad.addColorStop(0.40, 'rgba(14, 165, 233, 0.38)'); // -55 dBm (Sky Blue)
        grad.addColorStop(0.70, 'rgba(16, 185, 129, 0.22)'); // -65 dBm (Green)
        grad.addColorStop(0.90, 'rgba(234, 179, 8, 0.12)');  // -72 dBm
        grad.addColorStop(1, 'rgba(234, 179, 8, 0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
      ctx.fill();

      // Outer dashed boundary ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = mode === '5ghz' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    });

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
  }, [placements, width, height, mode, floorWidthMeters, floorHeightMeters]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width: '100%', height: '100%' }}
    />
  );
};
