import os
import datetime
import tempfile
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bus, UrbanEvent
from app.config import settings
from app.edge_ai.road_hazard_detector import RoadHazardDetector
from app.edge_ai.crosswalk_detector import CrosswalkDetector
from app.edge_ai.detector import EdgeDetector
from app.services.hazard_analysis import analyze_clip, analyze_image
from app.services.event_processor import event_processor
from app.schemas import HazardAnalysisResponse, VehicleBreakdown

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hazard", tags=["Hazard Analysis"])

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100MB
MAX_DURATION_SECONDS = 65.0  # ~1 minute, with slack

# Shared detector instances, lazily loaded once and reused across requests
# (loading YOLO weights per-request would be far too slow). Separate from the
# EdgeDetector instance used by the live-monitoring pipeline - kept isolated
# so this endpoint can't interfere with that pipeline's state.
_pothole_detector = RoadHazardDetector()
_crosswalk_detector = CrosswalkDetector()
_vehicle_detector = EdgeDetector()

_EMPTY_BREAKDOWN = VehicleBreakdown(car=0, motorcycle=0, bus=0, truck=0)

# Only genuine road defects become tracked issues. A detected crosswalk is
# infrastructure that is PRESENT, not a defect, so it stays informational in
# the analysis result rather than polluting the Issues list and GIS map.
PERSISTED_EVENT_TYPES = {
    "potholes": "POTHOLE",
    "water_clogging": "WATERLOGGING",
}


def _persist_detections(db: Session, result: dict, latitude: float, longitude: float) -> int:
    """
    Store confirmed hazard detections as real UrbanEvents so the dashboard,
    map and issues list reflect what the analysis found.

    Deliberately bypasses EventProcessor's GPS proximity/cooldown dedup: every
    detection from one clip shares the same device location, so that check
    would collapse all of them into a single event. The clip's own frame-space
    tracker is the correct dedup here and has already run.
    """
    bus = db.query(Bus).filter(Bus.bus_code == settings.ACTIVE_BUS_CODE).first()
    if not bus:
        logger.warning("Cannot persist detections: active bus not found.")
        return 0

    saved = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    for result_key, event_type in PERSISTED_EVENT_TYPES.items():
        for item in result.get(result_key, []):
            confidence = float(item.get("confidence", 0.0))
            db.add(UrbanEvent(
                event_type=event_type,
                confidence=round(confidence, 4),
                latitude=latitude,
                longitude=longitude,
                timestamp=now,
                status="ACTIVE",
                priority=event_processor.calculate_priority(event_type, confidence),
                bus_id=bus.id,
                source="AI_DETECTION",
                is_demo_data=False,
            ))
            saved += 1

    if saved:
        db.commit()
    return saved


@router.post("/analyze", response_model=HazardAnalysisResponse)
async def analyze_hazard_clip(
    file: UploadFile = File(...),
    latitude: Optional[float] = Form(default=None),
    longitude: Optional[float] = Form(default=None),
    db: Session = Depends(get_db),
):
    """
    Upload a short (<=65s) road video clip and get back potholes, crosswalks,
    water clogging (each deduplicated across frames), and vehicle density -
    all detected from the clip itself, no live GPS/telemetry involved.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type '{ext or 'unknown'}'. "
                   f"Upload a video file ({', '.join(sorted(ALLOWED_EXTENSIONS))}).",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Uploaded file is empty.")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File too large ({len(contents) / (1024 * 1024):.1f}MB). "
                   f"Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
        )

    if not _pothole_detector.is_initialized:
        _pothole_detector.load_model()

    if not _pothole_detector.is_initialized:
        return HazardAnalysisResponse(
            frames_analyzed=0,
            video_duration_seconds=0.0,
            pothole_model_loaded=False,
            message="The road hazard detection model is unavailable on the server right now.",
            vehicles_avg_per_frame=_EMPTY_BREAKDOWN,
            vehicles_peak_in_frame=_EMPTY_BREAKDOWN,
        )

    # Crosswalk detection is a bonus layer on top of the required pothole
    # model: if it fails to load, degrade gracefully rather than blocking
    # the whole analysis.
    if not _crosswalk_detector.is_initialized:
        _crosswalk_detector.load_model()

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        if ext in IMAGE_EXTENSIONS:
            result = analyze_image(
                tmp_path,
                pothole_detector=_pothole_detector,
                crosswalk_detector=_crosswalk_detector,
                vehicle_detector=_vehicle_detector,
            )
        else:
            result = analyze_clip(
                tmp_path,
                pothole_detector=_pothole_detector,
                crosswalk_detector=_crosswalk_detector,
                vehicle_detector=_vehicle_detector,
                max_duration_seconds=MAX_DURATION_SECONDS,
            )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        logger.error(f"Hazard clip analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to analyze video.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    events_saved = 0
    if latitude is not None and longitude is not None:
        try:
            events_saved = _persist_detections(db, result, latitude, longitude)
        except Exception as e:
            # Persistence is a side effect - never fail the analysis over it.
            logger.error(f"Failed to persist hazard detections: {e}", exc_info=True)
            db.rollback()

    return HazardAnalysisResponse(
        pothole_model_loaded=True,
        message=None,
        events_saved=events_saved,
        **result,
    )
