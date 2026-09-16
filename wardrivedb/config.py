"""Shared constants, regexes, and CSV mapping for WardriveDB."""

import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
PORT = int(os.environ.get("PORT", "8765"))
MAX_UPLOAD = 200 * 1024 * 1024  # 200 MB

# Auth-mode classification — BLE/BT device-class labels (e.g. "Car Audio;10")
# are NOT auth modes, so we filter to real auth-like values.
AUTH_CATEGORY_SQL = (
    "(auth_mode IS NOT NULL AND auth_mode != ''"
    " AND (auth_mode LIKE '[%' OR auth_mode LIKE 'LTE%'"
    " OR auth_mode LIKE 'GSM%' OR auth_mode LIKE 'NR%'"
    " OR auth_mode IN ('Open', 'WEP', 'WPA', 'WPA2', 'WPA3')))"
)

SELECT_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)
FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|VACUUM|REINDEX|ATTACH|DETACH)\b",
    re.IGNORECASE,
)

# Wigle CSV header name (lowercased, stripped) → DB column
CSV_COL_MAP = {
    "mac":              "mac",
    "ssid":             "ssid",
    "authmode":         "auth_mode",
    "firstseen":        "first_seen",
    "channel":          "channel",
    "frequency":        "frequency",
    "rssi":             "rssi",
    "currentlatitude":  "latitude",
    "currentlongitude": "longitude",
    "altitudemeters":   "altitude",
    "accuracymeters":   "accuracy",
    "type":             "type",
}
