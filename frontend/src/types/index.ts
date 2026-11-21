export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  group: string;
  is_default: boolean;
  has_pass?: boolean;
}

export interface DeviceCreate {
  id?: string;
  name?: string;
  host: string;
  port?: number;
  user?: string;
  pass?: string;
  group?: string;
  is_default?: boolean;
}

export interface DeviceTestResult {
  ok: boolean;
  identity?: string;
  board?: string;
  version?: string;
  uptime?: string;
  cpu_load?: string | number;
  error?: string;
}

export interface FleetDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  group: string;
  is_default: boolean;
  online: boolean;
  identity: string;
  board: string;
  version: string;
  uptime: string;
  cpu_load: number;
  error?: string;
}

export interface SystemInfo {
  identity: string;
  routeros_version?: string;
  version?: string;
  board_name?: string;
  board?: string;
  model: string;
  architecture: string;
  cpu: string;
  cpu_count: string | number;
  cpu_frequency: string | number;
  cpu_load: number;
  free_memory?: number;
  total_memory?: number;
  free_hdd?: number;
  total_hdd?: number;
  memory_free_mb?: number;
  memory_total_mb?: number;
  memory_used_pct?: number;
  disk_free_mb?: number;
  disk_total_mb?: number;
  uptime: string;
  time?: string;
  date?: string;
  time_zone_name?: string;
  clock?: string;
}

export interface WirelessClient {
  mac: string;
  brand?: string;
  model_series?: string;
  device_name?: string;
  vendor?: string;
  is_custom_name?: boolean;
  device_type?: 'custom' | 'mobile' | 'laptop' | 'tablet' | 'vendor' | 'unknown';
  interface: string;
  uptime: string;
  signal_strength: string | number;
  signal_to_noise?: string | number;
  tx_rate?: string;
  rx_rate?: string;
  ssid?: string;
  ip?: string;
  comment?: string;
}

export interface InterfaceItem {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  mac_address?: string;
  mtu?: string | number;
  rx_byte?: number;
  tx_byte?: number;
  rx_packet?: number;
  tx_packet?: number;
  rx_error?: number;
  tx_error?: number;
  rx_bps?: number;
  tx_bps?: number;
  comment?: string;
}

export interface ArpItem {
  id: string;
  address: string;
  mac_address: string;
  interface: string;
  published: boolean;
  invalid: boolean;
  DHCP: boolean;
  dynamic: boolean;
  complete: boolean;
  comment?: string;
}

export interface DnsCacheItem {
  id: string;
  name: string;
  type: string;
  data: string;
  ttl: string;
}

export interface FirewallRule {
  id: string;
  chain: string;
  action: string;
  bytes: number;
  packets: number;
  disabled: boolean;
  comment?: string;
  protocol?: string;
  src_address?: string;
  dst_address?: string;
  dst_port?: string;
  in_interface?: string;
  out_interface?: string;
  to_addresses?: string;
  to_ports?: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  port: number;
  disabled: boolean;
  address?: string;
}

export interface UserItem {
  id: string;
  name: string;
  group: string;
  disabled: boolean;
  comment?: string;
  last_logged_in?: string;
}

export interface LogItem {
  id: string;
  time: string;
  topics: string;
  message: string;
}

export interface PingResult {
  host: string;
  count: number;
  transmitted: number;
  received: number;
  packet_loss: number;
  min_rtt?: string;
  avg_rtt?: string;
  max_rtt?: string;
  raw?: Array<{
    seq: number;
    host: string;
    size: number;
    ttl: number;
    time: string;
    status?: string;
  }>;
}

export interface DashboardData {
  device_id: string;
  device_name: string;
  system: SystemInfo;
  wireless: WirelessClient[];
  interfaces: InterfaceItem[];
  network: {
    arp: ArpItem[];
    dns_cache: DnsCacheItem[];
    addresses?: Array<{
      address: string;
      network: string;
      interface: string;
      disabled: boolean;
      dynamic: boolean;
    }>;
    routes?: Array<{
      dst: string;
      gateway: string;
      distance: string | number;
      active: boolean;
      static: boolean;
    }>;
    dhcp_clients?: Array<{
      interface: string;
      address: string;
      status: string;
      gateway: string;
      expires?: string;
    }>;
  };
  firewall: {
    filter: FirewallRule[];
    nat: FirewallRule[];
  };
  services: {
    services: ServiceItem[];
    users: UserItem[];
    groups: any[];
  };
  logs: LogItem[];
  throughput: {
    rx_bps: number;
    tx_bps: number;
  };
}

export interface BatchProgressItem {
  device_id: string;
  name: string;
  host: string;
  status: 'pending' | 'running' | 'ok' | 'failed';
  output?: string;
  error?: string;
}

export interface WirelessInterface {
  id: string;
  name: string;
  ssid: string;
  interface_type: string;
  master_interface: string;
  disabled: boolean;
  running: boolean;
  security_profile: string;
  vlan_mode: string;
  vlan_id: string;
  mac_address: string;
  band: string;
  frequency: string;
  channel_width?: string;
  clients_count: number;
  hide_ssid: boolean;
  comment?: string;
}

export interface WirelessInterfacesResponse {
  interfaces: WirelessInterface[];
  security_profiles: string[];
  master_options: string[];
}

export interface WirelessAddData {
  device?: string;
  name?: string;
  master_interface: string;
  ssid: string;
  security_mode: 'open' | 'password' | 'existing';
  security_profile?: string;
  password?: string;
  vlan_mode: 'no-tag' | 'use-tag';
  vlan_id?: string;
  add_bridge: boolean;
  bridge_name?: string;
  hide_ssid: boolean;
}

export interface SupportedChannel {
  channel: number;
  freq: number;
  width?: number;
  is_dfs: boolean;
  max_power?: string | null;
  max_width?: number;
}

export interface SupportedChannelsResponse {
  status: string;
  interface: string;
  band: '2g' | '5g';
  country: string;
  frequency_mode: string;
  current_frequency: string;
  current_channel_width: string;
  channels: SupportedChannel[];
  source: string;
}

export interface WirelessUpdateData {
  device?: string;
  interface_id: string;
  ssid?: string;
  frequency?: string;
  channel_width?: string;
  band?: string;
  security_mode?: 'open' | 'password' | 'existing';
  security_profile?: string;
  password?: string;
  vlan_mode?: 'no-tag' | 'use-tag';
  vlan_id?: string;
  hide_ssid?: boolean;
  disabled?: boolean;
}

export interface TerminalResult {
  status: string;
  command: string;
  output: string;
}

export interface SecurityProfileDetail {
  id: string;
  name: string;
  mode: string;
  authentication_types: string;
  unicast_ciphers: string;
  group_ciphers: string;
  wpa2_key: string;
  management_protection: string;
  default: boolean;
}

export interface ExportResult {
  status: string;
  filename: string;
  content: string;
}

export interface BackupResult {
  status: string;
  filename: string;
  message: string;
}

export interface AiRecommendation {
  id: string;
  category: 'wireless' | 'storage' | 'security' | 'performance';
  severity: 'critical' | 'warning' | 'info' | 'optimal';
  title: string;
  description: string;
  impact: string;
  command: string;
  action_type: string;
  action_label: string;
  action_params: Record<string, any>;
}

export interface AiDiagnoseResult {
  score: number;
  grade: string;
  status: string;
  device: string;
  model: string;
  cpu_load: number;
  free_mem_mb: number;
  free_hdd_kb: number;
  client_count: number;
  recommendations: AiRecommendation[];
  highlights: string[];
  diagnosed_at: string;
}

export interface AiApplyResult {
  status: string;
  message: string;
}

export interface AiChatResult {
  reply: string;
  timestamp: string;
  engine?: string;
  model?: string;
}

export interface AiModelPreset {
  id: string;
  name: string;
  desc: string;
}

export interface AiModelsResult {
  status: string;
  current_model: string;
  popular_presets: AiModelPreset[];
  available_models: string[];
}

export interface AiConfigResult {
  status: string;
  message?: string;
  config: { model: string };
}

export interface RfChannelNeighbour {
  ssid: string;
  bssid: string;
  signal: number;
  freq: number;
  overlap: number;
}

export interface RfChannelInfo {
  channel: number;
  freq: number;
  aps: number;
  strong_aps: number;
  avg_signal: number | null;
  max_signal: number | null;
  noise_floor: number | null;
  effective_dbm: number;
  load: number;
  quality: number;
  grade: string;
  grade_key: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' | 'unmeasured';
  is_dfs?: boolean;
  non_overlapping?: boolean;
  measured?: boolean;
  usage_pct?: number | null;
  neighbours: RfChannelNeighbour[];
}

export interface RfBssEntry {
  bssid: string;
  ssid: string;
  freq: number;
  width: number;
  protocol: string;
  tx_power: number | null;
  signal: number;
  noise_floor: number;
  snr: number;
  is_internal?: boolean;
  internal_device_name?: string | null;
  internal_iface?: string | null;
  is_rogue?: boolean;
  rogue_reason?: string | null;
}

export interface RfScanResult {
  status: string;
  device_id: string;
  device_name: string;
  band: '2g' | '5g';
  interface: string;
  duration_s: number;
  scanned_at: string;
  total_bss_detected: number;
  rogue_count?: number;
  scan_mode?: string;
  freq_usage?: { freq: number; use_pct: number; noise_floor: number }[];
  rogues?: RfBssEntry[];
  current_channel: {
    channel: number;
    freq: number;
    width: string;
    ssid: string;
    interface: string;
  };
  current_channel_quality: number | null;
  current_channel_grade: string | null;
  best_channels: RfChannelInfo[];
  channels: RfChannelInfo[];
  bss_list: RfBssEntry[];
}

export interface AuthUser {
  username: string;
  name: string;
  role: string;
  email: string;
  login_time: string;
}

export interface LoginResult {
  status: string;
  token: string;
  user: AuthUser;
}

export interface FloorWall {
  id: string;
  name?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: 'lead_shield' | 'concrete' | 'brick' | 'drywall' | 'glass';
  loss_db: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  building: string;
  image_url: string;
  width_meters: number;
  height_meters: number;
  walls?: FloorWall[];
}

export interface ApPlacement {
  device_id: string;
  floor_id: string;
  x: number;
  y: number;
  tx_power_2g: number;
  channel_2g: number;
  tx_power_5g: number;
  channel_5g: number;
  radius_meters: number;
  device_name?: string;
  device_host?: string;
  device_model?: string;
  is_online?: boolean;
  clients_count?: number;
  has_5g?: boolean;
}

export interface ChannelConflict {
  type: 'co-channel-2.4' | 'co-channel-5';
  severity: 'high' | 'medium';
  device_a: { id: string; name: string };
  device_b: { id: string; name: string };
  band: string;
  channel: number;
  distance_m: number;
  reason: string;
}

export interface CrowdedAnalysis {
  status: string;
  floor_id: string;
  floor_name: string;
  total_placed_aps: number;
  conflicts_count: number;
  conflicts: ChannelConflict[];
  channel_distribution_2g: Record<string, number>;
  channel_distribution_5g: Record<string, number>;
  recommendations: string[];
}

export interface TelegramConfig {
  enabled: boolean;
  bot_token?: string;
  bot_token_masked?: string;
  has_token?: boolean;
  chat_id: string;
  notify_on_down: boolean;
  notify_on_recovery: boolean;
  notify_on_high_cpu: boolean;
  cpu_threshold_pct: number;
  notify_on_ethernet_downgrade: boolean;
  notify_on_rf_conflict: boolean;
  check_interval_sec: number;
}

export interface TelegramAlertRecord {
  id: string;
  timestamp: string;
  status: 'success' | 'failed';
  error?: string;
  text: string;
}

export interface OptimizeAndPushResult {
  status: string;
  floor_id: string;
  floor_name: string;
  total: number;
  success_count: number;
  results: Array<{
    device_id: string;
    device_name?: string;
    status: string;
    channel_2g?: number;
    channel_5g?: number;
    details?: string[];
    error?: string;
  }>;
  message: string;
}



