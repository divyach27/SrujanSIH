// ==========================================
// BUS-CV Frontend Type Definitions
// All types mirror the backend Pydantic schemas.
// ==========================================

export interface Bus {
  id: number;
  bus_code: string;
  status: string;
  latitude: number;
  longitude: number;
  speed: number;
  edge_ai_status: string;
  camera_status: string;
  gps_status: string;
  last_updated: string;
}

// Data provenance: source identifies where the event came from.
// is_demo_data=true means it was seeded for testing; never display as live AI detection.
export type EventSource = 'SEED' | 'AI_DETECTION' | 'MANUAL_TEST';
export type EventStatus = 'ACTIVE' | 'RESOLVED' | 'INVESTIGATING' | 'ASSIGNED';
export type EventPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TrafficLevel = 'LOW' | 'MODERATE' | 'HEAVY' | 'CONGESTED';

export interface UrbanEvent {
  id: number;
  event_type: string;
  confidence: number;
  latitude: number;
  longitude: number;
  timestamp: string;
  status: EventStatus;
  priority: EventPriority;
  bus_id: number;
  evidence_path: string | null;
  source: EventSource;
  is_demo_data: boolean;
}

export interface TrafficObservation {
  id: number;
  vehicle_count: number;
  car_count: number;
  motorcycle_count: number;
  bus_count: number;
  truck_count: number;
  traffic_level: TrafficLevel;
  latitude: number;
  longitude: number;
  timestamp: string;
  bus_id: number;
  source: EventSource;
  is_demo_data: boolean;
}

export interface DashboardStats {
  bus: Bus;
  total_events: number;
  active_issues: number;
  resolved_issues: number;
  investigating_issues: number;
  ai_detection_count: number;
  demo_data_count: number;
  current_traffic: TrafficObservation | null;
  recent_events: UrbanEvent[];
  issues_by_priority: Record<string, number>;
  issues_by_type: Record<string, number>;
}

export interface MonitoringStatus {
  is_active: boolean;
  bus_code: string;
  camera_status: string;
  edge_ai_status: string;
  gps_status: string;
  started_at: string | null;
  uptime_seconds: number | null;
  fps: number;
  video_source: string | null;
  video_validation?: {
    path?: string | null;
    exists?: boolean;
    valid?: boolean;
    error?: string | null;
    resolution?: string;
    width?: number;
    height?: number;
    fps?: number;
    frames?: number;
    duration_sec?: number;
    source_type?: string;
    source_label?: string;
  } | null;
  message: string;
  live_counts?: {
    car: number;
    motorcycle: number;
    bus: number;
    truck: number;
    total: number;
  };
  live_gps?: {
    latitude: number;
    longitude: number;
    speed: number;
  };
  latest_error?: string | null;
  // Road Hazard Telemetry (Phase 3B)
  hazard_model_status?: string;
  hazard_model_name?: string;
  latest_hazard_detections?: Array<{
    event_type: string;
    confidence: number;
    bbox: number[];
    area_ratio?: number;
    timestamp: string;
    source: string;
  }>;
  confirmed_hazard_count?: number;
  last_hazard?: {
    id?: number;
    event_type: string;
    confidence: number;
    latitude: number;
    longitude: number;
    priority: string;
    timestamp: string;
    source: string;
  } | null;
  hazard_fps?: number;
  latest_hazard_error?: string | null;
  // Performance & Hardware Telemetry (Phase 3C)
  device_name?: string;
  processing_resolution?: string;
  vehicle_fps?: number;
}


export interface MonitoringActionResponse {
  success: boolean;
  message: string;
  status: MonitoringStatus;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  database: string;
  bus_system: string;
  active_bus: string;
}

export interface BusRoute {
  route: Array<{ lat: number; lon: number }>;
  label: string;
  gps_mode: string;
  is_simulated_gps: boolean;
  point_count: number;
}

export interface DetectionItem {
  track_id: number;
  confidence: number;
  first_seen_seconds: number;
  hits: number;
  thumbnail_base64: string | null;
}

export interface VehicleBreakdown {
  car: number;
  motorcycle: number;
  bus: number;
  truck: number;
}

export interface ContractorNoticeInput {
  contractor_name: string;
  phone: string;
  email: string;
  warranty_remaining?: string;
  notes?: string;
}

export interface ContractorNotice {
  id: number;
  event_id: number;
  contractor_name: string;
  phone: string;
  email: string;
  warranty_remaining: string | null;
  notes: string | null;
  delivery_status: string;
  sent_at: string;
}

export interface ContractorNoticeResult {
  notice: ContractorNotice;
  event: UrbanEvent;
  message: string;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface HourlyCount {
  hour: number;
  count: number;
}

export interface TrafficTrendPoint {
  bucket: string;
  avg_vehicles: number;
  observations: number;
}

export interface PeriodBreakdown {
  label: string;
  potholes: number;
  other_events: number;
  total: number;
}

export interface DashboardTrends {
  events_per_day: DailyCount[];
  events_by_hour: HourlyCount[];
  traffic_trend: TrafficTrendPoint[];
  events_by_type: Record<string, number>;
  pothole_periods: PeriodBreakdown[];
  total_events: number;
  has_data: boolean;
}

export interface HazardAnalysisResponse {
  frames_analyzed: number;
  video_duration_seconds: number;
  pothole_model_loaded: boolean;
  message: string | null;
  events_saved: number;

  pothole_count: number;
  potholes: DetectionItem[];

  crosswalk_count: number;
  crosswalks: DetectionItem[];

  water_clogging_count: number;
  water_clogging: DetectionItem[];

  vehicles_avg_per_frame: VehicleBreakdown;
  vehicles_peak_in_frame: VehicleBreakdown;
}
