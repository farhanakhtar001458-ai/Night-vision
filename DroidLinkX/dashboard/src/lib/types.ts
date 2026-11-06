export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export type Tokens = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
};

export type Device = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  sdkInt: number | null;
  appVersion: string | null;
  platform: string;
  status: string;
  trusted: boolean;
  online: boolean;
  connectionQuality: string;
  lastSeenAt: string | null;
  createdAt: string;
  telemetry: DeviceTelemetry;
  permissions: Record<string, boolean>;
};

export type DeviceTelemetry = {
  battery?: number;
  charging?: boolean;
  network?: string;
  ip?: string;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  ramUsedBytes?: number;
  ramTotalBytes?: number;
  cpu?: string;
  screenResolution?: string;
  uptimeSeconds?: number;
  batteryTemperatureC?: number;
  latencyMs?: number;
  [key: string]: unknown;
};

export type RelayFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  category: string;
  sha256: string | null;
  deviceId: string | null;
  direction: string;
  createdAt: string;
  expiresAt: string | null;
  downloadUrl: string;
};

export type StorageSummary = {
  totalBytes: number;
  fileCount: number;
  byCategory: Record<string, number>;
};

export type TransferItem = {
  id: string;
  index: number;
  name: string;
  path: string;
  size: number;
  sha256: string | null;
  status: string;
  bytesReceived: number;
  receivedChunks: number;
  checksumVerified: boolean;
  fileId: string | null;
  error: string | null;
};

export type Transfer = {
  id: string;
  direction: string;
  mode: string;
  status: string;
  sourceDeviceId: string | null;
  targetDeviceId: string | null;
  totalBytes: number;
  transferredBytes: number;
  percent: number;
  itemCount: number;
  completedItems: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  chunkSize: number;
  items: TransferItem[];
  receivedChunkIndexes?: Array<{ item_index: number; chunk_index: number }>;
};

export type ActivityEntry = {
  id: string;
  action: string;
  actorType: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  createdAt: string;
};

export type NotificationRecord = {
  id: string;
  deviceId: string;
  deviceName: string;
  packageName: string;
  appName: string;
  title: string | null;
  content: string | null;
  category: string | null;
  postedAt: string;
};

export type ClipboardEntry = {
  id: string;
  direction: string;
  contentType: string;
  content: string;
  sensitive: boolean;
  createdAt: string;
  expiresAt: string | null;
};

export type DeviceSession = {
  id: string;
  deviceId: string;
  deviceName: string;
  state: string;
  online: boolean;
  ip: string | null;
  userAgent: string | null;
  startedAt: string;
  lastHeartbeatAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
};

export type BrowserSession = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  rotated: boolean;
  ip: string | null;
  userAgent: string | null;
};

export type Connection = {
  id: string;
  sourceDeviceId: string;
  targetDeviceId: string | null;
  type: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  expiresAt: string;
  turn?: {
    urls: string[];
    username: string;
    credential: string;
    ttl: number;
  } | null;
};

export type ServerConfig = {
  turnConfigured: boolean;
  stunUrls: string[];
  turnUrls: string[];
};

export type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};
