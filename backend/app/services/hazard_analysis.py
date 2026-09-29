"""
One-shot multi-hazard analysis for an uploaded video clip.

Unlike the live-monitoring pipeline's HazardEventManager (which dedups
confirmed events against each other by real GPS distance - suited to a bus
continuously driving past distinct real-world locations), this module tracks
detections purely in frame-space across a short, fully-available clip. Each
category (pothole, crosswalk, water clogging) gets its own ClipTracker reusing
the same IoU/centroid matching math as the live pipeline, so a single physical
object isn't counted once per frame it appears in. A long gap between
sightings starts a new track instead of reopening an old one.

Vehicles are reported as aggregate counts (average/peak per analyzed frame),
matching how the rest of this app already reports vehicle density elsewhere -
not identity-tracked across frames like the hazard categories, since moving
vehicles don't have the same "same object, same place" assumption a static
pothole/crosswalk/puddle does.

Performance: the crosswalk model's ONNX graph has a fixed 512x512 input and
costs ~190ms/frame on CPU - far more than the pothole (~90ms) or vehicle
(~30ms) detectors. Running it (and the water heuristic) on every sampled
frame would push a full ~60s clip to 2-3 minutes. Instead, crosswalk + water
checks are capped to a fixed frame BUDGET per clip regardless of duration,
spread evenly across the pothole/vehicle sampling pass.
"""

import base64
import logging
from typing import Any, Dict, List, Optional

import cv2

from app.edge_ai.hazard_event_manager import compute_box_iou, compute_centroid_distance
from app.edge_ai.road_hazard_detector import RoadHazardDetector
from app.edge_ai.crosswalk_detector import CrosswalkDetector
from app.edge_ai.water_detector import detect_water_clogging
from app.edge_ai.detector import EdgeDetector

logger = logging.getLogger(__name__)

MIN_DETECTION_CONFIDENCE = 0.5
MIN_HITS_TO_CONFIRM = 2
MAX_TRACK_GAP_SECONDS = 1.5
TARGET_SAMPLE_FPS = 10.0
MATCH_IOU_THRESHOLD = 0.15
MATCH_CENTROID_DISTANCE_PX = 120.0
THUMBNAIL_PAD_RATIO = 0.25
FALLBACK_ASSUMED_FPS = 25.0
HARD_FRAME_CAP_SECONDS = 70.0  # safety valve, kept above MAX_DURATION_SECONDS in hazard.py

# Crosswalk-specific tuning: validated (real photo + negative controls + real
# footage) at conf=0.25 with zero false positives, so it's trusted more than
# the shared 0.5 threshold used elsewhere. Real-world dashcam footage (angle,
# distance, partial occlusion) scores lower than a clean reference photo, so
# a single confirmed hit is trusted rather than requiring a second sparse
# sample to land on the same brief-in-view crossing.
CROSSWALK_MIN_CONFIDENCE = 0.25
CROSSWALK_MIN_HITS = 1

# A reflection fixed on the camera's own windshield glass stays essentially
# static in screen-space regardless of vehicle motion; a real road puddle
# should show noticeable drift/growth as the vehicle approaches it, even
# across sparse sampling. Tracks that barely move are treated as a likely
# glass/lens artifact rather than a real puddle. Only applied once a track
# has enough hits for the comparison to mean anything.
WATER_MIN_RELATIVE_MOVEMENT = 0.12
WATER_MOVEMENT_CHECK_MIN_HITS = 2

# Only the crosswalk model is genuinely expensive (~190ms/frame, fixed 512x512
# ONNX input), so it gets a bounded budget of checks spread across the clip
# rather than one per fine-sampled frame. The water heuristic is pure OpenCV
# (~5ms) and runs on every fine-sampled frame: it costs almost nothing, and the
# denser sampling gives its cross-frame movement filter far more to work with.
CROSSWALK_FRAME_BUDGET = 150

VEHICLE_CLASS_KEYS = ["car", "motorcycle", "bus", "truck"]


def _crop_thumbnail_base64(frame, bbox: List[float]) -> Optional[str]:
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    bw, bh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    pad_x, pad_y = bw * THUMBNAIL_PAD_RATIO, bh * THUMBNAIL_PAD_RATIO

    cx1 = max(0, int(x1 - pad_x))
    cy1 = max(0, int(y1 - pad_y))
    cx2 = min(w, int(x2 + pad_x))
    cy2 = min(h, int(y2 + pad_y))
    if cx2 <= cx1 or cy2 <= cy1:
        return None

    crop = frame[cy1:cy2, cx1:cx2]
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        return None
    return base64.b64encode(buf.tobytes()).decode("ascii")


class ClipObjectTrack:
    """A single physical object tracked across sampled frames of one clip."""

    def __init__(self, detection: Dict[str, Any], track_id: int, video_time: float, frame):
        self.track_id = track_id
        self.first_seen_time = video_time
        self.last_seen_time = video_time
        self.hits = 1
        self.first_bbox = detection["bbox"]
        self.latest_bbox = detection["bbox"]
        self.best_confidence = detection["confidence"]
        self.thumbnail_base64 = _crop_thumbnail_base64(frame, detection["bbox"])

    def update(self, detection: Dict[str, Any], video_time: float, frame) -> None:
        self.last_seen_time = video_time
        self.hits += 1
        self.latest_bbox = detection["bbox"]
        if detection["confidence"] > self.best_confidence:
            self.best_confidence = detection["confidence"]
            self.thumbnail_base64 = _crop_thumbnail_base64(frame, detection["bbox"])

    def relative_movement(self) -> float:
        """
        How much this track's box has drifted/grown between its first and
        latest sighting, normalized by its own size. Used to distinguish a
        real road-surface feature (which should drift/grow as the vehicle
        moves relative to it) from something fixed on the camera itself
        (which stays essentially static in screen-space).
        """
        fx1, fy1, fx2, fy2 = self.first_bbox
        lx1, ly1, lx2, ly2 = self.latest_bbox
        f_cx, f_cy = (fx1 + fx2) / 2, (fy1 + fy2) / 2
        l_cx, l_cy = (lx1 + lx2) / 2, (ly1 + ly2) / 2
        f_area = max(1.0, (fx2 - fx1) * (fy2 - fy1))
        l_area = max(1.0, (lx2 - lx1) * (ly2 - ly1))

        centroid_drift = ((l_cx - f_cx) ** 2 + (l_cy - f_cy) ** 2) ** 0.5
        size_scale = max(f_area, l_area) ** 0.5
        normalized_drift = centroid_drift / max(size_scale, 1.0)
        area_growth_ratio = abs(l_area - f_area) / f_area

        return max(normalized_drift, area_growth_ratio)


class ClipTracker:
    """Tracks one detection category across a clip via IoU/centroid matching."""

    def __init__(self, max_gap_seconds: float = MAX_TRACK_GAP_SECONDS):
        self.max_gap_seconds = max_gap_seconds
        self.active_tracks: List[ClipObjectTrack] = []
        self._next_track_id = 1

    def update(self, detections: List[Dict[str, Any]], video_time: float, frame) -> None:
        for det in detections:
            bbox = det["bbox"]
            matched: Optional[ClipObjectTrack] = None

            for track in self.active_tracks:
                if (video_time - track.last_seen_time) > self.max_gap_seconds:
                    continue
                iou = compute_box_iou(bbox, track.latest_bbox)
                c_dist = compute_centroid_distance(bbox, track.latest_bbox)
                if iou >= MATCH_IOU_THRESHOLD or c_dist <= MATCH_CENTROID_DISTANCE_PX:
                    matched = track
                    break

            if matched:
                matched.update(det, video_time, frame)
            else:
                self.active_tracks.append(ClipObjectTrack(det, self._next_track_id, video_time, frame))
                self._next_track_id += 1

    def confirmed(
        self,
        min_hits: int = MIN_HITS_TO_CONFIRM,
        min_movement: Optional[float] = None,
        movement_check_min_hits: int = 1,
    ) -> List[ClipObjectTrack]:
        tracks = [t for t in self.active_tracks if t.hits >= min_hits]
        if min_movement is not None:
            tracks = [
                t for t in tracks
                if t.hits < movement_check_min_hits or t.relative_movement() >= min_movement
            ]
        return sorted(tracks, key=lambda t: t.first_seen_time)


def _serialize_track(t: ClipObjectTrack) -> Dict[str, Any]:
    return {
        "track_id": t.track_id,
        "confidence": round(t.best_confidence, 4),
        "first_seen_seconds": round(t.first_seen_time, 2),
        "hits": t.hits,
        "thumbnail_base64": t.thumbnail_base64,
    }


def analyze_image(
    image_path: str,
    pothole_detector: RoadHazardDetector,
    crosswalk_detector: CrosswalkDetector,
    vehicle_detector: EdgeDetector,
) -> Dict[str, Any]:
    """
    Run the same detectors against a single still photo.

    Deliberately skips the tracker entirely. The video path confirms a
    detection by requiring repeat sightings (and, for water, cross-frame
    movement to rule out a reflection fixed on the camera's own glass). A
    single frame can satisfy neither, so applying those rules to a photo
    would report nothing at all. Each raw detection is therefore reported
    once, on its own confidence.
    """
    frame = cv2.imread(image_path)
    if frame is None:
        raise ValueError("Could not read the uploaded image. Is it a valid photo?")

    def _serialize(detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        items = []
        for idx, det in enumerate(detections, start=1):
            items.append({
                "track_id": idx,
                "confidence": round(float(det.get("confidence", 0.0)), 4),
                "first_seen_seconds": 0.0,
                "hits": 1,
                "thumbnail_base64": _crop_thumbnail_base64(frame, det["bbox"]),
            })
        return items

    try:
        pothole_dets = pothole_detector.detect(frame, conf_threshold=MIN_DETECTION_CONFIDENCE)
    except Exception as e:
        logger.error(f"Pothole detection failed on image: {e}")
        pothole_dets = []

    try:
        crosswalk_dets = crosswalk_detector.detect(frame, conf_threshold=CROSSWALK_MIN_CONFIDENCE)
    except Exception as e:
        logger.error(f"Crosswalk detection failed on image: {e}")
        crosswalk_dets = []

    try:
        water_dets = detect_water_clogging(frame)
    except Exception as e:
        logger.error(f"Water clogging heuristic failed on image: {e}")
        water_dets = []

    vehicle_counts = {k: 0 for k in VEHICLE_CLASS_KEYS}
    try:
        v_result = vehicle_detector.detect_frame(frame)
        counts = v_result.get("vehicle_counts", {})
        for k in VEHICLE_CLASS_KEYS:
            vehicle_counts[k] = counts.get(k, 0)
    except Exception as e:
        logger.error(f"Vehicle detection failed on image: {e}")

    return {
        "frames_analyzed": 1,
        "video_duration_seconds": 0.0,
        "pothole_count": len(pothole_dets),
        "potholes": _serialize(pothole_dets),
        "crosswalk_count": len(crosswalk_dets),
        "crosswalks": _serialize(crosswalk_dets),
        "water_clogging_count": len(water_dets),
        "water_clogging": _serialize(water_dets),
        "vehicles_avg_per_frame": {k: float(v) for k, v in vehicle_counts.items()},
        "vehicles_peak_in_frame": dict(vehicle_counts),
    }


def analyze_clip(
    video_path: str,
    pothole_detector: RoadHazardDetector,
    crosswalk_detector: CrosswalkDetector,
    vehicle_detector: EdgeDetector,
    max_duration_seconds: float,
) -> Dict[str, Any]:
    """
    Run multi-hazard detection across a short video clip: potholes, crosswalks,
    water clogging (all deduplicated across frames via tracking), plus
    aggregate vehicle density/classification. Raises ValueError for problems
    with the video itself (caller maps to a 422).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Could not open the uploaded video file. Is it a valid video?")

    try:
        source_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frame_count_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration_seconds = (frame_count_total / source_fps) if source_fps > 0 else 0.0

        if duration_seconds > max_duration_seconds:
            raise ValueError(
                f"Video is too long ({duration_seconds:.1f}s). "
                f"Please upload a clip under {int(max_duration_seconds)} seconds."
            )

        effective_fps = source_fps if source_fps > 0 else FALLBACK_ASSUMED_FPS
        stride = max(1, round(effective_fps / TARGET_SAMPLE_FPS))
        hard_frame_cap = int(effective_fps * HARD_FRAME_CAP_SECONDS)

        expected_fine_frames = max(1, (frame_count_total // stride) if frame_count_total > 0 else 1)
        crosswalk_relative_stride = max(1, round(expected_fine_frames / CROSSWALK_FRAME_BUDGET))

        pothole_tracker = ClipTracker()
        crosswalk_tracker = ClipTracker()
        water_tracker = ClipTracker()

        vehicle_totals = {k: 0 for k in VEHICLE_CLASS_KEYS}
        vehicle_peak = {k: 0 for k in VEHICLE_CLASS_KEYS}

        frames_analyzed = 0
        fine_frame_counter = 0
        frame_index = 0

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index > hard_frame_cap:
                logger.warning("Hazard clip analysis hit the hard frame cap; stopping early.")
                break

            if frame_index % stride == 0:
                video_time = frame_index / effective_fps
                frames_analyzed += 1

                try:
                    pothole_dets = pothole_detector.detect(frame, conf_threshold=MIN_DETECTION_CONFIDENCE)
                    pothole_tracker.update(pothole_dets, video_time, frame)
                except Exception as e:
                    logger.error(f"Pothole detection failed on a frame: {e}")

                try:
                    v_result = vehicle_detector.detect_frame(frame)
                    counts = v_result.get("vehicle_counts", {})
                    for k in VEHICLE_CLASS_KEYS:
                        c = counts.get(k, 0)
                        vehicle_totals[k] += c
                        vehicle_peak[k] = max(vehicle_peak[k], c)
                except Exception as e:
                    logger.error(f"Vehicle detection failed on a frame: {e}")

                if fine_frame_counter % crosswalk_relative_stride == 0:
                    try:
                        crosswalk_dets = crosswalk_detector.detect(frame, conf_threshold=CROSSWALK_MIN_CONFIDENCE)
                        crosswalk_tracker.update(crosswalk_dets, video_time, frame)
                    except Exception as e:
                        logger.error(f"Crosswalk detection failed on a frame: {e}")

                try:
                    water_dets = detect_water_clogging(frame)
                    water_tracker.update(water_dets, video_time, frame)
                except Exception as e:
                    logger.error(f"Water clogging heuristic failed on a frame: {e}")

                fine_frame_counter += 1

            frame_index += 1
    finally:
        cap.release()

    confirmed_potholes = pothole_tracker.confirmed()
    confirmed_crosswalks = crosswalk_tracker.confirmed(min_hits=CROSSWALK_MIN_HITS)
    confirmed_water = water_tracker.confirmed(
        min_movement=WATER_MIN_RELATIVE_MOVEMENT,
        movement_check_min_hits=WATER_MOVEMENT_CHECK_MIN_HITS,
    )

    vehicles_avg = {
        k: round(vehicle_totals[k] / frames_analyzed, 2) if frames_analyzed else 0.0
        for k in VEHICLE_CLASS_KEYS
    }

    return {
        "frames_analyzed": frames_analyzed,
        "video_duration_seconds": round(duration_seconds, 2),
        "pothole_count": len(confirmed_potholes),
        "potholes": [_serialize_track(t) for t in confirmed_potholes],
        "crosswalk_count": len(confirmed_crosswalks),
        "crosswalks": [_serialize_track(t) for t in confirmed_crosswalks],
        "water_clogging_count": len(confirmed_water),
        "water_clogging": [_serialize_track(t) for t in confirmed_water],
        "vehicles_avg_per_frame": vehicles_avg,
        "vehicles_peak_in_frame": vehicle_peak,
    }
