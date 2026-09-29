import type {
  Bus,
  DashboardStats,
  UrbanEvent,
  TrafficObservation,
  MonitoringStatus,
  MonitoringActionResponse,
  HealthResponse,
  BusRoute,
  HazardAnalysisResponse,
  DashboardTrends,
  EventStatus,
  ContractorNoticeInput,
  ContractorNoticeResult,
} from '../types';

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:8000';
const BASE_URL = API_BASE_URL;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch { /* empty */ }
    throw new ApiError(detail, res.status);
  }

  // Handle 204 No Content or similar
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

// ==========================================
// HEALTH
// ==========================================
export const getHealth = (): Promise<HealthResponse> =>
  apiFetch('/health');

// ==========================================
// BUS
// ==========================================
export const getBusStatus = (): Promise<Bus> =>
  apiFetch('/api/bus/status');

export const getBusLocation = (): Promise<Bus> =>
  apiFetch('/api/bus/location');

export const getBusRoute = (): Promise<BusRoute> =>
  apiFetch('/api/bus/route');

// ==========================================
// DASHBOARD
// ==========================================
export const getDashboard = (): Promise<DashboardStats> =>
  apiFetch('/api/dashboard');

export const getDashboardTrends = (days = 7): Promise<DashboardTrends> =>
  apiFetch(`/api/dashboard/trends?days=${days}`);

// ==========================================
// URBAN EVENTS
// ==========================================
export const getEvents = (statusFilter?: string, sourceFilter?: string): Promise<UrbanEvent[]> => {
  const params = new URLSearchParams();
  if (statusFilter && statusFilter !== 'ALL') params.append('status', statusFilter);
  if (sourceFilter && sourceFilter !== 'ALL') params.append('source', sourceFilter);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/api/events${qs}`);
};

export const getEvent = (id: number): Promise<UrbanEvent> =>
  apiFetch(`/api/events/${id}`);

export const resolveEvent = (id: number): Promise<UrbanEvent> =>
  apiFetch(`/api/events/${id}/resolve`, { method: 'PATCH' });

export const updateEventStatus = (id: number, status: EventStatus): Promise<UrbanEvent> =>
  apiFetch(`/api/events/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const sendContractorNotice = (
  id: number,
  payload: ContractorNoticeInput,
): Promise<ContractorNoticeResult> =>
  apiFetch(`/api/events/${id}/contractor-notice`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ==========================================
// TRAFFIC
// ==========================================
export const getCurrentTraffic = (): Promise<TrafficObservation | null> =>
  apiFetch('/api/traffic/current');

// ==========================================
// MONITORING
// ==========================================
export const getMonitoringStatus = (): Promise<MonitoringStatus> =>
  apiFetch('/api/monitoring/status');

export const startMonitoring = (): Promise<MonitoringActionResponse> =>
  apiFetch('/api/monitoring/start', { method: 'POST' });

export const stopMonitoring = (): Promise<MonitoringActionResponse> =>
  apiFetch('/api/monitoring/stop', { method: 'POST' });

// ==========================================
// HAZARD ANALYSIS
// ==========================================
export const analyzeHazardClip = async (
  file: File,
  location?: { latitude: number; longitude: number } | null,
): Promise<HazardAnalysisResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  // Sent so confirmed hazards can be stored as real, located events; without
  // it the analysis still runs, it just isn't persisted to the dashboard.
  if (location) {
    formData.append('latitude', String(location.latitude));
    formData.append('longitude', String(location.longitude));
  }

  // Not routed through apiFetch: that helper forces a JSON Content-Type header,
  // which would break the multipart boundary the browser needs to set itself
  // for a FormData body.
  const res = await fetch(`${BASE_URL}/api/hazard/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch { /* empty */ }
    throw new ApiError(detail, res.status);
  }

  return res.json();
};

export { ApiError };
