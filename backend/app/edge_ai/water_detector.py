"""
Edge AI - Water Clogging (Standing Water) Heuristic Detector

Classical computer-vision heuristic, not a trained model: no pretrained model
for this task was found that was both freely downloadable and safe to load
(the only candidate found was an unverified individual's pickled PyTorch
weights - a real arbitrary-code-execution risk on load - and was rejected).

Core signal: road-surface regions that are anomalously SMOOTHER than their
own frame's surroundings. A puddle's flat, often reflective surface stands
out against the textured, grainy dry road around it. The threshold is
relative (per-frame, percentile-based) rather than fixed, because dry asphalt
is smooth in an absolute sense too.

Smoothness alone is not enough, though - SKY is the smoothest thing in any
outdoor frame, and glare off the camera's own windshield is a close second.
Both were observed as false positives. Instrumented measurements on real
imagery gave a wide separation used by the guards below:

    sky region:      mean brightness 170-178, std  3-10   (ultra-flat, high in frame, blue)
    windshield glare: very bright,            std <15     (blown-out, flat)
    real puddle:     mean brightness 72,      std  26     (real reflected detail)

So a candidate must additionally: carry real internal detail (std), sit below
the estimated horizon, and not overlap the segmented sky.

Treat this as experimental - it is a heuristic, not a calibrated detector.
"""

import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

ROI_TOP_RATIO = 0.35
MIN_AREA_RATIO = 0.065
MAX_AREA_RATIO = 0.6
MIN_ASPECT = 0.15
MAX_ASPECT = 8.0
MIN_FILL_RATIO = 0.35
SOURCE_NAME = "classical_cv_heuristic"
MODEL_NAME = "Water Clogging Heuristic (smoothness-outlier)"

# A real puddle reflection carries internal structure (reflected sky, trees,
# vehicles) and measured std ~26. Sky (std 3-10) and blown-out glare (std <15)
# are near-featureless. This single check rejects both classes of false
# positive that were reported, and is the strongest discriminator available.
MIN_REGION_STD = 12.0

# Blown-out bright hotspot (glare) - kept as a separate explicit guard.
GLARE_MIN_BRIGHTNESS = 200
GLARE_MAX_STD = 15

# Sky segmentation
SKY_MAX_ROUGHNESS = 6.0
SKY_BLUE_HUE_LOW = 90        # OpenCV hue is 0-179; ~90-135 covers sky blue
SKY_BLUE_HUE_HIGH = 135
SKY_BLUE_MIN_SAT = 25
SKY_MIN_VALUE = 90
SKY_OVERCAST_MAX_SAT = 40    # white/grey overcast sky
SKY_OVERCAST_MIN_VALUE = 160
SKY_TOP_SEED_ROWS = 6        # a sky component must touch the top of the frame
SKY_MAX_OVERLAP = 0.15       # candidate rejected if this much of it is sky
HORIZON_MARGIN_PX = 8


def estimate_sky(frame) -> Tuple[np.ndarray, Optional[int]]:
    """
    Segment sky in a full frame and estimate the horizon row.

    Sky is taken to be a smooth, sky-coloured region that is CONNECTED TO THE
    TOP of the frame. That connectivity requirement is what keeps a puddle
    reflecting blue sky - which looks sky-coloured and smooth, but sits in the
    middle of the road - from being mistaken for sky itself.

    Returns (sky_mask uint8 0/255 full-frame, horizon_y or None).
    """
    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    roughness = cv2.boxFilter(np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)), -1, (15, 15))
    smooth = roughness < SKY_MAX_ROUGHNESS

    blue_sky = (
        (hue >= SKY_BLUE_HUE_LOW) & (hue <= SKY_BLUE_HUE_HIGH)
        & (sat >= SKY_BLUE_MIN_SAT) & (val >= SKY_MIN_VALUE)
    )
    overcast_sky = (sat < SKY_OVERCAST_MAX_SAT) & (val >= SKY_OVERCAST_MIN_VALUE)

    candidate = ((blue_sky | overcast_sky) & smooth).astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    num, labels = cv2.connectedComponents(candidate)
    sky_mask = np.zeros((h, w), dtype=np.uint8)
    if num <= 1:
        return sky_mask, None

    top_band = labels[0:SKY_TOP_SEED_ROWS, :]
    seed_labels = {int(l) for l in np.unique(top_band) if l != 0}
    if not seed_labels:
        return sky_mask, None

    for lbl in seed_labels:
        sky_mask[labels == lbl] = 255

    sky_rows = np.where(sky_mask.any(axis=1))[0]
    horizon_y = int(sky_rows.max()) if sky_rows.size else None
    return sky_mask, horizon_y


def detect_water_clogging(frame) -> List[Dict[str, Any]]:
    """
    Detect road-surface regions that are smoothness outliers relative to the
    rest of this frame's own road area, excluding sky and glare. Returns
    detections in the same shape the other edge-AI detectors use.
    """
    h, w = frame.shape[:2]
    y0 = int(h * ROI_TOP_RATIO)
    roi = frame[y0:h, 0:w]
    if roi.size == 0:
        return []

    try:
        sky_mask, horizon_y = estimate_sky(frame)
        roi_sky = sky_mask[y0:h, 0:w]

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        lap_abs = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3))
        roughness = cv2.boxFilter(lap_abs, -1, (21, 21))

        median_roughness = float(np.median(roughness))
        threshold = min(float(np.percentile(roughness, 15)), median_roughness * 0.35)
        if threshold <= 0:
            return []

        smooth_mask = (roughness < threshold).astype(np.uint8) * 255
        kernel = np.ones((9, 9), np.uint8)
        smooth_mask = cv2.morphologyEx(smooth_mask, cv2.MORPH_OPEN, kernel)
        smooth_mask = cv2.morphologyEx(smooth_mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(smooth_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    except Exception as e:
        logger.error(f"Water clogging heuristic error: {e}", exc_info=True)
        return []

    roi_area = roi.shape[0] * roi.shape[1]
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    detections: List[Dict[str, Any]] = []

    for c in contours:
        area = cv2.contourArea(c)
        if area < roi_area * MIN_AREA_RATIO or area > roi_area * MAX_AREA_RATIO:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        aspect = bw / max(1, bh)
        if aspect > MAX_ASPECT or aspect < MIN_ASPECT:
            continue
        fill_ratio = area / (bw * bh)
        if fill_ratio < MIN_FILL_RATIO:
            continue

        region = gray[y:y + bh, x:x + bw]
        region_mean = float(np.mean(region))
        region_std = float(np.std(region))

        # Featureless region: sky or blown-out glare, not a puddle reflection.
        if region_std < MIN_REGION_STD:
            continue
        if region_mean > GLARE_MIN_BRIGHTNESS and region_std < GLARE_MAX_STD:
            continue

        # Overlaps segmented sky.
        sky_patch = roi_sky[y:y + bh, x:x + bw]
        if sky_patch.size and (float(np.count_nonzero(sky_patch)) / sky_patch.size) > SKY_MAX_OVERLAP:
            continue

        # Sits at or above the horizon - water cannot be up there.
        if horizon_y is not None and (y + y0) < (horizon_y + HORIZON_MARGIN_PX):
            continue

        area_ratio = round(area / roi_area, 5)
        # Heuristic score, not a calibrated ML probability.
        smoothness_score = min(1.0, max(0.0, 1.0 - (threshold / max(median_roughness, 1e-3))))
        heuristic_confidence = round(min(0.95, 0.35 + 0.4 * smoothness_score + 0.2 * fill_ratio), 4)

        detections.append({
            "event_type": "WATER_CLOGGING",
            "confidence": heuristic_confidence,
            "bbox": [float(x), float(y + y0), float(x + bw), float(y + y0 + bh)],
            "area_ratio": area_ratio,
            "timestamp": now_iso,
            "source": SOURCE_NAME,
            "model_name": MODEL_NAME,
        })

    return detections
