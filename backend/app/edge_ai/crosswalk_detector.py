"""
Edge AI - Pedestrian Crosswalk (Zebra Crossing) Detector
Loads a pretrained YOLOv8 ONNX model (xN1ckuz/Crosswalks-Detection-using-YOLO,
a university Computer Vision course project, distributed via GitHub Releases)
to identify marked pedestrian crossings on the road ahead. ONNX format was
chosen deliberately over a pickled .pt file from the same class of source:
ONNX carries no arbitrary-code-execution risk on load, unlike Python pickle.
"""

import os
import datetime
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class CrosswalkDetector:
    def __init__(
        self,
        model_path: Optional[str] = None,
        confidence_threshold: float = 0.25,
    ):
        self.confidence_threshold = confidence_threshold
        self.model = None
        self.is_initialized = False
        self.model_name = "Crosswalk Detection YOLOv8 (xN1ckuz)"
        self.model_source = "xn1ckuz_crosswalk_yolov8_onnx"

        if model_path:
            self.model_path = model_path
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            self.model_path = os.path.join(base_dir, "models", "crosswalk", "crosswalk_detection.onnx")

    def load_model(self) -> bool:
        if not os.path.exists(self.model_path):
            logger.error(f"Crosswalk model weights not found at: {self.model_path}")
            self.is_initialized = False
            return False

        try:
            from ultralytics import YOLO
            logger.info(f"Loading Crosswalk YOLO ONNX model from: {self.model_path}")
            self.model = YOLO(self.model_path)
            self.is_initialized = True
            logger.info(f"Crosswalk detector initialized successfully (conf_threshold={self.confidence_threshold})")
            return True
        except Exception as e:
            logger.error(f"Failed to load Crosswalk model: {e}", exc_info=True)
            self.is_initialized = False
            return False

    def detect(self, frame, conf_threshold: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Run crosswalk inference on a single frame. The underlying ONNX graph
        has a fixed 512x512 input baked in at export time, so no imgsz/device
        override is passed - ultralytics resolves this automatically.
        """
        if not self.is_initialized:
            if not self.load_model():
                return []

        effective_conf = conf_threshold if conf_threshold is not None else self.confidence_threshold
        detections: List[Dict[str, Any]] = []
        h, w = frame.shape[:2]

        try:
            results = self.model(frame, conf=effective_conf, verbose=False)
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

            for r in results:
                if r.boxes is None or len(r.boxes) == 0:
                    continue

                for box in r.boxes:
                    conf = float(box.conf[0].item())
                    xyxy = box.xyxy[0].tolist()

                    x1 = max(0.0, xyxy[0])
                    y1 = max(0.0, xyxy[1])
                    x2 = min(float(w), xyxy[2])
                    y2 = min(float(h), xyxy[3])
                    box_w = max(1.0, x2 - x1)
                    box_h = max(1.0, y2 - y1)
                    area_ratio = round((box_w * box_h) / (w * h), 5)

                    detections.append({
                        "event_type": "CROSSWALK",
                        "confidence": round(conf, 4),
                        "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                        "area_ratio": area_ratio,
                        "timestamp": now_iso,
                        "source": self.model_source,
                        "model_name": self.model_name,
                    })
        except Exception as e:
            logger.error(f"Crosswalk inference error: {e}", exc_info=True)

        return detections
