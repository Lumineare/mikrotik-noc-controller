import {
  Device,
  DeviceCreate,
  DeviceTestResult,
  FleetDevice,
  DashboardData,
  PingResult,
  BatchProgressItem,
  WirelessInterfacesResponse,
  WirelessAddData,
  WirelessUpdateData,
  TerminalResult,
  SecurityProfileDetail,
  ExportResult,
  BackupResult,
  AiDiagnoseResult,
  AiApplyResult,
  AiAutoResult,
  AiChatResult,
  AiModelsResult,
  AiConfigResult,
  AuthUser,
  LoginResult,
  FloorPlan,
  ApPlacement,
  CrowdedAnalysis,
  RfScanResult,
  FloorWall,
  OptimizeAndPushResult,
  TelegramConfig,
  TelegramAlertRecord,
  SupportedChannelsResponse,
} from '../types';

const BASE_URL = '';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('rsam_noc_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('rsam-auth-unauthorized'));
    }
    const text = await res.text();
    let errMsg = `HTTP Error ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.detail) errMsg = json.detail;
      else if (json.error) errMsg = json.error;
    } catch {
      if (text) errMsg = text;
    }
    throw new Error(errMsg);
  }
  return res.json();
}

export const api = {
  // Authentication methods
  async login(username: string, password: string): Promise<LoginResult> {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse<LoginResult>(res);
  },

  async getMe(): Promise<{ authenticated: boolean; user: AuthUser }> {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse<{ authenticated: boolean; user: AuthUser }>(res);
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
      });
    } finally {
      localStorage.removeItem('rsam_noc_token');
      localStorage.removeItem('rsam_noc_user');
    }
  },

  // Device management
  async getDevices(): Promise<{ devices: Device[]; default_id?: string }> {
    const res = await fetch(`${BASE_URL}/api/devices`);
    return handleResponse(res);
  },

  async createDevice(data: DeviceCreate): Promise<{ ok: boolean; device: Device }> {
    const res = await fetch(`${BASE_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async updateDevice(id: string, data: Partial<DeviceCreate>): Promise<{ ok: boolean; device: Device }> {
    const res = await fetch(`${BASE_URL}/api/devices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async deleteDevice(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE_URL}/api/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return handleResponse(res);
  },

  async testDevice(req: { host: string; port?: number; user?: string; pass?: string }): Promise<DeviceTestResult> {
    const res = await fetch(`${BASE_URL}/api/devices/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return handleResponse(res);
  },

  // Fleet health
  async getFleet(): Promise<{ devices: FleetDevice[]; summary: { total: number; online: number; offline: number; avg_cpu: number } }> {
    const res = await fetch(`${BASE_URL}/api/fleet`);
    const json = await handleResponse<{ ok?: boolean; fleet?: FleetDevice[]; devices?: FleetDevice[]; summary?: any }>(res);
    const devices = json.fleet || json.devices || [];
    const onlineDevs = devices.filter((d) => d.online);
    const totalCpu = onlineDevs.reduce((acc, d) => acc + (d.cpu_load || 0), 0);
    return {
      devices,
      summary: json.summary || {
        total: devices.length,
        online: onlineDevs.length,
        offline: devices.length - onlineDevs.length,
        avg_cpu: onlineDevs.length ? Math.round(totalCpu / onlineDevs.length) : 0,
      },
    };
  },

  // Device telemetry
  async getDashboard(deviceId?: string): Promise<DashboardData> {
    const url = deviceId ? `${BASE_URL}/api/dashboard?device=${encodeURIComponent(deviceId)}` : `${BASE_URL}/api/dashboard`;
    const res = await fetch(url);
    return handleResponse(res);
  },

  // Hardware Ping
  async ping(deviceId: string, target: string, count: number = 3): Promise<PingResult> {
    const url = `${BASE_URL}/api/ping?device=${encodeURIComponent(deviceId)}&host=${encodeURIComponent(target)}&count=${count}`;
    const res = await fetch(url);
    const json = await handleResponse<any>(res);
    return json.ping;
  },

  // Batch Execution with streaming NDJSON
  async executeBatch(
    payload: {
      devices: string[]; // device IDs
      action: 'script' | 'dns' | 'ntp' | 'password';
      script?: string;
      dns?: string[];
      ntp?: string[];
      new_pass?: string;
    },
    onProgress: (item: BatchProgressItem) => void
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/batch/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Batch execution failed with HTTP ${res.status}`);
    }

    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line) as BatchProgressItem;
          onProgress(item);
        } catch {
          // ignore malformed line
        }
      }
    }
  },

  // Winbox Management APIs
  async getWirelessInterfaces(device?: string): Promise<WirelessInterfacesResponse> {
    const params = device ? `?device=${encodeURIComponent(device)}` : '';
    const res = await fetch(`${BASE_URL}/api/wireless/interfaces${params}`);
    return handleResponse<WirelessInterfacesResponse>(res);
  },

  async getSupportedChannels(device: string | undefined, interfaceId: string): Promise<SupportedChannelsResponse> {
    const params = new URLSearchParams();
    if (device) params.set('device', device);
    params.set('interface_id', interfaceId);
    const res = await fetch(`${BASE_URL}/api/wireless/supported-channels?${params.toString()}`);
    return handleResponse<SupportedChannelsResponse>(res);
  },

  async addWirelessInterface(data: WirelessAddData): Promise<{ status: string; message: string }> {
    const res = await fetch(`${BASE_URL}/api/wireless/interfaces/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<{ status: string; message: string }>(res);
  },

  async updateWirelessInterface(data: WirelessUpdateData): Promise<{ status: string; message: string }> {
    const res = await fetch(`${BASE_URL}/api/wireless/interfaces/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<{ status: string; message: string }>(res);
  },

  async toggleWirelessInterface(device: string, interface_id: string, disabled: boolean): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/interfaces/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, interface_id, disabled }),
    });
    return handleResponse<any>(res);
  },

  async deleteWirelessInterface(device: string, interface_id: string, name: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/interfaces/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, interface_id, name }),
    });
    return handleResponse<any>(res);
  },

  async kickWirelessClient(device: string, clientId?: string, macAddress?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/clients/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, client_id: clientId, mac_address: macAddress }),
    });
    return handleResponse<any>(res);
  },

  async setClientAlias(
    macOrObj: string | { mac: string; name?: string; brand?: string; model_series?: string; vendor?: string; notes?: string },
    name?: string,
    vendor?: string,
    notes?: string,
    brand?: string,
    model_series?: string
  ): Promise<{ status: string; mac: string; name?: string; entry?: any }> {
    let payload: any;
    if (typeof macOrObj === 'object') {
      payload = macOrObj;
    } else {
      payload = {
        mac: macOrObj,
        name: name || '',
        vendor: vendor || '',
        notes: notes || '',
        brand: brand || '',
        model_series: model_series || '',
      };
    }
    const res = await fetch(`${BASE_URL}/api/wireless/clients/alias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async toggleInterface(device: string, interface_id: string, disabled: boolean): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/interfaces/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, interface_id, disabled }),
    });
    return handleResponse<any>(res);
  },

  async setInterfaceComment(device: string, interface_id: string, comment: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/interfaces/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, interface_id, comment }),
    });
    return handleResponse<any>(res);
  },

  async rebootRouter(device: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/system/reboot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
    });
    return handleResponse<any>(res);
  },

  async setRouterIdentity(device: string, identity: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/system/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, identity }),
    });
    return handleResponse<any>(res);
  },

  async executeTerminalCommand(device: string, command: string): Promise<TerminalResult> {
    const res = await fetch(`${BASE_URL}/api/terminal/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, command }),
    });
    return handleResponse<TerminalResult>(res);
  },

  async getDetailedSecurityProfiles(device: string): Promise<{ profiles: SecurityProfileDetail[] }> {
    const res = await fetch(`${BASE_URL}/api/wireless/security-profiles?device=${encodeURIComponent(device)}`);
    return handleResponse<{ profiles: SecurityProfileDetail[] }>(res);
  },

  async addSecurityProfile(
    device: string,
    name: string,
    wpa2_key: string,
    mode = 'dynamic-keys',
    auth_types = 'wpa2-psk'
  ): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/security-profiles/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device,
        name,
        wpa2_key,
        mode,
        authentication_types: auth_types,
      }),
    });
    return handleResponse<any>(res);
  },

  async updateSecurityProfile(
    device: string,
    profile_id: string,
    wpa2_key?: string,
    mode = 'dynamic-keys',
    auth_types = 'wpa2-psk'
  ): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/security-profiles/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device,
        profile_id,
        wpa2_key,
        mode,
        authentication_types: auth_types,
      }),
    });
    return handleResponse<any>(res);
  },

  async deleteSecurityProfile(device: string, profile_id: string, name: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/wireless/security-profiles/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, profile_id, name }),
    });
    return handleResponse<any>(res);
  },

  async exportRouterConfig(device: string, compact = true): Promise<ExportResult> {
    const res = await fetch(`${BASE_URL}/api/system/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, compact }),
    });
    return handleResponse<ExportResult>(res);
  },

  async createRouterBackup(device: string, name?: string): Promise<BackupResult> {
    const res = await fetch(`${BASE_URL}/api/system/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, name }),
    });
    return handleResponse<BackupResult>(res);
  },

  async getAiDiagnose(device: string): Promise<AiDiagnoseResult> {
    const res = await fetch(`${BASE_URL}/api/ai/diagnose?device=${encodeURIComponent(device)}`);
    return handleResponse<AiDiagnoseResult>(res);
  },

  async applyAiAction(device: string, action_type: string, action_params?: any): Promise<AiApplyResult> {
    const res = await fetch(`${BASE_URL}/api/ai/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, action_type, action_params }),
    });
    return handleResponse<AiApplyResult>(res);
  },

  async autoAiOptimize(
    device: string,
    opts?: { dry_run?: boolean; include_medium?: boolean; actions?: string[] }
  ): Promise<AiAutoResult> {
    const res = await fetch(`${BASE_URL}/api/ai/optimize/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, ...(opts || {}) }),
    });
    return handleResponse<AiAutoResult>(res);
  },

  async rollbackAiOptimize(run_id: string): Promise<{ ok: boolean; interfaces_restored: number; fasttrack_rules_removed: number }> {
    const res = await fetch(`${BASE_URL}/api/ai/optimize/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id }),
    });
    return handleResponse<{ ok: boolean; interfaces_restored: number; fasttrack_rules_removed: number }>(res);
  },

  async sendAiChat(device: string, message: string, model?: string): Promise<AiChatResult> {
    const res = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, message, model }),
    });
    return handleResponse<AiChatResult>(res);
  },

  async getAiModels(): Promise<AiModelsResult> {
    const res = await fetch(`${BASE_URL}/api/ai/models`);
    return handleResponse<AiModelsResult>(res);
  },

  async saveAiModel(model: string): Promise<AiConfigResult> {
    const res = await fetch(`${BASE_URL}/api/ai/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    return handleResponse<AiConfigResult>(res);
  },

  // Map and Floor Plan methods
  async getMapFloors(): Promise<{ status: string; floors: FloorPlan[]; placements: ApPlacement[] }> {
    const res = await fetch(`${BASE_URL}/api/map/floors`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async createFloor(data: { name: string; building?: string; image_url?: string; width_meters?: number; height_meters?: number }): Promise<{ status: string; floor: FloorPlan }> {
    const res = await fetch(`${BASE_URL}/api/map/floors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async deleteFloor(floor_id: string): Promise<{ status: string; deleted_floor_id: string; floors?: FloorPlan[] }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async removeFloorImage(floor_id: string): Promise<{ status: string; floor_id: string }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/remove-image`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async placeDevice(floor_id: string, data: { device_id: string; x: number; y: number; tx_power_2g?: number; channel_2g?: number; tx_power_5g?: number; channel_5g?: number; radius_meters?: number }): Promise<{ status: string; placement: ApPlacement }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/placement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async removeDevicePlacement(device_id: string): Promise<{ status: string; removed_device_id: string }> {
    const res = await fetch(`${BASE_URL}/api/map/placements/${encodeURIComponent(device_id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async uploadFloorBlueprint(file: File, floor_id?: string): Promise<{ status: string; image_url: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    if (floor_id) {
      formData.append('floor_id', floor_id);
    }
    const res = await fetch(`${BASE_URL}/api/map/upload-floor`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
      body: formData,
    });
    return handleResponse(res);
  },

  async getCrowdedAnalysis(floor_id: string): Promise<CrowdedAnalysis> {
    const res = await fetch(`${BASE_URL}/api/map/crowded-analysis/${encodeURIComponent(floor_id)}`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse<CrowdedAnalysis>(res);
  },

  async scanRf(device: string, band: '2g' | '5g' = '2g', duration = 8): Promise<RfScanResult> {
    const q = new URLSearchParams({ device, band, duration: String(duration) });
    const res = await fetch(`${BASE_URL}/api/rf/scan?${q.toString()}`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse<RfScanResult>(res);
  },

  async syncHardware(floor_id: string, device_id?: string, channel_2g?: number, channel_5g?: number): Promise<{ status: string; total: number; success_count: number; results: any[]; message: string }> {
    const res = await fetch(`${BASE_URL}/api/map/sync-hardware`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ floor_id, device_id, channel_2g, channel_5g }),
    });
    return handleResponse(res);
  },

  // Wall Attenuation API
  async getFloorWalls(floor_id: string): Promise<{ status: string; floor_id: string; total: number; walls: FloorWall[] }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/walls`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async updateFloorWalls(floor_id: string, walls: FloorWall[]): Promise<{ status: string; floor_id: string; total: number; walls: FloorWall[] }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/walls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ walls }),
    });
    return handleResponse(res);
  },

  async resetRsamWalls(floor_id: string): Promise<{ status: string; floor_id: string; total: number; walls: FloorWall[]; message: string }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/walls/reset-rsam-preset`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async deleteFloorWall(floor_id: string, wall_id: string): Promise<{ status: string; floor_id: string; walls: FloorWall[] }> {
    const res = await fetch(`${BASE_URL}/api/map/floors/${encodeURIComponent(floor_id)}/walls/${encodeURIComponent(wall_id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  // 1-Click Mass Push All APs
  async optimizeAndPushAllAps(floor_id: string): Promise<OptimizeAndPushResult> {
    const res = await fetch(`${BASE_URL}/api/map/optimize-and-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ floor_id }),
    });
    return handleResponse<OptimizeAndPushResult>(res);
  },

  // Telegram Alert API
  async getTelegramBotInfo(): Promise<{ status: string; valid: boolean; bot_username?: string; bot_name?: string; bot_id?: number; message?: string }> {
    const res = await fetch(`${BASE_URL}/api/telegram/bot-info`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async discoverTelegramChatId(payload: { bot_token?: string }): Promise<{
    status: string;
    found: boolean;
    candidates: { chat_id: string; type: string; label: string; username?: string }[];
    message: string;
  }> {
    const res = await fetch(`${BASE_URL}/api/telegram/discover-chat-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async getTelegramConfig(): Promise<{ status: string; config: TelegramConfig }> {
    const res = await fetch(`${BASE_URL}/api/telegram/config`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async saveTelegramConfig(config: Partial<TelegramConfig>): Promise<{ status: string; message: string }> {
    const res = await fetch(`${BASE_URL}/api/telegram/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(config),
    });
    return handleResponse(res);
  },

  async testTelegramAlert(payload: { bot_token?: string; chat_id?: string }): Promise<{ status: string; success: boolean; message: string }> {
    const res = await fetch(`${BASE_URL}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async getTelegramHistory(): Promise<{ status: string; history: TelegramAlertRecord[] }> {
    const res = await fetch(`${BASE_URL}/api/telegram/history`, {
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },

  async clearTelegramHistory(): Promise<{ status: string; message: string }> {
    const res = await fetch(`${BASE_URL}/api/telegram/clear-history`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    });
    return handleResponse(res);
  },
};
