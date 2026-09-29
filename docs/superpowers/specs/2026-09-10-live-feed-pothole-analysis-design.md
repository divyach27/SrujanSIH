# Live Feed: Upload-and-Count Pothole Analysis

Status: approved, implementing directly (bounded reuse of existing detection/tracking code; no separate implementation-plan doc).

## Problem

The Live Feed page currently simulates a continuous bus-monitoring stream (fake GPS,
vehicle counting on a bundled demo video). The user wants something genuinely useful
instead: upload a short (5-10s) road video or camera clip, and get back a total count
of distinct potholes visible in it. This is the first of several planned Live Feed
tools; today's scope is this one feature only.

## Non-goals

- No live webcam streaming analysis (file upload covers "upload a video" and, via the
  `capture` input attribute, "record with the camera" on mobile).
- No database persistence of results (standalone analyze-and-display tool).
- No change to `/api/monitoring/*` or `/api/video/stream` or their backing services -
  the Dashboard's status bar still depends on that pipeline, so it stays as-is,
  just unused by the new Live Feed page.

## Backend

### Model weights

`backend/app/edge_ai/road_hazard_detector.py` already implements real YOLO pothole
inference but its weights file has never been present, so it's always run in
degraded/vehicle-only mode. Download `peterhdd/pothole-detection-yolov8` (`best.pt`
from Hugging Face) to
`backend/app/edge_ai/models/road_damage/peterhdd_pothole_yolov8s.pt` - the exact path
the detector already scans for.

### New endpoint: `POST /api/hazard/analyze`

New router `backend/app/routers/hazard.py`, registered in `main.py` alongside the
existing routers.

- Accepts multipart `UploadFile` (video).
- Validates content type/extension (mp4/mov/avi/webm) and rejects files that are
  implausibly large (>100MB) up front. After reading duration via OpenCV, rejects
  clips longer than 20s (slack past the stated 5-10s) with a clear 422 error.
- Writes the upload to a temp file (`tempfile.NamedTemporaryFile`), since
  `cv2.VideoCapture` needs a real path.
- Samples frames at ~10 effective fps (skips frames if source fps is higher) to
  bound worst-case processing time - a 10s clip is ~100 inferences, a few seconds on
  CPU at the existing `imgsz=480` convention used elsewhere in this codebase.
- Runs each sampled frame through `RoadHazardDetector.detect()` (reused as-is).
- Feeds detections into a new, purpose-built in-memory tracker for this endpoint
  only (see below). Does NOT reuse `HazardEventManager`'s final dedup step, which
  suppresses new events within 15m of a previous one via GPS - an uploaded clip has
  no real per-frame GPS, so that check would collapse every pothole after the first
  into "the same one."
- On completion, deletes the temp file and returns a JSON summary.

### Tracker (new, small, colocated in the router or a small `services/hazard_analysis.py`)

Reuses the pure helper functions `compute_box_iou` and `compute_centroid_distance`
from `hazard_event_manager.py` (already reusable, no changes needed there).

For each sampled frame, in order:
1. Filter raw detections by `confidence >= 0.5`.
2. Match each detection against active tracks via IoU >= 0.15 or centroid distance
   <= 120px, restricted to tracks last matched within the last 1.5s of video time (a
   longer gap closes the track - prevents two different potholes that pass through
   similar pixel coordinates far apart in time from being merged).
3. Update matched tracks (hit count, best confidence, best-confidence frame crop);
   start new tracks for unmatched detections.

After all frames are processed: any track with `hits >= 2` is a confirmed pothole
(mirrors the existing live-pipeline's confirmation_count default, filtering
single-frame noise).

### Response shape

```json
{
  "pothole_count": 3,
  "frames_analyzed": 97,
  "video_duration_seconds": 8.2,
  "potholes": [
    {
      "track_id": 1,
      "confidence": 0.91,
      "first_seen_seconds": 1.2,
      "hits": 6,
      "thumbnail_base64": "<jpeg crop, base64>"
    }
  ],
  "hazard_model_loaded": true
}
```

If the model still fails to load for any reason, respond 200 with
`hazard_model_loaded: false`, `pothole_count: 0`, empty `potholes`, and a
`message` explaining the model is unavailable - not a 500, since this is a
recoverable/expected state the frontend should render clearly rather than treat
as a crash.

## Frontend

`frontend/src/pages/LiveIntelligence.tsx` is rewritten (still mounted at `/live`,
nav label unchanged):

- Upload control: drag-and-drop area plus a file input
  (`accept="video/*" capture="environment"`) so mobile can record directly.
- On file select: client-side sanity check (rough duration/size) before upload for
  fast feedback, then `POST` the file to `/api/hazard/analyze` with a generous
  fetch timeout and an "Analyzing..." state (spinner + progress messaging, since
  this can take several seconds).
- Results view: total pothole count shown prominently (the headline number the
  user asked for), followed by a list of each detected pothole with its confidence,
  timestamp-in-clip, and thumbnail.
- Error states: oversized/too-long file rejected client-side with a clear message;
  server errors (model unavailable, processing failure) shown via the existing
  `ErrorAlert` component pattern already used elsewhere in this app.
- Removes the old continuous-monitoring JSX/handlers (`startMonitoring`,
  `stopMonitoring`, MJPEG `<img>` stream, GPS/vehicle-count telemetry grid) from
  this page. `services/api.ts`'s `startMonitoring`/`stopMonitoring`/
  `getMonitoringStatus` calls remain untouched since `CommandCenter.tsx` still uses
  `getMonitoringStatus`.

## Testing / verification

- Backend: exercise the endpoint with a short real clip (record one via the
  Playwright-driven browser or use an existing sample) and confirm a plausible
  count, a `hazard_model_loaded: true` state, and correct rejection of an oversized
  or overlong file.
- Frontend: drive the real running app in a browser - upload a clip, confirm the
  "Analyzing" state, the results view, and that the Dashboard's status bar (which
  depends on the untouched monitoring pipeline) still works.
