from datetime import datetime
import json
import os
import time
import urllib.request
import cv2
from ultralytics import YOLO

# ==========================================
# CONFIGURATION SETTINGS
# ==========================================
MODEL_PATH = "best26n-200.pt"

# Camera device index: 0 = Built-in camera, 1 = External USB Webcam
WEBCAM_INDEX = 1

# Global detection confidence threshold
CONF_THRESHOLD = 0.60

# Google Apps Script Web App URL & Secret Key
WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwGnvnDRIpnumSq8bnvUPIMEaqZg9Mwot5Pcn30_Glzv3dzx3dBW1oNiag6KN1N6PgT/exec"
SECRET_KEY = "My_Private_Yolo_Key_987777"

# ------------------------------------------
# LOCAL STORAGE PATH CONFIGURATION
# ------------------------------------------
LOCAL_BASE_DIR = "inspection_captures"

INSPECTION_RAW_DIR = os.path.join(LOCAL_BASE_DIR, "raw")
INSPECTION_ANNOTATED_DIR = os.path.join(LOCAL_BASE_DIR, "annotated")
INSPECTION_LOGS_DIR = os.path.join(LOCAL_BASE_DIR, "logs")
MASTER_LOG_CSV = os.path.join(INSPECTION_LOGS_DIR, "inspection_history.csv")

# Create local storage directories
os.makedirs(INSPECTION_RAW_DIR, exist_ok=True)
os.makedirs(INSPECTION_ANNOTATED_DIR, exist_ok=True)
os.makedirs(INSPECTION_LOGS_DIR, exist_ok=True)

# List of target class names to detect and show on UI
TARGET_CLASSES = [
    "glasses",
    "face-mask-medical",
    "earmuffs",
    "gloves",
    "shoes",
    "safety-vest",
    "tools",
    "helmet",
    "medical-suit",
    "safety-suit",
]

# ==========================================
# INITIALIZATION
# ==========================================
model = YOLO(MODEL_PATH)

# Convert string target classes to model numerical class IDs
TARGET_CLASS_IDS = [
    cls_id
    for cls_id, cls_name in model.names.items()
    if cls_name in TARGET_CLASSES
]

print(f"Targeting Class IDs: {TARGET_CLASS_IDS}")

# Open external webcam (cv2.CAP_DSHOW speeds up initialization on Windows)
cap = cv2.VideoCapture(WEBCAM_INDEX, cv2.CAP_DSHOW)

# Fallback in case CAP_DSHOW is not supported
if not cap.isOpened():
  cap = cv2.VideoCapture(WEBCAM_INDEX)

# Request 1080p camera resolution
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

# On-screen CAPTURE button coordinates (x1, y1, x2, y2)
btn_x1, btn_y1, btn_x2, btn_y2 = 20, 50, 170, 90
capture_flag = False
save_msg_time = 0


def handle_mouse_click(event, x, y, flags, param):
  """Handles mouse clicks on the on-screen CAPTURE button."""
  global capture_flag
  if event == cv2.EVENT_LBUTTONDOWN:
    if btn_x1 <= x <= btn_x2 and btn_y1 <= y <= btn_y2:
      capture_flag = True


# Display window setup
window_title = "SH17 Inspection & Detection Logger"
cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
cv2.resizeWindow(window_title, 1920, 1080)
cv2.setMouseCallback(window_title, handle_mouse_click)

prev_time = 0

# ==========================================
# MAIN EXECUTION LOOP
# ==========================================
while cap.isOpened():
  success, frame = cap.read()
  if not success:
    print(
        f"Webcam (index {WEBCAM_INDEX}) feed unavailable. Check USB connection."
    )
    break

  # Real-time FPS calculation
  curr_time = time.time()
  fps = int(1 / (curr_time - prev_time)) if prev_time != 0 else 0
  prev_time = curr_time

  # Filtered inference: only detect TARGET_CLASS_IDS with >= 60% confidence
  results = model(
      frame,
      conf=CONF_THRESHOLD,
      imgsz=640,
      classes=TARGET_CLASS_IDS if TARGET_CLASS_IDS else None,
  )

  # Only plots boxes for TARGET_CLASSES on screen
  annotated_frame = results[0].plot()

  # Check keypress shortcuts
  key_pressed = cv2.waitKey(1) & 0xFF
  if key_pressed in (ord("s"), 32):  # 's' or Spacebar
    capture_flag = True

  # ------------------------------------------
  # CAPTURE & LOCAL LOGGING LOGIC
  # ------------------------------------------
  if capture_flag:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    file_timestamp = timestamp.replace(":", "").replace(" ", "_")

    # Generate Image & Log Filenames
    raw_filename = f"inspect_raw_{file_timestamp}.jpg"
    annotated_filename = f"inspect_labeled_{file_timestamp}.jpg"
    json_log_filename = f"log_{file_timestamp}.json"

    raw_path = os.path.join(INSPECTION_RAW_DIR, raw_filename)
    annotated_path = os.path.join(
        INSPECTION_ANNOTATED_DIR, annotated_filename
    )
    json_log_path = os.path.join(INSPECTION_LOGS_DIR, json_log_filename)

    # 1. Save Pictures locally
    cv2.imwrite(raw_path, frame)
    cv2.imwrite(annotated_path, annotated_frame)
    print(f"📸 Raw Photo Saved Locally: {raw_path}")
    print(f"🏷️ Labeled Photo Saved Locally: {annotated_path}")

    # 2. Process active detections
    boxes = results[0].boxes
    target_class_list = []
    target_details_list = []

    for box in boxes:
      cls_name = model.names[int(box.cls[0])]
      conf = float(box.conf[0])
      target_class_list.append(cls_name)
      target_details_list.append(f"{cls_name} ({conf * 100:.1f}%)")

    target_count = len(target_class_list)
    classes_str = (
        ", ".join(set(target_class_list))
        if target_class_list
        else "No Target Class"
    )

    details_str = (
        " | ".join(target_details_list)
        if target_details_list
        else "No Target Objects Detected"
    )
    details_str += f" [File: {annotated_filename}]"

    # 3. Construct Payload
    payload = {
        "secret": SECRET_KEY,
        "timestamp": timestamp,
        "total_objects": target_count,
        "classes": classes_str,
        "details": details_str,
    }

    # 4. Save Logs locally (JSON + CSV)
    with open(json_log_path, "w", encoding="utf-8") as f:
      json.dump(payload, f, indent=4)
    print(f"📝 Local JSON Log Saved: {json_log_path}")

    file_exists = os.path.exists(MASTER_LOG_CSV)
    with open(MASTER_LOG_CSV, "a", encoding="utf-8") as f:
      if not file_exists:
        f.write("Timestamp,Total Objects,Detected Classes,Details,Filename\n")
      f.write(
          f'"{timestamp}",{target_count},"{classes_str}","{details_str}","{annotated_filename}"\n'
      )
    print(f"📄 Local Master CSV Log Updated: {MASTER_LOG_CSV}")

    # 5. Transmit Payload to Apps Script Web App
    try:
      req = urllib.request.Request(
          WEB_APP_URL,
          data=json.dumps(payload).encode("utf-8"),
          headers={"Content-Type": "application/json"},
      )
      with urllib.request.urlopen(req) as response:
        res_body = response.read().decode("utf-8")
        print(f"📊 Google Sheet Log Created: {res_body}")
    except Exception as err:
      print(f"❌ Web Upload Failed: {err}")

    capture_flag = False
    save_msg_time = time.time()

  # ------------------------------------------
  # UI OVERLAYS
  # ------------------------------------------
  # Red CAPTURE Button
  cv2.rectangle(
      annotated_frame, (btn_x1, btn_y1), (btn_x2, btn_y2), (0, 0, 220), -1
  )
  cv2.putText(
      annotated_frame,
      "CAPTURE",
      (btn_x1 + 12, btn_y1 + 26),
      cv2.FONT_HERSHEY_SIMPLEX,
      0.6,
      (255, 255, 255),
      2,
      cv2.LINE_AA,
  )

  # Status Bar
  total_detected_target = len(results[0].boxes)
  cv2.putText(
      annotated_frame,
      f"FPS: {fps} | Active Filtered Detections (>=60%): {total_detected_target}",
      (20, 30),
      cv2.FONT_HERSHEY_SIMPLEX,
      0.7,
      (0, 255, 0),
      2,
  )

  # Save Confirmation Notice
  if time.time() - save_msg_time < 1.5:
    cv2.putText(
        annotated_frame,
        "SAVED LOCALLY & SHEET LOGGED!",
        (185, 78),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 255),
        2,
    )

  cv2.imshow(window_title, annotated_frame)

  # Exit on 'q' or 'Esc' keypress
  if key_pressed in (ord("q"), 27):
    break

cap.release()
cv2.destroyAllWindows()