"""Face & streamer layout detection for 9:16 vertical reframe.

Detects faces/streamers in a video clip and computes optimal crop parameters
for both 'smart' (single subject reframe) and 'streamer' (split-screen facecam + gameplay).
Outputs a single JSON line to stdout.
"""

import sys
import os
import json
import urllib.request
from pathlib import Path

# Suppress OpenCV C++ warnings
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

# Fix Windows stdout encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"


def get_yunet_model_path() -> str:
    current_dir = Path(__file__).resolve().parent
    model_path = current_dir / "models" / "yunet.onnx"
    if model_path.exists() and model_path.stat().st_size > 50000:
        return str(model_path)

    # Check root models/
    root_model = current_dir.parent / "models" / "yunet.onnx"
    if root_model.exists() and root_model.stat().st_size > 50000:
        return str(root_model)

    model_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(YUNET_URL, str(model_path))
        return str(model_path)
    except Exception as e:
        sys.stderr.write(f"[WARN] Failed to download YuNet model: {e}\n")
        return ""


def determine_corner(cx: float, cy: float, w: int, h: int) -> str:
    is_right = cx >= (w / 2)
    is_bottom = cy >= (h / 2)
    if is_bottom:
        return "bottom-right" if is_right else "bottom-left"
    else:
        return "top-right" if is_right else "top-left"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing video path argument"}))
        sys.exit(1)

    video_path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "smart"
    corner_pref = sys.argv[3] if len(sys.argv) > 3 else "auto"

    try:
        import cv2
        try:
            cv2.setLogLevel(0)
        except Exception:
            pass
    except ImportError:
        # Fallback if cv2 not available
        print(json.dumps({
            "detected": False,
            "error": "OpenCV not installed",
            "fallback": True,
            "smartCrop": {"cropX": 0},
            "streamer": None
        }))
        sys.exit(0)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Cannot open video: {video_path}"}))
        sys.exit(1)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if w <= 0 or h <= 0:
        cap.release()
        print(json.dumps({"error": "Invalid video dimensions"}))
        sys.exit(1)

    model_path = get_yunet_model_path()
    detector = None
    if model_path and os.path.exists(model_path):
        try:
            detector = cv2.FaceDetectorYN.create(model_path, "", (w, h), score_threshold=0.45)
        except Exception as e:
            sys.stderr.write(f"[WARN] Failed to init FaceDetectorYN: {e}\n")

    # Sample frames across the video (about 2 to 4 frames per second)
    sample_interval = max(1, int(fps // 3))
    detected_faces = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_idx += 1
        if detector and (frame_idx % sample_interval == 0):
            try:
                _, faces = detector.detect(frame)
                if faces is not None and len(faces) > 0:
                    for f in faces:
                        fx, fy, fw, fh = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                        conf = float(f[-1])
                        fcx = fx + fw / 2.0
                        fcy = fy + fh / 2.0
                        detected_faces.append({
                            "x": fx, "y": fy, "w": fw, "h": fh,
                            "cx": fcx, "cy": fcy, "conf": conf,
                            "frame": frame_idx
                        })
            except Exception:
                pass

    cap.release()

    detected = len(detected_faces) > 0
    face_cx = w / 2.0
    face_cy = h / 2.0
    face_w = 100.0
    face_h = 100.0

    if detected:
        # Compute median/mean position of detected faces
        # If multiple faces, prioritize the one that appears most or has higher confidence
        face_cx = sum(f["cx"] for f in detected_faces) / len(detected_faces)
        face_cy = sum(f["cy"] for f in detected_faces) / len(detected_faces)
        face_w = sum(f["w"] for f in detected_faces) / len(detected_faces)
        face_h = sum(f["h"] for f in detected_faces) / len(detected_faces)

    auto_corner = determine_corner(face_cx, face_cy, w, h)
    chosen_corner = corner_pref if corner_pref in ["bottom-right", "bottom-left", "top-right", "top-left"] else auto_corner

    # ── 1. Smart Crop (Single 9:16 window centered on face) ───────────────
    crop_w_smart = min(w, max(2, int(round(h * 9 / 16))))
    crop_h_smart = h
    smart_x = int(round(face_cx - crop_w_smart / 2.0))
    smart_x = max(0, min(smart_x, w - crop_w_smart))

    # ── 2. Streamer Mode (Split: Top Facecam + Bottom Game) ───────────────
    # We produce 9:16 by stacking Top (aspect 720:520 = 1.385) and Bottom (720:760 = 0.947)
    # Facecam window:
    # Size should be comfortable around streamer face: ~35% - 45% of width, or ~2.8x face size
    cam_w = int(min(w * 0.42, max(w * 0.28, face_w * 2.8)))
    cam_h = int(cam_w * (520 / 720))

    if corner_pref == "auto" and detected:
        # Center around detected face, clamped inside frame
        cam_x = int(round(face_cx - cam_w / 2.0))
        cam_y = int(round(face_cy - cam_h / 2.0))
    else:
        # Position according to chosen corner
        if chosen_corner == "bottom-right":
            cam_x = w - cam_w
            cam_y = h - cam_h
        elif chosen_corner == "bottom-left":
            cam_x = 0
            cam_y = h - cam_h
        elif chosen_corner == "top-right":
            cam_x = w - cam_w
            cam_y = 0
        else: # top-left
            cam_x = 0
            cam_y = 0

    cam_x = max(0, min(cam_x, w - cam_w))
    cam_y = max(0, min(cam_y, h - cam_h))

    # Bottom Game window: Centered game screen
    game_h = h
    game_w = int(h * (720 / 760))
    if game_w > w:
        game_w = w
        game_h = int(game_w * (760 / 720))
    game_x = max(0, min((w - game_w) // 2, w - game_w))
    game_y = max(0, min((h - game_h) // 2, h - game_h))

    result = {
        "detected": detected,
        "sampleCount": len(detected_faces),
        "sourceWidth": w,
        "sourceHeight": h,
        "face": {
            "cx": round(face_cx, 1),
            "cy": round(face_cy, 1),
            "w": round(face_w, 1),
            "h": round(face_h, 1),
        },
        "detectedCorner": auto_corner,
        "chosenCorner": chosen_corner,
        "smartCrop": {
            "cropX": smart_x,
            "cropY": 0,
            "cropW": crop_w_smart,
            "cropH": crop_h_smart,
        },
        "streamer": {
            "cam": {
                "x": cam_x,
                "y": cam_y,
                "w": cam_w,
                "h": cam_h,
            },
            "game": {
                "x": game_x,
                "y": game_y,
                "w": game_w,
                "h": game_h,
            },
            "targetTop": [720, 520],
            "targetBottom": [720, 760],
            "targetTop1080": [1080, 780],
            "targetBottom1080": [1080, 1140]
        }
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
