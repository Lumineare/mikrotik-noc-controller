import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Upload,
  Plus,
  Radio,
  Wifi,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Trash2,
  Info,
  Check,
  X,
  FileUp,
  Download,
  Radar,
} from 'lucide-react';
import { api } from '../../api/client';
import { FloorPlan, ApPlacement, CrowdedAnalysis, Device } from '../../types';
import { HeatmapCanvas } from './HeatmapCanvas';
import { ApMarker } from './ApMarker';
import { ChannelAnalyzerDrawer } from './ChannelAnalyzerDrawer';
import { RfScanDrawer } from './RfScanDrawer';
import { ApClientsModal } from './ApClientsModal';

interface FloorMapViewProps {
  onSelectDevice?: (deviceId: string) => void;
}

export const FloorMapView: React.FC<FloorMapViewProps> = ({ onSelectDevice }) => {
  const [floors, setFloors] = useState<FloorPlan[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [placements, setPlacements] = useState<ApPlacement[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [heatmapMode, setHeatmapMode] = useState<'none' | '2.4ghz' | '5ghz' | 'density'>('2.4ghz');
  const [selectedClientsAp, setSelectedClientsAp] = useState<ApPlacement | null>(null);

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ startX: 0, startY: 0, origPanX: 0, origPanY: 0 });

  // Channel Analysis Drawer
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [analysis, setAnalysis] = useState<CrowdedAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // RF Spectrum Scan Drawer
  const [isRfScanOpen, setIsRfScanOpen] = useState(false);

  // Modals
  const [showAddFloorModal, setShowAddFloorModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [newFloorBuilding, setNewFloorBuilding] = useState('Gedung Utama RSAM');
  const [newFloorWidth, setNewFloorWidth] = useState(60);
  const [newFloorHeight, setNewFloorHeight] = useState(40);
  const [newFloorFile, setNewFloorFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Sidebar unplaced devices toggle & search
  const [showUnplacedDrawer, setShowUnplacedDrawer] = useState(true);
  const [searchUnplaced, setSearchUnplaced] = useState('');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapImageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1200, height: 800 });

  // Load floors and devices
  const loadData = async () => {
    setLoading(true);
    try {
      const [mapRes, fleetRes] = await Promise.all([
        api.getMapFloors(),
        api.getDevices(),
      ]);

      setFloors(mapRes.floors || []);
      setPlacements(mapRes.placements || []);
      setDevices(fleetRes.devices || []);

      if (mapRes.floors && mapRes.floors.length > 0 && !selectedFloorId) {
        setSelectedFloorId(mapRes.floors[0].id);
      }
    } catch (err) {
      console.error('Failed to load map data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Current floor object
  const currentFloor = floors.find((f) => f.id === selectedFloorId) || floors[0];

  // Placements for current floor
  const currentFloorPlacements = placements.filter((p) => p.floor_id === currentFloor?.id);

  // Unplaced devices: in fleet but not in placements for ANY floor or current floor
  const placedDeviceIds = new Set(placements.map((p) => p.device_id));
  const unplacedDevices = devices.filter((d) => !placedDeviceIds.has(d.id));
  const filteredUnplacedDevices = unplacedDevices.filter((dev) =>
    (dev.name || '').toLowerCase().includes(searchUnplaced.toLowerCase()) ||
    (dev.host || '').toLowerCase().includes(searchUnplaced.toLowerCase()) ||
    (dev.group || '').toLowerCase().includes(searchUnplaced.toLowerCase())
  );

  // Run channel analysis when floor changes or placement updates
  const fetchAnalysis = async (floorId?: string) => {
    const fid = floorId || currentFloor?.id;
    if (!fid) return;
    setAnalyzing(true);
    try {
      const res = await api.getCrowdedAnalysis(fid);
      setAnalysis(res);
    } catch (err) {
      console.error('Failed to run analysis:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (currentFloor?.id) {
      fetchAnalysis(currentFloor.id);
    }
  }, [currentFloor?.id, placements.length]);

  // Update placement position or RF settings
  const handleUpdatePlacement = async (updated: ApPlacement) => {
    // Optimistic UI update
    setPlacements((prev) =>
      prev.map((p) => (p.device_id === updated.device_id ? updated : p))
    );

    try {
      await api.placeDevice(updated.floor_id, {
        device_id: updated.device_id,
        x: updated.x,
        y: updated.y,
        tx_power_2g: updated.tx_power_2g,
        channel_2g: updated.channel_2g,
        tx_power_5g: updated.tx_power_5g,
        channel_5g: updated.channel_5g,
        radius_meters: updated.radius_meters,
      });
      fetchAnalysis(updated.floor_id);
    } catch (err) {
      console.error('Failed to save placement:', err);
    }
  };

  // Remove placement
  const handleRemovePlacement = async (deviceId: string) => {
    setPlacements((prev) => prev.filter((p) => p.device_id !== deviceId));
    try {
      await api.removeDevicePlacement(deviceId);
      fetchAnalysis();
    } catch (err) {
      console.error('Failed to remove placement:', err);
    }
  };

  // Quick place device from unplaced list to center of current view
  const handleQuickPlace = (device: Device) => {
    if (!currentFloor) return;
    // Spread around center slightly
    const offset = (Math.random() - 0.5) * 15;
    const isSingleBandCap = Boolean(device.name?.includes('(cAP)') && !device.name.toLowerCase().includes('ac'));
    const newPlacement: ApPlacement = {
      device_id: device.id,
      floor_id: currentFloor.id,
      x: Math.round(50 + offset),
      y: Math.round(50 + offset),
      tx_power_2g: 20,
      channel_2g: 6,
      tx_power_5g: 23,
      channel_5g: 149,
      radius_meters: 20,
      device_name: device.name,
      device_host: device.host,
      device_model: isSingleBandCap ? 'cAP (2.4 GHz Only)' : 'cAP ac (Dual-Band)',
      is_online: true,
      has_5g: !isSingleBandCap,
    };

    setPlacements((prev) => [...prev, newPlacement]);
    api.placeDevice(currentFloor.id, newPlacement).then(() => {
      fetchAnalysis();
    });
  };

  // Apply AI channel recommendations automatically
  const handleApplyAiRecommendations = async () => {
    if (!currentFloor) return;
    const standard2g = [1, 6, 11];
    const standard5g = [149, 153, 157, 161, 165];

    const updatedPlacements = currentFloorPlacements.map((p, idx) => ({
      ...p,
      channel_2g: standard2g[idx % standard2g.length],
      channel_5g: standard5g[idx % standard5g.length],
    }));

    setPlacements((prev) =>
      prev.map((p) => {
        const found = updatedPlacements.find((u) => u.device_id === p.device_id);
        return found || p;
      })
    );

    try {
      await Promise.all(
        updatedPlacements.map((p) =>
          api.placeDevice(currentFloor.id, {
            device_id: p.device_id,
            x: p.x,
            y: p.y,
            tx_power_2g: p.tx_power_2g,
            channel_2g: p.channel_2g,
            tx_power_5g: p.tx_power_5g,
            channel_5g: p.channel_5g,
            radius_meters: p.radius_meters,
          })
        )
      );
      await fetchAnalysis(currentFloor.id);
    } catch (err) {
      console.error('Failed to apply AI recommendations:', err);
    }
  };

  // Sync frequency to live MikroTik routerboard socket port 8728
  const handleSyncDeviceHardware = async (
    deviceId: string,
    channels?: { channel_2g: number; channel_5g: number }
  ) => {
    if (!currentFloor) return;
    const res = await api.syncHardware(
      currentFloor.id,
      deviceId,
      channels?.channel_2g,
      channels?.channel_5g
    );
    if (channels) {
      setPlacements((prev) =>
        prev.map((p) =>
          p.device_id === deviceId
            ? { ...p, channel_2g: channels.channel_2g, channel_5g: channels.channel_5g }
            : p
        )
      );
    }
    return res;
  };

  const handleSyncAllFloorHardware = async () => {
    if (!currentFloor) return;
    return await api.syncHardware(currentFloor.id);
  };

  const handleOptimizeAndPushAll = async () => {
    if (!currentFloor) return;
    const res = await api.optimizeAndPushAllAps(currentFloor.id);
    setPlacements((prev) =>
      prev.map((p) => {
        const alloc = (res as any)?.allocations?.find(
          (a: any) => a.device_id === p.device_id || a.name === p.device_id
        );
        if (!alloc) return p;
        return {
          ...p,
          channel_2g: alloc.channel_2g ?? p.channel_2g,
          channel_5g: alloc.channel_5g ?? p.channel_5g,
        };
      })
    );
    return res;
  };

  // Export Hi-Res Map & Heatmap as PNG image
  const handleExportMapPng = () => {
    if (!currentFloor) return;

    const exportCanvas = document.createElement('canvas');
    const width = 1800;
    const height = 1200;
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // 1. Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // 2. Blueprint image
    if (mapImageRef.current && mapImageRef.current.complete) {
      try {
        ctx.drawImage(mapImageRef.current, 0, 90, width, height - 90);
      } catch (err) {
        console.warn('Could not draw blueprint image to canvas:', err);
      }
    }

    // 3. Header Banner
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, 90);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, width, 90);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillText('RS ANWAR MEDIKA — AUDIT COVERAGE WI-FI & PEMETAAN DENAH', 32, 42);

    ctx.font = '13px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';
    const dateStr = new Date().toLocaleString('id-ID');
    ctx.fillText(
      `${currentFloor.name} (${currentFloor.width_meters}m × ${currentFloor.height_meters}m) • Timestamp: ${dateStr} • AP Terpasang: ${currentFloorPlacements.length} Unit`,
      32,
      68
    );

    // 4. AP Markers
    currentFloorPlacements.forEach((p) => {
      const px = (p.x / 100) * width;
      const py = 90 + (p.y / 100) * (height - 90);

      // Signal halo
      ctx.beginPath();
      ctx.arc(px, py, 48, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
      ctx.fill();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // AP Pin
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Badge label
      const labelW = 140;
      const labelH = 30;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - labelW / 2, py + 20, labelW, labelH);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - labelW / 2, py + 20, labelW, labelH);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.device_name || p.device_id, px, py + 34);

      ctx.fillStyle = '#475569';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(
        `Ch ${p.channel_2g}/${p.channel_5g} (${p.clients_count || 0} Klien)`,
        px,
        py + 46
      );
    });

    // 5. Trigger download
    const link = document.createElement('a');
    link.download = `RSAM_${currentFloor.id}_Audit_WiFi.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  // Pan handlers
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.startX;
    const dy = e.clientY - panStartRef.current.startY;
    setPan({
      x: panStartRef.current.origPanX + dx,
      y: panStartRef.current.origPanY + dy,
    });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.max(0.4, Math.min(3.5, prev * zoomFactor)));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Create new floor
  const handleCreateFloor = async () => {
    if (!newFloorName.trim()) return;
    setUploading(true);
    try {
      let imageUrl = '/uploads/floor_1_blueprint.svg';
      if (newFloorFile) {
        const uploadRes = await api.uploadFloorBlueprint(newFloorFile);
        imageUrl = uploadRes.image_url;
      }
      const res = await api.createFloor({
        name: newFloorName.trim(),
        building: newFloorBuilding.trim(),
        image_url: imageUrl,
        width_meters: Number(newFloorWidth) || 60,
        height_meters: Number(newFloorHeight) || 40,
      });
      setFloors((prev) => [...prev, res.floor]);
      setSelectedFloorId(res.floor.id);
      setShowAddFloorModal(false);
      setNewFloorName('');
      setNewFloorFile(null);
    } catch (err) {
      alert('Gagal menambah lantai: ' + err);
    } finally {
      setUploading(false);
    }
  };

  // Delete floor
  const handleDeleteFloor = async (floorId: string) => {
    const target = floors.find((f) => f.id === floorId);
    if (!target) return;
    const msg =
      floors.length > 1
        ? `Yakin ingin menghapus denah "${target.name}"?\nSeluruh perangkat AP yang terpasang di lantai ini akan dikembalikan ke daftar Perangkat Belum Dipasang.`
        : `Ini adalah satu-satunya denah yang tersisa. Menghapus denah "${target.name}" akan meresetnya menjadi denah kosong baru. Lanjutkan?`;

    if (!window.confirm(msg)) {
      return;
    }
    try {
      const res = await api.deleteFloor(floorId);
      if (res.floors && res.floors.length > 0) {
        setFloors(res.floors);
        setSelectedFloorId(res.floors[0].id);
      } else {
        const remaining = floors.filter((f) => f.id !== floorId);
        setFloors(remaining);
        if (remaining.length > 0) setSelectedFloorId(remaining[0].id);
      }
      setPlacements((prev) => prev.filter((p) => p.floor_id !== floorId));
    } catch (err) {
      alert('Gagal menghapus denah: ' + err);
    }
  };

  // Remove / Clear floor blueprint image
  const handleRemoveFloorImage = async () => {
    if (!currentFloor) return;
    if (!window.confirm(`Hapus gambar blueprint dari denah "${currentFloor.name}" dan beralih ke grid denah polos?`)) {
      return;
    }
    setUploading(true);
    try {
      await api.removeFloorImage(currentFloor.id);
      const updated = floors.map((f) => (f.id === currentFloor.id ? { ...f, image_url: '' } : f));
      setFloors(updated);
      setShowUploadModal(false);
    } catch (err) {
      alert('Gagal menghapus gambar denah: ' + err);
    } finally {
      setUploading(false);
    }
  };

  // Upload custom blueprint image
  const handleUploadBlueprint = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentFloor) return;
    setUploading(true);
    try {
      const res = await api.uploadFloorBlueprint(file, currentFloor.id);
      // Update floor image
      const updatedFloors = floors.map((f) =>
        f.id === currentFloor.id ? { ...f, image_url: res.image_url } : f
      );
      setFloors(updatedFloors);
      setShowUploadModal(false);
    } catch (err) {
      alert('Gagal mengunggah denah: ' + err);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-500 gap-3">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono">Memuat Sistem Denah &amp; Heatmap...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] bg-slate-100 overflow-hidden select-none">
      {/* Top Map Control Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs z-30">
        {/* Left: Floor Selector & Management */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 shadow-2xs">
            <Layers className="w-4 h-4 text-blue-600" />
            <select
              value={selectedFloorId}
              onChange={(e) => setSelectedFloorId(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.width_meters}m × {f.height_meters}m)
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowAddFloorModal(true)}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-300 text-slate-700 transition-colors cursor-pointer"
            title="Tambah Lantai Baru"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowUploadModal(true)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-300 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Ganti / Unggah Gambar Denah CAD / Blueprint"
          >
            <Upload className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden sm:inline">Unggah Denah</span>
          </button>

          {/* Tombol Hapus Denah */}
          <button
            onClick={() => handleDeleteFloor(selectedFloorId)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 border border-slate-300 hover:border-rose-300 text-slate-700 hover:text-rose-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Hapus Denah Lantai Ini"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span className="hidden sm:inline">Hapus Denah</span>
          </button>
        </div>

        {/* Center: Heatmap Layer Switcher */}
        <div className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-xl shadow-inner">
          <button
            onClick={() => setHeatmapMode('none')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              heatmapMode === 'none'
                ? 'bg-white text-slate-900 border border-slate-200/90 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Denah Polos
          </button>

          <button
            onClick={() => setHeatmapMode('2.4ghz')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              heatmapMode === '2.4ghz'
                ? 'bg-white text-emerald-700 border border-slate-200/90 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Sinyal 2.4 GHz</span>
          </button>

          <button
            onClick={() => setHeatmapMode('5ghz')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              heatmapMode === '5ghz'
                ? 'bg-white text-blue-700 border border-slate-200/90 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span>5 GHz SIMRS</span>
          </button>

          <button
            onClick={() => setHeatmapMode('density')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              heatmapMode === 'density'
                ? 'bg-white text-rose-700 border border-slate-200/90 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Kepadatan Hotspot</span>
          </button>
        </div>

        {/* Right: Analyzer Button & Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Crowded Channel Trigger Button */}
          <button
            onClick={() => setIsAnalyzerOpen(true)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 border transition-all cursor-pointer shadow-xs ${
              analysis && analysis.conflicts_count > 0
                ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100 animate-pulse'
                : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Deteksi Tabrakan</span>
            {analysis && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  analysis.conflicts_count > 0 ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {analysis.conflicts_count}
              </span>
            )}
          </button>

          {/* RF Spectrum Scan Trigger */}
          <button
            onClick={() => setIsRfScanOpen(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 border bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100 transition-all cursor-pointer shadow-xs"
            title="Scan okupansi frekuensi RF live dari hardware AP"
          >
            <Radar className="w-3.5 h-3.5" />
            <span>Scan Frekuensi</span>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center bg-slate-100 border border-slate-300 rounded-xl p-0.5 shadow-2xs">
            <button
              onClick={() => setZoom((prev) => Math.min(3.5, prev + 0.15))}
              className="p-1.5 text-slate-700 hover:text-blue-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
              title="Perbesar (Zoom In)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold px-1.5 text-slate-600 min-w-[38px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((prev) => Math.max(0.4, prev - 0.15))}
              className="p-1.5 text-slate-700 hover:text-blue-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
              title="Perkecil (Zoom Out)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-1.5 text-slate-700 hover:text-blue-600 hover:bg-white rounded-lg transition-colors cursor-pointer border-l border-slate-200 ml-0.5"
              title="Reset Tampilan"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Export Hi-Res Map PNG Button */}
          <button
            onClick={handleExportMapPng}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:text-blue-600 hover:border-blue-400 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="Unduh snapshot denah dan heatmap sinyal sebagai file gambar PNG"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">Unduh Denah (PNG)</span>
          </button>
        </div>
      </div>

      {/* Main Body: Map Canvas + Unplaced AP Drawer */}
      <div className="flex-1 relative overflow-hidden flex">
        {/* Interactive Canvas Viewport */}
        <div
          ref={containerRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onWheel={handleWheel}
          className="flex-1 h-full w-full relative bg-slate-200/70 overflow-hidden cursor-crosshair flex items-center justify-center"
        >
          {/* Transform Container with Pan & Zoom */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.05s ease-out',
            }}
            className="relative shadow-2xl rounded-xl bg-white border border-slate-300"
          >
            {/* Blueprint Image or CAD Grid Fallback */}
            {currentFloor?.image_url ? (
              <img
                ref={mapImageRef}
                src={currentFloor.image_url}
                alt={currentFloor.name}
                onLoad={(e) => {
                  const target = e.target as HTMLImageElement;
                  setImageSize({
                    width: target.naturalWidth || 1200,
                    height: target.naturalHeight || 800,
                  });
                }}
                className="block max-w-none pointer-events-none rounded-xl"
                style={{ width: '1200px', height: '800px', objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{ width: '1200px', height: '800px' }}
                className="bg-slate-50 flex flex-col items-center justify-center border border-dashed border-slate-300 relative select-none"
              >
                <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="cadGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#94a3b8" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#cadGrid)" />
                </svg>
                <div className="z-10 text-center p-6 bg-white/95 backdrop-blur-xs rounded-2xl border border-slate-200 shadow-sm max-w-sm">
                  <Layers className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                  <div className="text-sm font-bold text-slate-800">{currentFloor?.name}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Denah ini menggunakan grid polos CAD. Anda tetap bisa menempatkan AP dan melihat simulasi heatmap sinyal, atau klik <span className="font-semibold text-blue-600">Unggah Denah</span> untuk memasang gambar blueprint arsitektur.
                  </div>
                </div>
              </div>
            )}

            {/* Heatmap Overlay Canvas */}
            <HeatmapCanvas
              placements={currentFloorPlacements}
              width={1200}
              height={800}
              mode={heatmapMode}
              floorWidthMeters={currentFloor?.width_meters || 60}
              floorHeightMeters={currentFloor?.height_meters || 40}
            />

            {/* AP Markers placed on this floor */}
            {currentFloorPlacements.map((placement) => (
              <ApMarker
                key={placement.device_id}
                placement={placement}
                containerRef={containerRef}
                zoom={zoom}
                conflicts={analysis?.conflicts || []}
                onUpdatePlacement={handleUpdatePlacement}
                onRemovePlacement={handleRemovePlacement}
                onSelectDevice={onSelectDevice}
                onSyncHardware={handleSyncDeviceHardware}
                onOpenClientsModal={(p) => setSelectedClientsAp(p)}
              />
            ))}
          </div>

          {/* Scale Indicator & Legend (Bottom Left) */}
          <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-xs border border-slate-200/90 rounded-2xl p-3 shadow-lg flex flex-col gap-1.5 z-20 pointer-events-auto">
            <div className="text-[11px] font-bold text-slate-800 flex items-center justify-between gap-4">
              <span>{currentFloor?.name}</span>
              <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {currentFloorPlacements.length} AP Terpasang
              </span>
            </div>

            {/* RF Legend */}
            {heatmapMode !== 'none' && (
              <div className="pt-1.5 border-t border-slate-100 flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1 text-emerald-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  &gt; -55 dBm (Bagus)
                </span>
                <span className="flex items-center gap-1 text-amber-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  -65 dBm
                </span>
                <span className="flex items-center gap-1 text-orange-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                  -75 dBm (Batas)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Collapsible Sidebar: Unplaced APs */}
        <div
          className={`bg-white border-l border-slate-200 transition-all duration-300 z-20 flex flex-col shadow-lg ${
            showUnplacedDrawer ? 'w-80' : 'w-10'
          }`}
        >
          <button
            onClick={() => setShowUnplacedDrawer(!showUnplacedDrawer)}
            className="p-2.5 border-b border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-between text-xs font-bold cursor-pointer"
          >
            {showUnplacedDrawer ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Wifi className="w-4 h-4 text-blue-600" />
                  Perangkat Belum Dipasang ({unplacedDevices.length})
                </span>
                <X className="w-4 h-4 text-slate-400" />
              </>
            ) : (
              <ChevronDown className="w-4 h-4 -rotate-90" />
            )}
          </button>

          {showUnplacedDrawer && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <input
                type="text"
                placeholder="Cari perangkat (nama/IP)..."
                value={searchUnplaced}
                onChange={(e) => setSearchUnplaced(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono text-slate-800 placeholder:text-slate-400"
              />
              <p className="text-[11px] text-slate-500 leading-tight">
                Klik tombol <span className="font-bold text-blue-600">+ Pasang</span> untuk menempatkan perangkat ke denah lantai ini.
              </p>

              {filteredUnplacedDevices.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                  {unplacedDevices.length === 0 ? 'Semua perangkat telah ditempatkan pada denah!' : 'Tidak ada perangkat yang cocok dengan pencarian.'}
                </div>
              ) : (
                filteredUnplacedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-blue-300 transition-all flex items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-slate-800 truncate">
                        {dev.name || dev.id}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 truncate">
                        {dev.host || 'MikroTik cAP ac'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleQuickPlace(dev)}
                      className="px-2.5 py-1 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      + Pasang
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Channel Analyzer Drawer */}
      <ChannelAnalyzerDrawer
        isOpen={isAnalyzerOpen}
        onClose={() => setIsAnalyzerOpen(false)}
        analysis={analysis}
        loading={analyzing}
        onRefresh={() => fetchAnalysis()}
        onApplyAiRecommendations={handleApplyAiRecommendations}
        onSyncAllHardware={handleSyncAllFloorHardware}
        onOptimizeAndPushAll={handleOptimizeAndPushAll}
      />

      {/* RF Spectrum Scan Drawer */}
      <RfScanDrawer
        isOpen={isRfScanOpen}
        onClose={() => setIsRfScanOpen(false)}
        devices={devices}
        defaultDeviceId={placements[0]?.device_id}
      />

      {/* Modal: Tambah Lantai Baru */}
      {showAddFloorModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl text-slate-900 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                Tambah Denah Lantai Baru
              </h3>
              <button
                onClick={() => setShowAddFloorModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Nama Lantai / Area</label>
                <input
                  type="text"
                  placeholder="Contoh: Lantai 3 — Rawat Inap Anak"
                  value={newFloorName}
                  onChange={(e) => setNewFloorName(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Gedung</label>
                <input
                  type="text"
                  placeholder="Contoh: Gedung Utama RSAM"
                  value={newFloorBuilding}
                  onChange={(e) => setNewFloorBuilding(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Lebar (Meter)</label>
                  <input
                    type="number"
                    value={newFloorWidth}
                    onChange={(e) => setNewFloorWidth(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Panjang (Meter)</label>
                  <input
                    type="number"
                    value={newFloorHeight}
                    onChange={(e) => setNewFloorHeight(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">File Blueprint / Gambar Denah (Opsional)</label>
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl cursor-pointer text-xs text-slate-600 transition-colors">
                    <FileUp className="w-4 h-4 text-blue-600" />
                    <span className="truncate max-w-[240px]">
                      {newFloorFile ? newFloorFile.name : 'Pilih file (SVG, PNG, JPG, WEBP)...'}
                    </span>
                    <input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => setNewFloorFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>
                  {newFloorFile && (
                    <button
                      type="button"
                      onClick={() => setNewFloorFile(null)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                      title="Hapus pilihan file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Format gambar didukung: SVG, PNG, JPG, WEBP.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowAddFloorModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleCreateFloor}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
              >
                Simpan Lantai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Unggah Gambar Denah */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl text-slate-900 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <FileUp className="w-5 h-5 text-blue-600" />
                Unggah Gambar Denah CAD / Blueprint
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Unggah file denah arsitektur rumah sakit untuk <span className="font-bold text-slate-900">{currentFloor?.name}</span>. Mendukung format gambar <span className="font-mono font-bold text-blue-600">SVG, PNG, JPG, WEBP</span>.
            </p>

            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-50">
              <input
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.webp"
                onChange={handleUploadBlueprint}
                disabled={uploading}
                className="w-full h-full opacity-0 absolute inset-0 cursor-pointer"
              />
              <Upload className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <div className="text-xs font-bold text-slate-800">
                {uploading ? 'Mengunggah denah...' : 'Klik atau seret file denah ke sini'}
              </div>
              <div className="text-[10px] text-slate-400 mt-1 font-mono">
                SVG Direkomendasikan (Resolusi Vektor Tanpa Pecah)
              </div>
            </div>

            {/* Opsi Hapus / Kosongkan Gambar Blueprint */}
            {currentFloor?.image_url && (
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">Gambar blueprint saat ini aktif</span>
                <button
                  type="button"
                  onClick={handleRemoveFloorImage}
                  disabled={uploading}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Hapus gambar denah ini dan gunakan grid polos"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Gambar Denah</span>
                </button>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connected Clients Modal */}
      <ApClientsModal
        isOpen={!!selectedClientsAp}
        onClose={() => setSelectedClientsAp(null)}
        placement={selectedClientsAp}
      />
    </div>
  );
};
