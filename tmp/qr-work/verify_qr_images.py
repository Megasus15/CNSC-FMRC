"""Independently decode exact final artwork at useful display and print sizes."""
from pathlib import Path
import sys
import json
import io

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tmp/qr-runtime"))
from PIL import Image, ImageFilter, ImageEnhance
import cv2
import numpy as np
import zxingcpp

items = json.loads((ROOT / "tmp/qr-work/manifest.json").read_text())
records = []
failed = []
detector = cv2.QRCodeDetector()
for item in items:
    original = Image.open(item["path"]).convert("RGB")
    assert original.size == (3000, 3000)
    assert original.getpixel((0, 0)) == (253, 250, 246)
    assert item["quiet_zone_modules"] >= 4
    for side in [3000, 1500, 900, 600, 450, 300]:
        small = original.resize((side, side), Image.Resampling.LANCZOS)
        result = zxingcpp.read_barcode(small)
        actual = result.text if result else None
        row = {"file": item["filename"], "test": f"PNG {side}x{side}",
               "decoder": "ZXing", "decoded": actual, "pass": actual == item["url"]}
        records.append(row)
        if not row["pass"]:
            failed.append(row)
    tests = {
        "grayscale 900": original.resize((900, 900), Image.Resampling.LANCZOS).convert("L"),
        "blur 900 radius 0.6": original.resize((900, 900), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.6)),
        "rotate 90 degrees 900": original.resize((900, 900), Image.Resampling.LANCZOS).rotate(90),
    }
    buf = io.BytesIO()
    original.resize((900, 900), Image.Resampling.LANCZOS).save(buf, "JPEG", quality=75)
    buf.seek(0)
    tests["JPEG 900 quality75"] = Image.open(buf).copy()
    for name, image in tests.items():
        result = zxingcpp.read_barcode(image)
        actual = result.text if result else None
        row = {"file": item["filename"], "test": name, "decoder": "ZXing",
               "decoded": actual, "pass": actual == item["url"]}
        records.append(row)
        if not row["pass"]:
            failed.append(row)
    for side in [1500, 900, 600]:
        image = original.resize((side, side), Image.Resampling.LANCZOS)
        actual, points, straight = detector.detectAndDecode(cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR))
        row = {"file": item["filename"], "test": f"PNG {side}x{side}",
               "decoder": "OpenCV", "decoded": actual, "pass": actual == item["url"]}
        records.append(row)
        if not row["pass"]:
            failed.append(row)

report = {"checks": len(records), "passed": len(records)-len(failed), "failed": failed, "results": records}
(ROOT / "tmp/qr-work/scan-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"checks": report["checks"], "passed": report["passed"], "failed": failed}, indent=2))
sys.exit(1 if failed else 0)
