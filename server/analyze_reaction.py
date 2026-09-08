"""Streamer reaction analysis for viral-moment detection (Tier 0 + Tier 1).

For streamer/reaction content the viral moment IS the streamer's reaction,
so this script grounds candidates in real facial reactions instead of text.

Per sampled frame (default 1 fps):
 1. YuNet (server/models/yunet.onnx) finds the facecam box -> crop.
 2. Tier 0 - MediaPipe Face Landmarker blendshapes (models/face_landmarker.task):
    jawOpen (scream/shock) + mouthSmile (laugh) + browInnerUp (shock)
    + face-size spike (leaning into the camera).
 3. Tier 1 - FER+ int8 ONNX (MIT, Official ONNX Model Zoo, auto-downloaded
    once to server/models/ferplus_int8.onnx, ~19 MB) via cv2.dnn:
    P(fear) / P(surprise) / P(happiness) on the 64x64 gray face crop.

Per-second reaction score -> smoothing -> peak-pick -> JSON peaks.

Usage:
    python analyze_reaction.py <video_path> [--fps 1] [--min-score 45]

Output: single JSON line on stdout:
    {"peaks": [{"time": 124, "score": 87, "emotion": "surprise"}],
     "seconds": 4292, "frames": 4260, "faces": 3901,
     "fer": true, "blend": true}

Frames without a detectable face are skipped. No faces at all -> peaks []
(caller falls back to audio+text signals). Never crashes: errors are
reported as {"peaks": [], "error": "..."} with exit code 0.
"""

import sys
import os
import json
import argparse
import urllib.request
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

os.environ.setdefault("OPENCV_LOG_LEVEL", "OFF")
os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
# FER+ int8, MIT license, Official ONNX Model Zoo
FERPLUS_URL = "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-12-int8.onnx"
LANDMARKER_URL = ("https://storage.googleapis.com/mediapipe-models/"
                  "face_landmarker/face_landmarker/float16/1/face_landmarker.task")

FER_LABELS = ["neutral", "happiness", "surprise", "sadness",
              "anger", "disgust", "fear", "contempt"]
# Emotions that mark a viral streamer reaction (horror/gaming/comedy)
TARGET_EMOTIONS = {"happiness", "surprise", "fear"}


def log(msg):
    sys.stderr.write(f"[reaction] {msg}\n")


def download_once(url, dest, min_bytes):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > min_bytes:
        return str(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        log(f"downloading {dest.name} ...")
        urllib.request.urlretrieve(url, str(dest))
    except Exception as e:
        log(f"download failed for {dest.name}: {e}")
        return ""
    if dest.exists() and dest.stat().st_size > min_bytes:
        return str(dest)
    return ""


def resolve_models(script_dir):
    server_models = Path(script_dir) / "models"
    root_models = Path(script_dir).parent / "models"
    yunet = None
    for cand in (server_models / "yunet.onnx", root_models / "yunet.onnx"):
        if cand.exists() and cand.stat().st_size > 50000:
            yunet = str(cand)
            break
    if not yunet:
        yunet = download_once(YUNET_URL, server_models / "yunet.onnx", 50000)

    landmarker = None
    for cand in (server_models / "face_landmarker.task", root_models / "face_landmarker.task"):
        if cand.exists() and cand.stat().st_size > 1000000:
            landmarker = str(cand)
            break
    if not landmarker:
        # Optional: Tier 1 alone is enough, don't force a 3.6 MB download here.
        log("face_landmarker.task not found, Tier 0 (blendshapes) disabled")

    fer = server_models / "ferplus_int8.onnx"
    fer_path = download_once(FERPLUS_URL, fer, 1000000)
    if not fer_path:
        log("FER+ model unavailable, Tier 1 (emotion labels) disabled")
    return yunet, landmarker, (fer_path or "")


def softmax(xs):
    m = max(xs)
    ex = [2.718281828 ** (x - m) for x in xs]
    s = sum(ex) or 1.0
    return [v / s for v in ex]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="path to analysis video (low-res ok)")
    ap.add_argument("--fps", type=float, default=1.0)
    ap.add_argument("--min-score", type=float, default=45.0)
    args = ap.parse_args()

    script_dir = str(Path(__file__).resolve().parent)
    result = {"peaks": [], "seconds": 0, "frames": 0, "faces": 0,
              "fer": False, "blend": False}

    try:
        import cv2
        try:
            cv2.setLogLevel(0)
        except Exception:
            pass
    except ImportError:
        result["error"] = "OpenCV not installed"
        print(json.dumps(result))
        return

    import numpy as np

    if not os.path.exists(args.video):
        result["error"] = f"Video not found: {args.video}"
        print(json.dumps(result))
        return

    yunet_path, landmarker_path, fer_path = resolve_models(script_dir)

    detector = None
    if yunet_path and os.path.exists(yunet_path):
        try:
            # Input size is set per-frame below (after downscale)
            detector = {"model": yunet_path}
        except Exception as e:
            log(f"YuNet init note: {e}")

    landmarker = None
    if landmarker_path:
        try:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision
            base = mp_python.BaseOptions(model_asset_path=landmarker_path)
            opts = mp_vision.FaceLandmarkerOptions(
                base_options=base,
                output_face_blendshapes=True,
                num_faces=1,
                running_mode=mp_vision.RunningMode.IMAGE,
            )
            landmarker = mp_vision.FaceLandmarker.create_from_options(opts)
            result["blend"] = True
        except Exception as e:
            log(f"FaceLandmarker unavailable: {e}")

    fer_net = None
    if fer_path and os.path.exists(fer_path):
        try:
            fer_net = cv2.dnn.readNetFromONNX(fer_path)
            try:
                fer_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                fer_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            except Exception:
                pass
            result["fer"] = True
        except Exception as e:
            log(f"FER+ load failed: {e}")

    if detector is None:
        result["error"] = "YuNet face detector unavailable"
        print(json.dumps(result))
        return

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        result["error"] = f"Cannot open video: {args.video}"
        print(json.dumps(result))
        return

    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    duration = total_frames / src_fps if src_fps > 0 else 0
    result["seconds"] = round(duration, 1)

    # Downscale for detection speed; coordinates mapped back proportionally
    work_w = 640
    scale = work_w / src_w if src_w > work_w else 1.0
    work_h = max(2, int(src_h * scale))

    step = max(1, int(round(src_fps / max(0.1, args.fps))))
    log(f"{src_w}x{src_h} @ {src_fps:.1f}fps, sampling every {step} frames (~{args.fps}/s)")

    per_sec = {}  # sec -> list of reaction scores 0..100
    frame_idx = 0
    sampled = 0
    face_areas = []

    try:
        face_detector = cv2.FaceDetectorYN.create(
            detector["model"], "", (work_w, work_h), score_threshold=0.45)
    except Exception as e:
        result["error"] = f"YuNet init failed: {e}"
        print(json.dumps(result))
        cap.release()
        return

    import math

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step != 0:
            frame_idx += 1
            continue
        t = frame_idx / src_fps if src_fps > 0 else 0.0
        frame_idx += 1
        sampled += 1

        small = cv2.resize(frame, (work_w, work_h)) if scale != 1.0 else frame
        try:
            _, faces = face_detector.detect(small)
        except Exception:
            faces = None
        if faces is None or len(faces) == 0:
            continue
        # Streamer facecam: highest confidence face
        best = max(faces, key=lambda f: float(f[-1]))
        fx, fy, fw, fh = (float(best[0]), float(best[1]), float(best[2]), float(best[3]))
        inv = 1.0 / scale if scale != 0 else 1.0
        ox, oy, ow, oh = fx * inv, fy * inv, fw * inv, fh * inv

        # Crop with generous padding (facecams are small), clamped;
        # upscale tiny crops so FER+/landmarker get usable pixels
        pad = 0.5
        x1 = max(0, int(ox - ow * pad))
        y1 = max(0, int(oy - oh * pad))
        x2 = min(src_w, int(ox + ow * (1 + pad)))
        y2 = min(src_h, int(oy + oh * (1 + pad)))
        if x2 <= x1 or y2 <= y1:
            continue
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        if max(crop.shape[0], crop.shape[1]) < 128:
            k = 128.0 / max(crop.shape[0], crop.shape[1])
            crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        result["faces"] += 1

        area_ratio = (ow * oh) / max(1.0, (src_w * src_h))
        face_areas.append(area_ratio)

        # ── Tier 0: blendshapes ──
        blend_score = 0.0
        if landmarker is not None:
            try:
                import mediapipe as mp
                rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                res = landmarker.detect(mp_img)
                if res.face_blendshapes and len(res.face_blendshapes) > 0:
                    cats = {c.category_name: float(c.score)
                            for c in res.face_blendshapes[0]}
                    jaw = cats.get("jawOpen", 0.0)
                    smile = max(cats.get("mouthSmileLeft", 0.0),
                                cats.get("mouthSmileRight", 0.0))
                    brow = max(cats.get("browInnerUp", 0.0),
                               cats.get("browOuterUpLeft", 0.0),
                               cats.get("browOuterUpRight", 0.0))
                    blend_score = min(1.0, 0.45 * jaw + 0.35 * smile + 0.20 * brow)
            except Exception:
                pass

        # ── Tier 1: FER+ emotion labels ──
        fer_score = 0.0
        top_emotion = "neutral"
        if fer_net is not None:
            try:
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                gray = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
                blob = cv2.dnn.blobFromImage(
                    gray, 1.0 / 255.0, (64, 64), (0,), swapRB=False, crop=False)
                # blobFromImage on single channel may give (1,1,64,64) already
                if len(blob.shape) == 4 and blob.shape[1] != 1:
                    blob = blob[:, 0:1, :, :]
                fer_net.setInput(blob)
                out = fer_net.forward().flatten().tolist()
                probs = softmax(out)
                labeled = sorted(zip(FER_LABELS, probs),
                                 key=lambda kv: kv[1], reverse=True)
                top_emotion = labeled[0][0]
                target = max([p for lab, p in labeled if lab in TARGET_EMOTIONS] or [0.0])
                fer_score = float(target)
            except Exception:
                pass

        if result["blend"] and result["fer"]:
            reaction = 0.5 * blend_score + 0.5 * fer_score
        elif result["fer"]:
            reaction = fer_score
        else:
            reaction = blend_score

        # Face-size spike bonus (leaning into the camera = strong reaction)
        if len(face_areas) >= 10:
            med = sorted(face_areas)[len(face_areas) // 2]
            if med > 0 and area_ratio > 1.5 * med:
                reaction = min(1.0, reaction + 0.15)

        sec = int(math.floor(t))
        per_sec.setdefault(sec, []).append((reaction * 100.0, top_emotion))

        if sampled % 300 == 0:
            log(f"sampled {sampled} frames, t={t:.0f}s")

    cap.release()
    try:
        if landmarker is not None:
            landmarker.close()
    except Exception:
        pass

    result["frames"] = sampled
    if not per_sec:
        print(json.dumps(result))
        return

    # Per-second max + smoothing (±2s moving average)
    secs = sorted(per_sec.keys())
    avg = {s: max(v[0] for v in per_sec[s]) for s in secs}
    # Majority emotion per second
    emo = {}
    for s in secs:
        votes = {}
        for _, e in per_sec[s]:
            votes[e] = votes.get(e, 0) + 1
        emo[s] = max(votes.items(), key=lambda kv: kv[1])[0]

    smooth = {}
    for s in secs:
        window = [avg.get(k, 0.0) for k in range(s - 2, s + 3) if k in avg]
        smooth[s] = sum(window) / max(1, len(window))

    # Peak-pick
    cands = sorted(smooth.items(), key=lambda kv: kv[1], reverse=True)
    peaks = []
    for s, v in cands:
        if v < args.min_score:
            continue
        if any(abs(s - p["time"]) < 20 for p in peaks):
            continue
        peaks.append({"time": s, "score": round(v, 1), "emotion": emo.get(s, "neutral")})
        if len(peaks) >= 12:
            break
    peaks.sort(key=lambda p: p["time"])
    result["peaks"] = peaks
    log(f"done: {sampled} frames, {result['faces']} faces, {len(peaks)} peaks")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
