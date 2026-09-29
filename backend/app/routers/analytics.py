import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import Bus, UrbanEvent, TrafficObservation
from app.schemas import (
    TrafficObservationCreate,
    TrafficObservationResponse,
    DashboardStats,
    BusResponse,
    UrbanEventResponse,
    DashboardTrends,
    DailyCount,
    HourlyCount,
    TrafficTrendPoint,
    PeriodBreakdown,
)

# Road-defect types counted as "potholes" for the dashboard breakdown.
POTHOLE_TYPES = ("POTHOLE", "ROAD_DAMAGE")
from app.config import settings

router = APIRouter(tags=["Analytics & Dashboard"])

def determine_traffic_level(vehicle_count: int) -> str:
    """Classify traffic density based on total detected vehicle count."""
    if vehicle_count >= 50:
        return "CONGESTED"
    elif vehicle_count >= 30:
        return "HEAVY"
    elif vehicle_count >= 15:
        return "MODERATE"
    else:
        return "LOW"

@router.get("/api/traffic/current", response_model=Optional[TrafficObservationResponse])
def get_current_traffic(db: Session = Depends(get_db)):
    """
    Return the latest stored traffic observation.
    Returns null if no observation has been recorded yet.
    """
    latest_traffic = db.query(TrafficObservation).order_by(TrafficObservation.timestamp.desc()).first()
    return latest_traffic

@router.post("/api/traffic", response_model=TrafficObservationResponse, status_code=status.HTTP_201_CREATED)
def create_traffic_observation(
    traffic_in: TrafficObservationCreate,
    db: Session = Depends(get_db)
):
    """
    Store a real traffic observation recorded by Edge AI.
    """
    bus_code = traffic_in.bus_code or settings.ACTIVE_BUS_CODE
    bus = db.query(Bus).filter(Bus.bus_code == bus_code).first()
    if not bus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bus '{bus_code}' not found."
        )

    # Compute total vehicle count if sub-counts provided
    total_vehicles = traffic_in.vehicle_count
    sub_sum = traffic_in.car_count + traffic_in.motorcycle_count + traffic_in.bus_count + traffic_in.truck_count
    if total_vehicles == 0 and sub_sum > 0:
        total_vehicles = sub_sum

    traffic_level = traffic_in.traffic_level or determine_traffic_level(total_vehicles)

    new_traffic = TrafficObservation(
        vehicle_count=total_vehicles,
        car_count=traffic_in.car_count,
        motorcycle_count=traffic_in.motorcycle_count,
        bus_count=traffic_in.bus_count,
        truck_count=traffic_in.truck_count,
        traffic_level=traffic_level,
        latitude=traffic_in.latitude,
        longitude=traffic_in.longitude,
        timestamp=traffic_in.timestamp or datetime.datetime.now(datetime.timezone.utc),
        bus_id=bus.id,
        source=traffic_in.source or "AI_DETECTION",
        is_demo_data=traffic_in.is_demo_data if traffic_in.is_demo_data is not None else False
    )


    db.add(new_traffic)
    db.commit()
    db.refresh(new_traffic)
    return new_traffic

@router.get("/api/dashboard/trends", response_model=DashboardTrends)
def get_dashboard_trends(days: int = 7, db: Session = Depends(get_db)):
    """
    Real time-series aggregations for the dashboard charts, computed from the
    database. Every bucket in the returned range is present (zero-filled) so
    the frontend renders an honest timeline rather than only the days that
    happen to have data.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    since = now - datetime.timedelta(days=days - 1)
    since_midnight = since.replace(hour=0, minute=0, second=0, microsecond=0)

    # Events per day (zero-filled across the whole window)
    day_rows = (
        db.query(func.strftime("%Y-%m-%d", UrbanEvent.timestamp), func.count(UrbanEvent.id))
        .filter(UrbanEvent.timestamp >= since_midnight)
        .group_by(func.strftime("%Y-%m-%d", UrbanEvent.timestamp))
        .all()
    )
    day_map = {row[0]: row[1] for row in day_rows if row[0]}
    events_per_day = []
    for i in range(days):
        d = (since_midnight + datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        events_per_day.append(DailyCount(date=d, count=day_map.get(d, 0)))

    # Events by hour of day (all 24 buckets present)
    hour_rows = (
        db.query(func.strftime("%H", UrbanEvent.timestamp), func.count(UrbanEvent.id))
        .group_by(func.strftime("%H", UrbanEvent.timestamp))
        .all()
    )
    hour_map = {int(row[0]): row[1] for row in hour_rows if row[0] is not None}
    events_by_hour = [HourlyCount(hour=h, count=hour_map.get(h, 0)) for h in range(24)]

    # Traffic trend: average vehicles per minute, most recent 60 buckets
    minute_bucket = func.strftime("%Y-%m-%d %H:%M", TrafficObservation.timestamp)
    traffic_rows = (
        db.query(
            minute_bucket,
            func.avg(TrafficObservation.vehicle_count),
            func.count(TrafficObservation.id),
        )
        .group_by(minute_bucket)
        .order_by(minute_bucket.desc())
        .limit(60)
        .all()
    )
    traffic_trend = [
        TrafficTrendPoint(bucket=r[0], avg_vehicles=round(float(r[1] or 0.0), 2), observations=int(r[2]))
        for r in reversed(traffic_rows)
    ]

    type_rows = db.query(UrbanEvent.event_type, func.count(UrbanEvent.id)).group_by(UrbanEvent.event_type).all()
    events_by_type = {row[0]: row[1] for row in type_rows if row[0]}
    total_events = db.query(UrbanEvent).count()

    # Pothole counts per rolling window, alongside the rest of the events in
    # that same window so the dashboard can show it as a proportion.
    pothole_periods = []
    for label, window_days in (("Day", 1), ("Week", 7), ("Month", 30)):
        window_start = now - datetime.timedelta(days=window_days)
        in_window = db.query(UrbanEvent).filter(UrbanEvent.timestamp >= window_start)
        total_in_window = in_window.count()
        potholes_in_window = in_window.filter(UrbanEvent.event_type.in_(POTHOLE_TYPES)).count()
        pothole_periods.append(PeriodBreakdown(
            label=label,
            potholes=potholes_in_window,
            other_events=max(0, total_in_window - potholes_in_window),
            total=total_in_window,
        ))

    return DashboardTrends(
        events_per_day=events_per_day,
        events_by_hour=events_by_hour,
        traffic_trend=traffic_trend,
        events_by_type=events_by_type,
        pothole_periods=pothole_periods,
        total_events=total_events,
        has_data=total_events > 0,
    )


@router.get("/api/dashboard", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """
    Calculate and return dashboard statistics FROM THE DATABASE.
    No hardcoded numbers: all counts, aggregates, and feeds reflect active database state.
    """
    bus = db.query(Bus).filter(Bus.bus_code == settings.ACTIVE_BUS_CODE).first()
    if not bus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bus '{settings.ACTIVE_BUS_CODE}' not found. Please ensure database is seeded."
        )

    # Event metrics directly queried from SQLite
    total_events = db.query(UrbanEvent).count()
    active_issues = db.query(UrbanEvent).filter(UrbanEvent.status == "ACTIVE").count()
    resolved_issues = db.query(UrbanEvent).filter(UrbanEvent.status == "RESOLVED").count()
    investigating_issues = db.query(UrbanEvent).filter(UrbanEvent.status == "INVESTIGATING").count()

    # Provenance metrics
    ai_detection_count = db.query(UrbanEvent).filter(UrbanEvent.is_demo_data == False).count()
    demo_data_count = db.query(UrbanEvent).filter(UrbanEvent.is_demo_data == True).count()

    # Priority aggregation
    priority_rows = db.query(UrbanEvent.priority, func.count(UrbanEvent.id)).group_by(UrbanEvent.priority).all()
    issues_by_priority = {row[0]: row[1] for row in priority_rows if row[0]}

    # Type aggregation
    type_rows = db.query(UrbanEvent.event_type, func.count(UrbanEvent.id)).group_by(UrbanEvent.event_type).all()
    issues_by_type = {row[0]: row[1] for row in type_rows if row[0]}

    # Current traffic
    current_traffic = db.query(TrafficObservation).order_by(TrafficObservation.timestamp.desc()).first()

    # Recent 6 events
    recent_events = db.query(UrbanEvent).order_by(UrbanEvent.timestamp.desc()).limit(6).all()

    return DashboardStats(
        bus=BusResponse.model_validate(bus),
        total_events=total_events,
        active_issues=active_issues,
        resolved_issues=resolved_issues,
        investigating_issues=investigating_issues,
        ai_detection_count=ai_detection_count,
        demo_data_count=demo_data_count,
        current_traffic=TrafficObservationResponse.model_validate(current_traffic) if current_traffic else None,
        recent_events=[UrbanEventResponse.model_validate(e) for e in recent_events],
        issues_by_priority=issues_by_priority,
        issues_by_type=issues_by_type
    )
