import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Device, FleetDevice, DashboardData, DeviceCreate, AuthUser } from './types';
import { api } from './api/client';
import { Header } from './components/Header';
import { FleetView } from './components/FleetView';
import { DeviceWorkspace } from './components/DeviceWorkspace';
import { CommandPalette } from './components/CommandPalette';
import { DeviceModal } from './components/DeviceModal';
import { BatchScriptModal } from './components/BatchScriptModal';
import { LoginPage } from './components/LoginPage';
import { ConfirmModal } from './components/ConfirmModal';
import { AlertModal } from './components/AlertModal';
import { FloorMapView } from './components/map/FloorMapView';
import { TelegramSettingsModal } from './components/TelegramSettingsModal';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  const [devices, setDevices] = useState<Device[]>([]);
  const [fleet, setFleet] = useState<FleetDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');
  const [activeView, setActiveView] = useState<'fleet' | 'device' | 'map'>('fleet');

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [pollingInterval, setPollingInterval] = useState<number>(2); // seconds, 0 = pause
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);

  // Modals state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: 'success' | 'error' | 'info';
    details?: any;
  }>({
    isOpen: false,
    title: '',
  });

  // Fleet summary stats
  const [fleetSummary, setFleetSummary] = useState({
    total: 0,
    online: 0,
    offline: 0,
    avg_cpu: 0,
  });

  // Load initial devices list
  const loadDevices = useCallback(async () => {
    try {
      const res = await api.getDevices();
      setDevices(res.devices || []);
      if (!activeDeviceId && res.devices?.length > 0) {
        const defaultDev = res.devices.find((d) => d.is_default) || res.devices[0];
        setActiveDeviceId(defaultDev.id);
      }
    } catch (err) {
      console.error('Failed to load devices list', err);
    }
  }, [activeDeviceId]);

  // Load fleet health
  const loadFleet = useCallback(async () => {
    try {
      const res = await api.getFleet();
      setFleet(res.devices);
      setFleetSummary(res.summary);
    } catch (err) {
      console.error('Failed to load fleet status', err);
    }
  }, []);

  // Load dashboard telemetry for active device
  const loadDashboard = useCallback(
    async (deviceId?: string) => {
      const targetId = deviceId || activeDeviceId;
      if (!targetId) return;
      try {
        const data = await api.getDashboard(targetId);
        setDashboardData(data);
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      }
    },
    [activeDeviceId]
  );

  // Check auth session on startup
  useEffect(() => {
    const checkSession = async () => {
      const token = localStorage.getItem('rsam_noc_token');
      if (!token) {
        setIsCheckingAuth(false);
        return;
      }
      try {
        const cached = localStorage.getItem('rsam_noc_user');
        if (cached) {
          setAuthUser(JSON.parse(cached));
        }
        const res = await api.getMe();
        if (res.authenticated && res.user) {
          setAuthUser(res.user);
          localStorage.setItem('rsam_noc_user', JSON.stringify(res.user));
        } else {
          setAuthUser(null);
          localStorage.removeItem('rsam_noc_token');
          localStorage.removeItem('rsam_noc_user');
        }
      } catch {
        setAuthUser(null);
        localStorage.removeItem('rsam_noc_token');
        localStorage.removeItem('rsam_noc_user');
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkSession();

    const handleUnauthorized = () => {
      setAuthUser(null);
      localStorage.removeItem('rsam_noc_token');
      localStorage.removeItem('rsam_noc_user');
    };

    window.addEventListener('rsam-auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('rsam-auth-unauthorized', handleUnauthorized);
  }, []);

  // Initial load when user is logged in
  useEffect(() => {
    if (authUser) {
      loadDevices();
      loadFleet();
    }
  }, [authUser, loadDevices, loadFleet]);

  // Load dashboard when active device changes
  useEffect(() => {
    if (activeDeviceId) {
      loadDashboard(activeDeviceId);
    }
  }, [activeDeviceId, loadDashboard]);

  // Polling loop for active device dashboard
  useEffect(() => {
    if (pollingInterval <= 0 || !activeDeviceId || activeView !== 'device') return;
    const interval = setInterval(() => {
      loadDashboard(activeDeviceId);
    }, pollingInterval * 1000);
    return () => clearInterval(interval);
  }, [pollingInterval, activeDeviceId, activeView, loadDashboard]);

  // Polling loop for fleet overview (every 10s if on fleet view)
  useEffect(() => {
    if (activeView !== 'fleet' || pollingInterval <= 0) return;
    const interval = setInterval(() => {
      loadFleet();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeView, pollingInterval, loadFleet]);

  // Global keyboard shortcuts (Ctrl+K, /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handlers
  const handleSelectDevice = (id: string) => {
    setActiveDeviceId(id);
    setActiveView('device');
    loadDashboard(id);
  };

  const handleOpenAddModal = () => {
    setEditDevice(null);
    setIsDeviceModalOpen(true);
  };

  const handleEditDevice = (device: Device) => {
    setEditDevice(device);
    setIsDeviceModalOpen(true);
  };

  const handleSaveDevice = async (data: DeviceCreate) => {
    if (data.id) {
      await api.updateDevice(data.id, data);
    } else {
      await api.createDevice(data);
    }
    await loadDevices();
    await loadFleet();
  };

  const handleDeleteDevice = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: `Hapus Router ${name}?`,
      message: `Perangkat dengan ID "${id}" akan dihapus dari daftar monitoring controller. Konfigurasi internal MikroTik di perangkat fisik tetap aman.`,
      type: 'danger',
      confirmText: 'Ya, Hapus Router',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        try {
          await api.deleteDevice(id);
          await loadDevices();
          await loadFleet();
          if (activeDeviceId === id) {
            const remaining = devices.filter((d) => d.id !== id);
            if (remaining.length > 0) {
              setActiveDeviceId(remaining[0].id);
            } else {
              setActiveDeviceId('');
              setActiveView('fleet');
            }
          }
        } catch (err: any) {
          setAlertModal({
            isOpen: true,
            title: 'Gagal Menghapus Router',
            message: err.message,
            type: 'error',
          });
        }
      },
    });
  };

  const handleTestConnection = async (device: Device | FleetDevice) => {
    setTestingDeviceId(device.id);
    try {
      const res = await api.testDevice({
        host: device.host,
        port: device.port,
        user: device.user,
      });
      if (res.ok) {
        setAlertModal({
          isOpen: true,
          title: `Koneksi Socket Port 8728 Sukses!`,
          type: 'success',
          details: {
            identity: res.identity,
            board: res.board,
            version: res.version,
            uptime: res.uptime,
            cpu_load: res.cpu_load,
          },
        });
      } else {
        setAlertModal({
          isOpen: true,
          title: `Koneksi Gagal (${device.name})`,
          message: res.error || 'Tidak dapat menghubungi perangkat via port 8728.',
          type: 'error',
        });
      }
    } catch (err: any) {
      setAlertModal({
        isOpen: true,
        title: 'Error Koneksi Socket',
        message: err.message,
        type: 'error',
      });
    } finally {
      setTestingDeviceId(null);
    }
  };

  const handleOpenBatchModal = (selectedIds?: string[]) => {
    setBatchSelectedIds(selectedIds || devices.map((d) => d.id));
    setIsBatchModalOpen(true);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (activeView === 'fleet') {
        await loadFleet();
      } else {
        await loadDashboard();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = () => {
    setIsLogoutModalOpen(true);
  };

  const handleConfirmLogout = async () => {
    setIsLogoutModalOpen(false);
    await api.logout();
    setAuthUser(null);
    setActiveView('fleet');
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4 font-mono text-blue-600">
        <Activity className="w-10 h-10 animate-pulse text-blue-600" />
        <div className="text-xs text-slate-500 font-semibold tracking-wider uppercase">
          Memverifikasi Sesi NOC RS Anwar Medika...
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <LoginPage
        onLoginSuccess={(user) => {
          setAuthUser(user);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-800">
      {/* Top Header */}
      <Header
        devices={devices}
        activeDeviceId={activeDeviceId}
        onSelectDevice={handleSelectDevice}
        activeView={activeView}
        onChangeView={setActiveView}
        fleetSummary={fleetSummary}
        pollingInterval={pollingInterval}
        onChangePolling={setPollingInterval}
        onOpenAddModal={handleOpenAddModal}
        onOpenBatchModal={() => handleOpenBatchModal()}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
        isRefreshing={isRefreshing}
        onManualRefresh={handleManualRefresh}
        user={authUser}
        onLogout={handleLogout}
      />

      {/* Main Workspace Body */}
      <main className={`flex-1 w-full mx-auto ${activeView === 'map' ? 'p-0' : 'max-w-[1720px] p-4 sm:p-5'}`}>
        {activeView === 'fleet' ? (
          <FleetView
            fleet={fleet.length > 0 ? fleet : (devices as FleetDevice[])}
            onSelectDevice={handleSelectDevice}
            onEditDevice={handleEditDevice}
            onDeleteDevice={handleDeleteDevice}
            onOpenBatchModal={handleOpenBatchModal}
            onRefreshFleet={loadFleet}
            isRefreshing={isRefreshing}
            onTestConnection={handleTestConnection}
            testingDeviceId={testingDeviceId}
          />
        ) : activeView === 'map' ? (
          <FloorMapView
            onSelectDevice={(id) => {
              handleSelectDevice(id);
            }}
          />
        ) : dashboardData ? (
          <DeviceWorkspace
            data={dashboardData}
            onBackToFleet={() => setActiveView('fleet')}
            onRefresh={() => loadDashboard()}
            isRefreshing={isRefreshing}
          />
        ) : (
          <div className="py-24 text-center space-y-3 font-mono">
            <RefreshCw className="w-8 h-8 mx-auto text-blue-600 animate-spin" />
            <div className="text-sm text-slate-500 font-medium">
              Menghubungkan socket RouterOS API port 8728 ke perangkat...
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        devices={fleet.length > 0 ? fleet : devices}
        onSelectDevice={handleSelectDevice}
      />

      <DeviceModal
        isOpen={isDeviceModalOpen}
        onClose={() => setIsDeviceModalOpen(false)}
        onSave={handleSaveDevice}
        editDevice={editDevice}
      />

      <BatchScriptModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        devices={devices}
        initialSelectedIds={batchSelectedIds}
      />

      <TelegramSettingsModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
      />

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title="Keluar dari Sesi NOC?"
        message="Sesi socket API Anda akan diakhiri. Anda perlu memasukkan kredensial login kembali untuk mengakses dashboard 82 perangkat router RS Anwar Medika."
        confirmText="Ya, Keluar Sesi"
        cancelText="Batal"
        type="logout"
        userName={authUser?.name}
        userRole={authUser?.role}
        onConfirm={handleConfirmLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
      />

      {/* Action Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        type={confirmModal.type}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Alert / Notification Modal */}
      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        details={alertModal.details}
        onClose={() => setAlertModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
