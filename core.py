"""Portable Joy Home release subset. No private integrations or implicit model calls."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta, timezone
import json, os, uuid, threading, time, mimetypes, re
ROOT=Path(__file__).resolve().parent
DATA_DIR=Path(os.environ.get('JOY_HOME_DATA',str(ROOT/'data')))
PANEL_DIR=DATA_DIR/'panels'
LOCK=threading.RLock()
WAKE=threading.Condition(LOCK)
APPEND_CAP=200
STALE_AFTER_S=1800
PANELS=dict.fromkeys(['calendar','weather','reminders','notifications','agents','actions','commands','projects','tasks','focus','inner','memory','activity','schedule','general_approvals','email_reply_queue','skill_review_queue'])
def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def iso_age_s(iso):
    try:
        return max(0.0, time.time() - datetime.fromisoformat(iso).timestamp())
    except Exception:
        return None

def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _write_json(path, value):
    # The temp name must be unique per call. It used to be a fixed
    # "<name>.tmp", so two threads writing the same target raced: the first
    # rename consumed the shared temp file and the second raised
    # FileNotFoundError. The dashboard serves requests on threads and polls
    # every two seconds, so this fired intermittently under live voice load —
    # and because it happened inside ask_terra, it aborted research dispatch
    # and left the action stuck in "preparing" with no worker ever started.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2, ensure_ascii=False)
        tmp.replace(path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass

def get_panel(name):
    """Returns {"data", "updated_at", "source"} or None if never pushed."""
    with LOCK:
        return _read_json(PANEL_DIR / f"{name}.json", None)

def set_panel(name, data, source="joy"):
    entry = {"data": data, "updated_at": now_iso(), "source": source}
    with WAKE:
        _write_json(PANEL_DIR / f"{name}.json", entry)
        WAKE.notify_all()
    return entry

def append_panel(name, item, source="joy"):
    with WAKE:
        entry = _read_json(PANEL_DIR / f"{name}.json", None) or {"data": []}
        items = entry.get("data") if isinstance(entry.get("data"), list) else []
        if isinstance(item, dict) and "ts" not in item:
            item["ts"] = now_iso()
        items.append(item)
        entry = {"data": items[-APPEND_CAP:], "updated_at": now_iso(), "source": source}
        _write_json(PANEL_DIR / f"{name}.json", entry)
        WAKE.notify_all()
    return entry

def panel_data(name, default):
    entry = get_panel(name)
    return entry["data"] if entry and entry.get("data") is not None else default

def normalize_calendar(events):
    """Let Joy push minimal events ({title, start}); derive labels, sort by start."""
    out = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        ev = dict(ev)
        for key, label_key in (("start", "start_time"), ("end", "end_time")):
            if ev.get(key) and not ev.get(label_key):
                try:
                    dt = datetime.fromisoformat(str(ev[key]))
                    label = dt.strftime("%I:%M %p").lstrip("0")
                    ev[label_key] = "All day" if ev.get("all_day") and key == "start" else label
                except Exception:
                    pass
        out.append(ev)
    out.sort(key=lambda e: (not e.get("all_day"), str(e.get("start") or "")))
    return out

def _missing(name):
    return {"available": False, "reason": f"Joy hasn't pushed {name} yet"}

def build_dashboard_state():
    state = {"ok": True}
    newest = None
    oldest = None
    sections = {}
    for name in PANELS:
        entry = get_panel(name)
        if entry:
            age = iso_age_s(entry["updated_at"])
            sections[name] = {"updated_at": entry["updated_at"],
                              "source": entry.get("source", "joy"),
                              "age_s": round(age) if age is not None else None}
            newest = max(newest or entry["updated_at"], entry["updated_at"])
            oldest = min(oldest or entry["updated_at"], entry["updated_at"])

    cal = get_panel("calendar")
    state["calendar"] = cal["data"] if cal else []
    state["calendar_meta"] = None if cal else _missing("calendar")
    state["calendar_error"] = None

    state["weather"] = panel_data("weather", [])
    for key in ("personal_email", "school_email"):
        entry = get_panel(key)
        if entry:
            state[key] = entry["data"]

    rem = get_panel("reminders")
    state["reminders"] = rem["data"] if rem else _missing("reminders")
    state["notifications"] = panel_data("notifications", [])
    agents = get_panel("agents")
    state["agents"] = agents["data"] if agents else _missing("agents")
    state["memory"] = panel_data("memory", [])
    state["commands"] = panel_data("commands", [])
    state["inner"] = panel_data("inner", None)
    focus = panel_data("focus", {})
    if isinstance(focus, dict) and focus.get("top_priority"):
        state["top_priority"] = focus["top_priority"]

    state["sections"] = sections
    state["built_at"] = newest
    oldest_age = iso_age_s(oldest) if oldest else None
    state["stale"] = oldest_age is None or oldest_age > STALE_AFTER_S
    return state

def build_mission():
    pending = [a for a in load_approvals() if a["status"] == "pending"]
    notifications = panel_data("notifications", [])
    open_notifications = [
        n for n in notifications
        if str(n.get("status", "new")).lower() not in ("reviewed", "done", "dismissed", "archived")
    ] if isinstance(notifications, list) else []
    return {
        "ok": True,
        "tasks": panel_data("tasks", {"backlog": [], "progress": [], "done": []}),
        "projects": panel_data("projects", []),
        "notifications": open_notifications[-50:],
        "approvals": pending,
        "activity": panel_data("activity", [])[-20:],
        "schedule": panel_data("schedule", []),
        "approvalLog": [a for a in load_approvals() if a["status"] != "pending"][-50:],
    }

def _multipart(fields, file_field, filename, file_bytes):
    audio_mime = {
        ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg",
        ".mp3": "audio/mpeg", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg",
        ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".flac": "audio/flac",
    }.get(Path(filename).suffix.lower(), "application/octet-stream")
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; "
                  f"filename=\"{filename}\"\r\nContent-Type: {audio_mime}\r\n\r\n").encode())
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"

class TranscriptionProviderError(RuntimeError):
    """Retain useful provider diagnostics without echoing response messages.

    Provider messages can contain credentials or request content. Retain only
    bounded machine fields and the HTTP status; never persist the raw body.
    """
    def __init__(self, provider, error):
        try:
            response = json.loads(error.read(65536).decode("utf-8", "replace"))
            fields = (response.get("error") or response.get("detail") or {}) if isinstance(response, dict) else {}
            if not isinstance(fields, dict):
                fields = {}
        except Exception:
            fields = {}
        def machine_field(value):
            if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.]{0,79}", value):
                return None
            if any(word in value.lower() for word in ("password", "secret", "token", "credential")):
                return None
            return value
        self.info = {"provider": provider, "status": int(error.code),
                     "code": machine_field(fields.get("code") or fields.get("status")),
                     "type": machine_field(fields.get("type")),
                     "param": machine_field(fields.get("param"))}
        if error.code == 401:
            message = "Transcription service authentication failed."
        elif error.code == 403:
            message = "Transcription service access was denied."
        elif error.code == 429:
            message = ("Transcription service quota is unavailable." if self.info["code"] == "insufficient_quota"
                       else "Transcription service is rate limited. Try again later.")
        elif error.code >= 500:
            message = "Transcription service is temporarily unavailable."
        else:
            message = "Transcription provider rejected the audio request."
        super().__init__(message)

def parse_multipart_file(body, content_type):
    m = re.search(r'boundary="?([^";]+)"?', content_type or "")
    if not m:
        raise ValueError("missing multipart boundary")
    boundary = m.group(1).encode()
    for part in body.split(b"--" + boundary):
        if b"filename=" not in part:
            continue
        header, _, payload = part.partition(b"\r\n\r\n")
        # Remove multipart framing only, never legitimate trailing audio bytes.
        payload = payload.removesuffix(b"\r\n")
        fn = re.search(rb'filename="([^"]*)"', header)
        return (fn.group(1).decode("utf-8", "replace") if fn else "audio.webm"), payload
    raise ValueError("no file part found")
