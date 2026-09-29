from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator

# ==========================================
# BUS SCHEMAS
# ==========================================

class BusBase(BaseModel):
    bus_code: str = Field(..., example="BUS_01")
    status: str = Field(default="ACTIVE")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed: float = Field(default=0.0, ge=0.0)
    edge_ai_status: str = Field(default="STANDBY")
    camera_status: str = Field(default="DISCONNECTED")
    gps_status: str = Field(default="LOCKED")

class BusResponse(BusBase):
    id: int
    last_updated: datetime

    class Config:
        from_attributes = True

class BusLocationUpdate(BaseModel):
    bus_code: str = Field(default="BUS_01")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed: float = Field(default=0.0, ge=0.0)

class BusLocationResponse(BaseModel):
    bus_code: str
    latitude: float
    longitude: float
    speed: float
    status: str
    gps_status: str
    last_updated: datetime

    class Config:
        from_attributes = True

# ==========================================
# URBAN EVENT SCHEMAS
# ==========================================

class UrbanEventCreate(BaseModel):
    event_type: str = Field(..., min_length=2, example="POTHOLE")
    confidence: float = Field(..., ge=0.0, le=1.0)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    bus_code: Optional[str] = Field(default="BUS_01")
    evidence_path: Optional[str] = None
    source: Optional[str] = Field(default="AI_DETECTION")
    is_demo_data: Optional[bool] = Field(default=False)
    timestamp: Optional[datetime] = None

class UrbanEventResponse(BaseModel):
    id: int
    event_type: str
    confidence: float
    latitude: float
    longitude: float
    timestamp: datetime
    status: str
    priority: str
    bus_id: int
    evidence_path: Optional[str] = None
    source: str
    is_demo_data: bool

    class Config:
        from_attributes = True

class EventStatusUpdate(BaseModel):
    status: str = Field(..., description="ACTIVE, INVESTIGATING, ASSIGNED or RESOLVED")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"ACTIVE", "INVESTIGATING", "ASSIGNED", "RESOLVED"}
        normalized = v.strip().upper()
        if normalized not in allowed:
            raise ValueError(f"status must be one of {sorted(allowed)}")
        return normalized

# ==========================================
# CONTRACTOR NOTICE SCHEMAS
# ==========================================

class ContractorNoticeCreate(BaseModel):
    contractor_name: str = Field(..., min_length=1, max_length=150)
    phone: str = Field(..., min_length=1, max_length=50)
    email: str = Field(..., min_length=3, max_length=150)
    warranty_remaining: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)

class ContractorNoticeResponse(BaseModel):
    id: int
    event_id: int
    contractor_name: str
    phone: str
    email: str
    warranty_remaining: Optional[str] = None
    notes: Optional[str] = None
    delivery_status: str
    sent_at: datetime

    class Config:
        from_attributes = True

class ContractorNoticeResult(BaseModel):
    notice: ContractorNoticeResponse
    event: UrbanEventResponse
    message: str

# ==========================================
# TRAFFIC OBSERVATION SCHEMAS
# ==========================================

class TrafficObservationCreate(BaseModel):
    vehicle_count: int = Field(default=0, ge=0)
    car_count: int = Field(default=0, ge=0)
    motorcycle_count: int = Field(default=0, ge=0)
    bus_count: int = Field(default=0, ge=0)
    truck_count: int = Field(default=0, ge=0)
    traffic_level: Optional[str] = Field(default=None)  # Auto-calculated if None
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    bus_code: Optional[str] = Field(default="BUS_01")
    source: Optional[str] = Field(default="AI_DETECTION")
    is_demo_data: Optional[bool] = Field(default=False)
    timestamp: Optional[datetime] = None

class TrafficObservationResponse(BaseModel):
    id: int
    vehicle_count: int
    car_count: int
    motorcycle_count: int
    bus_count: int
    truck_count: int
    traffic_level: str
    latitude: float
    longitude: float
    timestamp: datetime
    bus_id: int
    source: str
    is_demo_data: bool

    class Config:
        from_attributes = True

# ==========================================
# DASHBOARD STATS SCHEMAS
# ==========================================

class DashboardStats(BaseModel):
    bus: BusResponse
    total_events: int
    active_issues: int
    resolved_issues: int
    investigating_issues: int
    ai_detection_count: int
    demo_data_count: int
    current_traffic: Optional[TrafficObservationResponse] = None
    recent_events: List[UrbanEventResponse] = []
    issues_by_priority: Dict[str, int]
    issues_by_type: Dict[str, int]

# ==========================================
# MONITORING SCHEMAS
# ==========================================

class MonitoringStatusResponse(BaseModel):
    is_active: bool
    bus_code: str
    camera_status: str
    edge_ai_status: str
    gps_status: str
    started_at: Optional[datetime] = None
    uptime_seconds: Optional[int] = None
    fps: float = 0.0
    video_source: Optional[str] = None
    video_validation: Optional[Dict[str, Any]] = None
    message: str
    live_counts: Optional[Dict[str, int]] = None
    live_gps: Optional[Dict[str, Any]] = None
    latest_error: Optional[str] = None
    # Phase 3B Road Hazard Telemetry
    hazard_model_status: Optional[str] = "STANDBY"
    hazard_model_name: Optional[str] = "Pothole YOLOv8s (peterhdd)"
    latest_hazard_detections: Optional[List[Dict[str, Any]]] = None
    confirmed_hazard_count: Optional[int] = 0
    last_hazard: Optional[Dict[str, Any]] = None
    hazard_fps: Optional[float] = 0.0
    latest_hazard_error: Optional[str] = None
    # Phase 3C Hardware & Performance Telemetry
    device_name: Optional[str] = "CPU"
    processing_resolution: Optional[str] = "1280x720 @ AI 480"
    vehicle_fps: Optional[float] = 0.0


class MonitoringActionResponse(BaseModel):
    success: bool
    message: str
    status: MonitoringStatusResponse

# ==========================================
# HAZARD CLIP ANALYSIS SCHEMAS
# ==========================================

class DetectionItem(BaseModel):
    track_id: int
    confidence: float
    first_seen_seconds: float
    hits: int
    thumbnail_base64: Optional[str] = None

class VehicleBreakdown(BaseModel):
    car: float
    motorcycle: float
    bus: float
    truck: float

class HazardAnalysisResponse(BaseModel):
    frames_analyzed: int
    video_duration_seconds: float
    pothole_model_loaded: bool
    message: Optional[str] = None
    events_saved: int = 0

    pothole_count: int = 0
    potholes: List[DetectionItem] = []

    crosswalk_count: int = 0
    crosswalks: List[DetectionItem] = []

    water_clogging_count: int = 0
    water_clogging: List[DetectionItem] = []

    vehicles_avg_per_frame: VehicleBreakdown = VehicleBreakdown(car=0, motorcycle=0, bus=0, truck=0)
    vehicles_peak_in_frame: VehicleBreakdown = VehicleBreakdown(car=0, motorcycle=0, bus=0, truck=0)

# ==========================================
# DASHBOARD TIME-SERIES SCHEMAS
# ==========================================

class DailyCount(BaseModel):
    date: str          # YYYY-MM-DD
    count: int

class HourlyCount(BaseModel):
    hour: int          # 0-23
    count: int

class TrafficTrendPoint(BaseModel):
    bucket: str        # YYYY-MM-DD HH:MM
    avg_vehicles: float
    observations: int

class PeriodBreakdown(BaseModel):
    """Counts for one time window: the focus type vs everything else."""
    label: str          # "Day" | "Week" | "Month"
    potholes: int = 0
    other_events: int = 0
    total: int = 0

class DashboardTrends(BaseModel):
    events_per_day: List[DailyCount] = []
    events_by_hour: List[HourlyCount] = []
    traffic_trend: List[TrafficTrendPoint] = []
    events_by_type: Dict[str, int] = {}
    pothole_periods: List[PeriodBreakdown] = []
    total_events: int = 0
    has_data: bool = False

# ==========================================
# HEALTH SCHEMA
# ==========================================

class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    database: str
    bus_system: str
    active_bus: str
