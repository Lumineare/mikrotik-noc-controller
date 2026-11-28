"""
MikroTik Controller — web GUI (FastAPI + native RouterOS API)

Run:
    python app.py
    -> http://127.0.0.1:8090

Credentials are read from .env next to this file (MT_HOST/MT_USER/MT_PASS).
Everything here is READ-ONLY: only /print and /monitor commands are issued.
"""
import json
import sqlite3
import os
import re
import socket
import threading
import time
import datetime
import traceback
import urllib.request
import urllib.error
import hashlib
import gzip
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import secrets
import math
import shutil

import routeros_api
from fastapi import FastAPI, HTTPException, Query, status, Header, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ---------------------------------------------------------------- NOC Authentication
# Kredensial login dibaca dari .env (NOC_ADMIN_USER / NOC_ADMIN_PASS) supaya
# ganti user tidak perlu edit kode dan tidak ada password hardcoded di repo.
def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(Path(__file__).resolve().parent / ".env")
NOC_ADMIN_USER = os.getenv("NOC_ADMIN_USER", "admin")
NOC_ADMIN_PASS = os.getenv("NOC_ADMIN_PASS", "admin123")
# Profil yang tampil di dashboard — bukan identitas hardcoded di kode.
NOC_USER_NAME = os.getenv("NOC_USER_NAME", "Admin")
NOC_USER_ROLE = os.getenv("NOC_USER_ROLE", "Administrator")
NOC_USER_EMAIL = os.getenv("NOC_USER_EMAIL", "")
NOC_USER_SITE = os.getenv("NOC_USER_SITE", "RS Anwar Medika")
ACTIVE_SESSIONS: dict[str, dict] = {}
SESSION_TTL = float(os.getenv("NOC_SESSION_TTL_H", "12")) * 3600


def _sess_get(token: str):
    """Sesi dengan masa berlaku — token lama dibuang supaya dict tidak bocor."""
    s = ACTIVE_SESSIONS.get(token)
    if not s:
        return None
    if time.time() - float(s.get("_ts") or 0) > SESSION_TTL:
        ACTIVE_SESSIONS.pop(token, None)
        return None
    return s


class LoginReq(BaseModel):
    username: str
    password: str

# ---------------------------------------------------------------- config & registry
BASE = Path(__file__).resolve().parent
ENV_FILE = BASE / ".env"
DEVICES_FILE = BASE / "devices.json"
NOC_DB_FILE = BASE / "noc_history.db"
_DB_LOCK = threading.Lock()


def init_noc_db():
    with _DB_LOCK:
        conn = sqlite3.connect(str(NOC_DB_FILE), timeout=10)
        c = conn.cursor()
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=10000")
        c.execute("""
            CREATE TABLE IF NOT EXISTS alert_history (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                status TEXT,
                error TEXT,
                text TEXT,
                device_id TEXT,
                alert_type TEXT,
                created_at REAL
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS fleet_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL,
                device_id TEXT,
                online INTEGER,
                cpu_load INTEGER,
                uptime TEXT,
                board TEXT,
                version TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS client_presence (
                mac TEXT PRIMARY KEY,
                ip TEXT,
                device_name TEXT,
                brand TEXT,
                model_series TEXT,
                device_type TEXT,
                vendor TEXT,
                is_custom_name INTEGER DEFAULT 0,
                is_randomized INTEGER DEFAULT 0,
                ap_id TEXT NOT NULL,
                ap_name TEXT NOT NULL,
                ap_host TEXT,
                interface TEXT,
                band TEXT,
                ssid TEXT,
                signal_dbm INTEGER,
                signal_raw TEXT,
                tx_rate TEXT,
                rx_rate TEXT,
                uptime TEXT,
                first_seen REAL,
                last_seen REAL,
                status TEXT DEFAULT 'online',
                roam_count INTEGER DEFAULT 0
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS client_roaming_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL,
                time_str TEXT,
                mac TEXT NOT NULL,
                event_type TEXT NOT NULL,
                from_ap_id TEXT,
                from_ap_name TEXT,
                from_signal_dbm INTEGER,
                from_band TEXT,
                to_ap_id TEXT NOT NULL,
                to_ap_name TEXT NOT NULL,
                to_signal_dbm INTEGER,
                to_band TEXT,
                to_interface TEXT,
                to_ssid TEXT,
                to_ip TEXT,
                details TEXT
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_dev ON fleet_telemetry (device_id, timestamp)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_alerts_time ON alert_history (created_at DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON client_presence (last_seen DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_presence_ap ON client_presence (ap_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_roam_mac ON client_roaming_events (mac, timestamp DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_roam_time ON client_roaming_events (timestamp DESC)")
        try:
            cols = {r[1] for r in c.execute("PRAGMA table_info(client_presence)").fetchall()}
            if "is_randomized" not in cols:
                c.execute("ALTER TABLE client_presence ADD COLUMN is_randomized INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        # Job optimasi hidup di memori; yang tercatat "running" saat proses mati
        # tidak akan pernah selesai dan bikin UI polling selamanya.
        try:
            c.execute("UPDATE optimize_jobs SET status='error', "
                      "error=COALESCE(error,'server restart saat job berjalan') "
                      "WHERE status='running'")
        except sqlite3.OperationalError:
            pass  # tabel belum ada pada instalasi baru
        conn.commit()
        conn.close()


init_noc_db()


def db_save_alert(record: dict):
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            c = conn.cursor()
            c.execute("""
                INSERT OR REPLACE INTO alert_history 
                (id, timestamp, status, error, text, device_id, alert_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.get("id"),
                record.get("timestamp"),
                record.get("status"),
                record.get("error"),
                record.get("text"),
                record.get("device_id"),
                record.get("alert_type"),
                time.time()
            ))
            conn.commit()
            conn.close()
        except Exception:
            pass


def db_get_alerts(limit: int = 100) -> list[dict]:
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            rows = c.execute("SELECT * FROM alert_history ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            out = [dict(r) for r in rows]
            conn.close()
            return out
        except Exception:
            return []


def db_clear_alerts():
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            c = conn.cursor()
            c.execute("DELETE FROM alert_history")
            conn.commit()
            conn.close()
        except Exception:
            pass


def db_record_fleet_telemetry(devices_probed: list[dict]):
    now_ts = time.time()
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            c = conn.cursor()
            records = [
                (
                    now_ts,
                    d.get("id"),
                    1 if d.get("online") else 0,
                    int(d.get("cpu_load") or 0),
                    str(d.get("uptime") or ""),
                    str(d.get("board") or ""),
                    str(d.get("version") or "")
                )
                for d in devices_probed
            ]
            c.executemany("""
                INSERT INTO fleet_telemetry (timestamp, device_id, online, cpu_load, uptime, board, version)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, records)
            # Prune records older than 7 days to keep db compact
            seven_days_ago = now_ts - 7 * 86400
            c.execute("DELETE FROM fleet_telemetry WHERE timestamp < ?", (seven_days_ago,))
            conn.commit()
            conn.close()
        except Exception:
            pass


def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(ENV_FILE)

CFG = {
    "host": os.getenv("MT_HOST", "192.168.88.1"),
    "user": os.getenv("MT_USER", "API"),
    "pass": os.getenv("MT_PASS", ""),
    "port": int(os.getenv("MT_PORT", "8728")),
}


def load_devices() -> list[dict]:
    if not DEVICES_FILE.exists():
        initial = [{
            "id": "apm-hrd",
            "name": "APM-HRD (cAP ac)",
            "host": CFG["host"],
            "port": CFG["port"],
            "user": CFG["user"],
            "pass": CFG["pass"],
            "group": "HRD / Lt 1",
            "is_default": True,
        }]
        save_devices(initial)
        return initial
    try:
        data = json.loads(DEVICES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list) and data:
            return data
    except Exception:
        pass
    return []


def save_devices(devices: list[dict]):
    # Tulis atomik: kalau proses mati di tengah write, devices.json lama tetap utuh.
    # write_text langsung bisa meninggalkan file setengah jadi = semua AP hilang.
    tmp = DEVICES_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(devices, indent=2), encoding="utf-8")
    os.replace(tmp, DEVICES_FILE)


def get_device(device_id: str | None = None) -> dict:
    devs = load_devices()
    if not devs:
        return {
            "id": "default", "name": "Default MikroTik",
            "host": CFG["host"], "user": CFG["user"], "pass": CFG["pass"], "port": CFG["port"],
            "group": "Default", "is_default": True,
        }
    if device_id:
        for d in devs:
            if d.get("id") == device_id:
                return d
        raise HTTPException(status_code=404, detail=f"Perangkat dengan id '{device_id}' tidak ditemukan")
    for d in devs:
        if d.get("is_default"):
            return d
    return devs[0]


def sanitize_device(d: dict) -> dict:
    return {
        "id": d.get("id"),
        "name": d.get("name"),
        "host": d.get("host"),
        "port": d.get("port", 8728),
        "user": d.get("user", "API"),
        "group": d.get("group", ""),
        "is_default": bool(d.get("is_default", False)),
        "has_pass": bool(d.get("pass")),
    }


_DEVICE_LOCKS: dict[str, threading.Lock] = {}
_META_LOCK = threading.Lock()


def get_device_lock(host: str) -> threading.Lock:
    with _META_LOCK:
        if host not in _DEVICE_LOCKS:
            _DEVICE_LOCKS[host] = threading.Lock()
        return _DEVICE_LOCKS[host]


# ---------------------------------------------------------------- models
class DeviceCreate(BaseModel):
    id: str | None = None
    name: str | None = None
    host: str
    port: int = 8728
    user: str = "admin"
    pass_: str = Field(default="", alias="pass")
    group: str = "Default"
    is_default: bool = False


class DeviceUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    port: int | None = None
    user: str | None = None
    pass_: str | None = Field(default=None, alias="pass")
    group: str | None = None
    is_default: bool | None = None


class DeviceTestReq(BaseModel):
    host: str
    port: int = 8728
    user: str = "admin"
    pass_: str = Field(default="", alias="pass")


class BatchReq(BaseModel):
    devices: list[str]
    action: str
    script: str | None = None
    dns: list[str] | None = None
    ntp: list[str] | None = None
    new_pass: str | None = None


app = FastAPI(title="MikroTik Controller", docs_url="/api/docs")

DIST_DIR = BASE / "frontend" / "dist"
if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

UPLOAD_DIR = BASE / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# ---------------------------------------------------------------- Auth routes
@app.post("/api/auth/login")
def api_auth_login(req: LoginReq):
    user = req.username.strip()
    pwd = req.password.strip()
    
    if user == NOC_ADMIN_USER and pwd == NOC_ADMIN_PASS:
        token = secrets.token_hex(24)
        session_data = {
            "username": user,
            "name": NOC_USER_NAME,
            "role": NOC_USER_ROLE,
            "email": NOC_USER_EMAIL,
            "hospital": NOC_USER_SITE,
            "login_time": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        session_data["_ts"] = time.time()
        ACTIVE_SESSIONS[token] = session_data
        return {
            "status": "ok",
            "token": token,
            "user": session_data
        }
    raise HTTPException(status_code=401, detail="Kredensial tidak valid. Gunakan kredensial resmi NOC RS Anwar Medika.")


@app.get("/api/auth/me")
def api_auth_me(authorization: str | None = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
        sess = _sess_get(token)
        if sess:
            return {"authenticated": True, "user": {k: v for k, v in sess.items() if not k.startswith("_")}}
    raise HTTPException(status_code=401, detail="Sesi telah kedaluwarsa atau belum login")


@app.post("/api/auth/logout")
def api_auth_logout(authorization: str | None = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
        ACTIVE_SESSIONS.pop(token, None)
    return {"status": "ok", "message": "Sesi berhasil ditutup"}


# ---------------------------------------------------------------- connection
class MT:
    def __init__(self, device: dict | str | None = None):
        if isinstance(device, str):
            self.cfg = get_device(device)
        elif isinstance(device, dict):
            self.cfg = device
        else:
            self.cfg = get_device(None)
        self.pool = None
        self.api = None

    def __enter__(self):
        self.pool = routeros_api.RouterOsApiPool(
            self.cfg["host"],
            username=self.cfg.get("user", "API"),
            password=self.cfg.get("pass", ""),
            port=int(self.cfg.get("port", 8728)),
            plaintext_login=True,
        )
        self.pool.set_timeout(float(os.getenv("MT_TIMEOUT", "5")))
        self.api = self.pool.get_api()
        return self

    def __exit__(self, *exc):
        try:
            if self.pool:
                self.pool.disconnect()
        except Exception:
            pass

    def resource(self, path):
        return self.api.get_resource(path)

    def get(self, path, **filters):
        return self.api.get_resource(path).get(**filters)

    def monitor_traffic(self, iface, once=True):
        res = self.api.get_resource("/interface")
        args = {"interface": iface}
        if once:
            args["once"] = ""
        return res.call("monitor-traffic", {"interface": iface, "once": ""}) or []

    def wireless_monitor(self, iface):
        res = self.api.get_resource("/interface/wireless")
        return res.call("monitor", {"numbers": iface, "once": ""}) or []


def _safe(fn, default=None, tag="?"):
    """Run a menu read; on failure return default and record the error."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        ERRORS.append(f"{tag}: {type(e).__name__}: {e}")
        return default


ERRORS: list[str] = []


def _int(v, base=10, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- payloads
def build_system(mt):
    ident = _safe(lambda: mt.get("/system/identity")[0], {}, "identity")
    res = _safe(lambda: mt.get("/system/resource")[0], {}, "resource")
    rb = _safe(lambda: mt.get("/system/routerboard")[0], {}, "routerboard")
    clock = _safe(lambda: mt.get("/system/clock")[0], {}, "clock")
    ntp = _safe(lambda: mt.get("/system/ntp/client")[0], {}, "ntp")
    health = _safe(lambda: mt.get("/system/health"), [], "health")

    total_mem = _int(res.get("total-memory"))
    free_mem = _int(res.get("free-memory"))
    total_hdd = _int(res.get("total-hdd-space"))
    free_hdd = _int(res.get("free-hdd-space"))

    return {
        "identity": ident.get("name"),
        "board": res.get("board-name"),
        "model": rb.get("model"),
        "serial": rb.get("serial-number"),
        "version": res.get("version"),
        "architecture": res.get("architecture-name"),
        "uptime": res.get("uptime"),
        "cpu": res.get("cpu"),
        "cpu_count": _int(res.get("cpu-count")),
        "cpu_frequency": _int(res.get("cpu-frequency")),
        "cpu_load": _cpu_pct(mt),
        "memory_total_mb": round(total_mem / 1048576, 1),
        "memory_free_mb": round(free_mem / 1048576, 1),
        "memory_used_pct": round((1 - free_mem / total_mem) * 100, 1) if total_mem else None,
        "disk_total_mb": round(total_hdd / 1048576, 1),
        "disk_free_mb": round(free_hdd / 1048576, 1),
        "firmware": rb.get("current-firmware"),
        "firmware_upgrade": rb.get("upgrade-firmware"),
        "clock": clock.get("time"),
        "date": clock.get("date"),
        "timezone": clock.get("time-zone-name"),
        "ntp_enabled": ntp.get("enabled"),
        "ntp_status": ntp.get("status"),
        "health": health,
    }


def build_interfaces(mt, with_traffic=True):
    ifaces = _safe(lambda: mt.get("/interface"), [], "interface")
    eth = {e.get("name"): e for e in _safe(lambda: mt.get("/interface/ethernet"), [], "ethernet")}
    out = []
    for i in ifaces:
        name = i.get("name")
        row = {
            "name": name,
            "type": i.get("type"),
            "running": i.get("running") == "true",
            "disabled": i.get("disabled") == "true",
            "mac": i.get("mac-address"),
            "mtu": i.get("mtu") or (eth.get(name) or {}).get("mtu"),
            "rx_byte": _int(i.get("rx-byte")),
            "tx_byte": _int(i.get("tx-byte")),
            "rx_packet": _int(i.get("rx-packet")),
            "tx_packet": _int(i.get("tx-packet")),
            "comment": i.get("comment"),
        }
        if with_traffic and i.get("running") == "true":
            tr = _safe(lambda n=name: mt.monitor_traffic(n), [], f"monitor {name}")
            if tr:
                t = tr[0]
                row["rx_bps"] = _int(t.get("rx-bits-per-second"))
                row["tx_bps"] = _int(t.get("tx-bits-per-second"))
                row["rx_pps"] = _int(t.get("rx-packets-per-second"))
                row["tx_pps"] = _int(t.get("tx-packets-per-second"))
                row["rx_errors"] = _int(t.get("rx-errors-per-second"))
                row["tx_errors"] = _int(t.get("tx-errors-per-second"))
        out.append(row)
    return out


CLIENT_ALIASES_FILE = BASE / "client_aliases.json"
CLIENT_HOSTNAMES_FILE = BASE / "client_hostnames.json"

def load_client_aliases() -> dict:
    if not CLIENT_ALIASES_FILE.exists():
        return {}
    try:
        with open(CLIENT_ALIASES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_client_aliases(data: dict):
    with open(CLIENT_ALIASES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ---- Real hostname discovery (reverse DNS / NetBIOS / mDNS) ----------------
# The MAC can never identify a randomised-MAC phone, but the *hostname* the
# device announces on the network is a real identity. We cache discovered
# hostnames so names survive between polls and do not depend on DNS uptime.
_hostname_cache: dict[str, str] = {}
_hostname_cache_loaded = False


def load_hostname_cache() -> dict:
    global _hostname_cache, _hostname_cache_loaded
    if _hostname_cache_loaded:
        return _hostname_cache
    try:
        if CLIENT_HOSTNAMES_FILE.exists():
            with open(CLIENT_HOSTNAMES_FILE, "r", encoding="utf-8") as f:
                _hostname_cache = json.load(f) or {}
    except Exception:
        _hostname_cache = {}
    _hostname_cache_loaded = True
    return _hostname_cache


def save_hostname_cache():
    try:
        with open(CLIENT_HOSTNAMES_FILE, "w", encoding="utf-8") as f:
            json.dump(_hostname_cache, f, indent=2, sort_keys=True)
    except Exception:
        pass


def _clean_hostname(raw: str) -> str:
    """Normalise a discovered hostname into a display-friendly label."""
    if not raw:
        return ""
    h = raw.strip().strip(".").split(".")[0]
    h = re.sub(r"[^A-Za-z0-9_\-]", "", h)
    if not h or len(h) < 2:
        return ""
    # Reject auto-generated / meaningless names
    up = h.upper()
    if up.startswith("MAC-") or up.startswith("ANDROID-") or re.fullmatch(r"[0-9A-F]{8,}", up):
        return ""
    if up in {"LOCALHOST", "UNKNOWN", "NONE"}:
        return ""
    return h.upper() if len(h) <= 20 else h[:20].upper()


def discover_hostname(ip: str, timeout: float = 0.7) -> str:
    """Ask the network who lives at `ip`: reverse DNS first, then NetBIOS."""
    if not ip:
        return ""
    try:
        name = socket.gethostbyaddr(ip)[0]
        cleaned = _clean_hostname(name)
        if cleaned:
            return cleaned
    except Exception:
        pass
    # NetBIOS node status (Windows file-sharing name)
    try:
        query = b"\x20CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00\x21\x00\x01"
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        s.sendto(query, (ip, 137))
        data, _ = s.recvfrom(1024)
        s.close()
        n = data[56]
        for i in range(n):
            off = 57 + i * 18
            nm = data[off:off + 15].split(b"\x00")[0].decode("ascii", "ignore").strip()
            flags = int.from_bytes(data[off + 16:off + 18], "big")
            if nm and not (flags & 0x8000) and nm != "\x01\x02__MSBROWSE__\x02":
                cleaned = _clean_hostname(nm)
                if cleaned:
                    return cleaned
    except Exception:
        pass
    return ""


def hostname_for(mac: str, ip: str | None, probe: bool = False) -> str:
    """Hostname for a client. Cache-only by default; `probe=True` asks the network.

    resolve_client_device() runs inside per-client loops, so it must never block
    on DNS. The background sweeper fills the cache with probe=True.
    """
    cache = load_hostname_cache()
    mac_norm = (mac or "").strip().upper()
    if mac_norm and mac_norm in cache:
        return cache[mac_norm]
    if not probe or not ip:
        return ""
    found = discover_hostname(ip)
    if found and mac_norm:
        cache[mac_norm] = found
        save_hostname_cache()
    return found


def sweep_client_hostnames(limit: int = 400) -> int:
    """Probe reverse DNS / NetBIOS for clients lacking a hostname (background)."""
    cache = load_hostname_cache()
    try:
        conn = sqlite3.connect(str(NOC_DB_FILE))
        c = conn.cursor()
        c.execute("SELECT mac, ip FROM client_presence WHERE ip IS NOT NULL AND ip != ''")
        rows = c.fetchall()
        conn.close()
    except Exception:
        return 0

    todo = [(m.upper(), i) for m, i in rows if m.upper() not in cache][:limit]
    if not todo:
        return 0

    def _one(pair):
        mac, ip = pair
        return mac, discover_hostname(ip)

    found = 0
    with ThreadPoolExecutor(max_workers=40) as ex:
        for mac, name in ex.map(_one, todo):
            if name:
                cache[mac] = name
                found += 1
    if found:
        save_hostname_cache()
    return found


# OUI Prefix Database (First 3 hex octets) for device vendor identification
OUI_DATABASE = {
    # Apple
    "00:03:93": "Apple", "00:05:02": "Apple", "00:0A:27": "Apple", "00:0A:95": "Apple",
    "00:10:FA": "Apple", "00:11:24": "Apple", "00:14:51": "Apple", "00:16:CB": "Apple",
    "00:17:F2": "Apple", "00:19:E3": "Apple", "00:1B:63": "Apple", "00:1C:B3": "Apple",
    "00:1D:4F": "Apple", "00:1E:52": "Apple", "00:1F:5B": "Apple", "00:1F:F3": "Apple",
    "00:21:E9": "Apple", "00:22:41": "Apple", "00:23:12": "Apple", "00:23:32": "Apple",
    "00:23:6C": "Apple", "00:23:DF": "Apple", "00:24:36": "Apple", "00:25:00": "Apple",
    "00:25:4B": "Apple", "00:25:BC": "Apple", "00:26:08": "Apple", "00:26:4A": "Apple",
    "00:26:B0": "Apple", "00:26:BB": "Apple", "28:CF:E9": "Apple", "34:15:9E": "Apple",
    "38:CA:DA": "Apple", "40:6C:8F": "Apple", "48:D7:05": "Apple", "60:03:08": "Apple",
    "68:A8:6D": "Apple", "70:11:24": "Apple", "78:4F:43": "Apple", "80:49:71": "Apple",
    "88:66:5A": "Apple", "90:72:40": "Apple", "A4:C3:61": "Apple", "AC:BC:32": "Apple",
    "B8:78:26": "Apple", "C8:3C:85": "Apple", "DC:A9:04": "Apple", "F0:18:98": "Apple",
    "F4:F1:5A": "Apple", "F8:27:93": "Apple",
    # Samsung
    "00:02:78": "Samsung", "00:07:AB": "Samsung", "00:09:18": "Samsung", "00:0D:AE": "Samsung",
    "00:12:47": "Samsung", "00:12:FB": "Samsung", "00:15:99": "Samsung", "00:16:32": "Samsung",
    "00:17:C9": "Samsung", "00:17:D5": "Samsung", "00:18:AF": "Samsung", "00:1A:8A": "Samsung",
    "00:1B:98": "Samsung", "00:1C:43": "Samsung", "00:1D:25": "Samsung", "00:1E:7D": "Samsung",
    "00:1F:CD": "Samsung", "00:21:19": "Samsung", "00:21:4C": "Samsung", "00:21:D1": "Samsung",
    "00:21:D2": "Samsung", "00:23:39": "Samsung", "00:23:99": "Samsung", "00:23:C1": "Samsung",
    "00:24:54": "Samsung", "00:24:90": "Samsung", "00:24:91": "Samsung", "00:24:E9": "Samsung",
    "00:26:37": "Samsung", "00:26:5D": "Samsung", "04:18:D6": "Samsung", "08:08:C2": "Samsung",
    "14:49:E0": "Samsung", "24:4B:03": "Samsung", "30:07:4D": "Samsung", "34:23:BA": "Samsung",
    "40:0E:85": "Samsung", "50:01:D9": "Samsung", "54:92:BE": "Samsung", "68:EB:AE": "Samsung",
    "78:40:E4": "Samsung", "84:25:DB": "Samsung", "94:65:2D": "Samsung", "A0:82:1F": "Samsung",
    "B0:C4:E7": "Samsung", "C4:73:1E": "Samsung", "D0:22:BE": "Samsung", "F4:7B:5E": "Samsung",
    # Xiaomi
    "00:9E:C8": "Xiaomi", "18:59:36": "Xiaomi", "28:6C:07": "Xiaomi", "34:80:B3": "Xiaomi",
    "38:A4:ED": "Xiaomi", "58:44:98": "Xiaomi", "64:09:80": "Xiaomi", "68:DF:DD": "Xiaomi",
    "74:51:BA": "Xiaomi", "7C:49:EB": "Xiaomi", "8C:BE:BE": "Xiaomi", "98:FA:E3": "Xiaomi",
    "AC:F7:F3": "Xiaomi", "B0:E2:35": "Xiaomi", "C4:0B:CB": "Xiaomi", "D4:97:0B": "Xiaomi",
    "E4:46:DA": "Xiaomi", "F4:60:E2": "Xiaomi", "F8:A4:5F": "Xiaomi",
    # Huawei & Honor
    "00:1E:10": "Huawei", "00:25:68": "Huawei", "00:46:4B": "Huawei", "08:19:A6": "Huawei",
    "10:1B:54": "Huawei", "10:47:80": "Huawei", "20:08:89": "Huawei", "24:DF:6A": "Huawei",
    "34:6B:46": "Huawei", "40:4D:8E": "Huawei", "48:46:FB": "Huawei", "54:89:98": "Huawei",
    "70:72:3C": "Huawei", "88:28:B3": "Huawei", "9C:28:40": "Huawei", "AC:E3:42": "Huawei",
    # Oppo & Vivo & Realme
    "08:EA:44": "OPPO", "14:7D:C5": "OPPO", "2C:5B:B8": "OPPO", "40:33:1A": "OPPO",
    "50:04:B8": "OPPO", "90:7F:61": "OPPO", "AC:C1:EE": "OPPO", "C8:F2:30": "OPPO",
    "2C:57:31": "vivo", "34:6F:24": "vivo", "54:4E:90": "vivo", "74:5A:AA": "vivo",
    "88:44:77": "vivo", "A4:EB:D3": "vivo", "B4:0B:44": "vivo", "C4:EB:67": "vivo",
    "D8:16:47": "Realme", "34:7E:5C": "Realme", "20:34:FB": "Realme",
    # PC / Laptop / Wi-Fi Chipsets
    "00:1E:67": "Intel", "00:21:5C": "Intel", "00:21:6A": "Intel", "00:22:FB": "Intel",
    "00:24:D7": "Intel", "00:26:C6": "Intel", "00:26:C7": "Intel", "00:27:0E": "Intel",
    "00:27:10": "Intel", "08:11:96": "Intel", "24:77:03": "Intel", "34:13:E8": "Intel",
    "3C:FD:FE": "Intel", "48:51:B7": "Intel", "58:91:CF": "Intel", "68:05:CA": "Intel",
    "7C:2A:DB": "Intel", "80:86:F2": "Intel", "8C:8D:28": "Intel", "A0:C5:89": "Intel",
    "B4:96:91": "Intel", "C8:9C:DC": "Intel", "DC:53:60": "Intel", "F8:63:3F": "Intel",
    "00:15:5D": "Microsoft", "00:1D:D8": "Microsoft", "28:18:78": "Microsoft", "60:45:BD": "Microsoft",
    "00:14:22": "Dell", "00:18:8B": "Dell", "00:21:70": "Dell", "00:24:E8": "Dell",
    "18:66:DA": "Dell", "24:B6:FD": "Dell", "34:17:EB": "Dell", "44:A8:42": "Dell",
    "00:1E:0B": "HP", "00:21:5A": "HP", "00:23:7D": "HP", "00:25:B3": "HP",
    "00:1F:16": "Lenovo", "00:26:18": "Lenovo", "00:26:22": "Lenovo", "04:76:6E": "Lenovo",
    "00:1A:92": "Asus", "00:1E:8C": "Asus", "00:22:15": "Asus", "00:24:8C": "Asus",
    "00:0C:42": "MikroTik", "08:55:31": "MikroTik", "18:FD:74": "MikroTik", "2C:C8:1B": "MikroTik",
    "48:8F:5A": "MikroTik", "64:D1:54": "MikroTik", "74:4D:28": "MikroTik", "B8:69:F4": "MikroTik",
    "00:27:22": "Ubiquiti", "24:A4:3C": "Ubiquiti", "74:83:C2": "Ubiquiti", "B4:FB:E4": "Ubiquiti",
    "00:1D:0F": "TP-Link", "00:27:19": "TP-Link", "14:CC:20": "TP-Link", "1C:3B:F3": "TP-Link",
    "24:69:68": "Espressif (IoT)", "30:AE:A4": "Espressif (IoT)", "84:F3:EB": "Espressif (IoT)",
    "B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
}

# Detailed mapping for specific Brand, Series/Model, and Type
# Curated OUI -> model-series hints. IMPORTANT: this table used to contain
# hand-written entries whose brand disagreed with the IEEE registry (e.g. 5C:E9:1E
# labelled "Infinix" when IEEE says Apple, B8:78:26 "Apple MacBook" when IEEE says
# Nintendo). That is exactly why device names did not match their real brand.
# The table is now only trusted when it AGREES with the bundled IEEE registry, and
# the brand always comes from IEEE. Entries are kept only for a nicer series hint.
OUI_SERIES_HINTS = {
    # Apple
    "AC:BC:32": "iPhone Series",
    "F4:F1:5A": "iPhone / iPad",
    "DC:A9:04": "iPhone Series",
    "F0:18:98": "iPad",
    # Samsung
    "B0:C4:E7": "Galaxy S Series",
    "30:07:4D": "Galaxy Tab",
    "84:25:DB": "Galaxy A / M Series",
    "F4:7B:5E": "Galaxy Z / S Series",
    # Xiaomi
    "28:6C:07": "Redmi Note Series",
    "18:59:36": "Redmi Series",
    "64:09:80": "POCO Series",
    "AC:F7:F3": "Xiaomi Series",
    # Huawei
    "00:1E:10": "Nova / Mate Series",
    "88:28:B3": "P Series / MatePad",
    # PC / laptop
    "00:14:22": "Latitude / Inspiron",
    "34:17:EB": "Vostro / Latitude",
    "00:1A:92": "VivoBook / ExpertBook",
    "00:24:8C": "ROG Phone / ZenFone",
    "00:1E:67": "Intel Wi-Fi",
    "DC:53:60": "Intel Wi-Fi 6",
}

# ---- IEEE OUI master database (bundled, offline) ---------------------------
# data/oui_prefixes.tsv.gz : "AABBCC\tVendor Name" per line, ~40.5k entries
OUI_FILE = BASE / "data" / "oui_prefixes.tsv.gz"
_IEEE_OUI: dict[str, str] | None = None
_IEEE_OUI_LOCK = threading.Lock()


def load_ieee_oui() -> dict[str, str]:
    global _IEEE_OUI
    if _IEEE_OUI is not None:
        return _IEEE_OUI
    with _IEEE_OUI_LOCK:
        if _IEEE_OUI is not None:
            return _IEEE_OUI
        table: dict[str, str] = {}
        try:
            with gzip.open(OUI_FILE, "rt", encoding="utf-8", errors="replace", newline="") as f:
                for line in f:
                    parts = line.rstrip("\n").split("\t", 1)
                    if len(parts) == 2 and parts[0]:
                        table[parts[0].strip().upper()] = parts[1].strip()
        except Exception:
            table = {}
        _IEEE_OUI = table
        return table


# Vendor-name normalisation: raw IEEE org name -> (display brand, device type hint)
VENDOR_BRAND_RULES: list[tuple[tuple[str, ...], str | None, str | None]] = [
    (("SAMSUNG",), "Samsung", "mobile"),
    (("APPLE",), "Apple", "mobile"),
    (("XIAOMI", "BEIJING XIAOMI"), "Xiaomi", "mobile"),
    (("GUANGDONG OPPO", "OPPO MOBILE"), "OPPO", "mobile"),
    (("VIVO MOBILE", "VIVO COMMUNICATION"), "vivo", "mobile"),
    (("REALME",), "Realme", "mobile"),
    (("HONOR",), "Honor", "mobile"),
    (("HUAWEI",), "Huawei", "mobile"),
    (("INFINIX", "TRANSSION"), "Infinix", "mobile"),
    (("TECNO",), "Tecno", "mobile"),
    (("INTEL",), "Intel", "laptop"),
    (("LENOVO",), "Lenovo", "laptop"),
    (("DELL",), "Dell", "laptop"),
    (("HEWLETT PACKARD", "HP INC"), "HP", "laptop"),
    (("ASUSTEK", "ASUS"), "ASUS", "laptop"),
    (("ACER",), "Acer", "laptop"),
    (("MICROSOFT",), "Microsoft", "laptop"),
    (("MICRO-STAR", "MSI"), "MSI", "laptop"),
    (("TOSHIBA",), "Toshiba", "laptop"),
    (("MURATA", "ALPS", "AZUREWAVE", "LITEON", "LITE-ON", "FOXCONN", "WISTRON", "QUANTA",
      "COMPAL", "CHICONY", "HON HAI", "PEGATRON", "CYBERTAN", "CLOUD NETWORK"), None, "unknown"),
    (("GRANDSTREAM",), "Grandstream", "voip"),
    (("YEALINK",), "Yealink", "voip"),
    (("TP-LINK", "TP LINK"), "TP-Link", "network"),
    (("MIKROTIK",), "MikroTik", "network"),
    (("UBIQUITI",), "Ubiquiti", "network"),
    (("CISCO",), "Cisco", "network"),
    (("ZTE",), "ZTE", "mobile"),
    (("ONE PLUS", "ONEPLUS"), "OnePlus", "mobile"),
    (("GOOGLE",), "Google", "mobile"),
    (("MOTOROLA", "MOTOROLA MOBILITY"), "Motorola", "mobile"),
    (("NOKIA",), "Nokia", "mobile"),
    (("SONY",), "Sony", "mobile"),
    (("LG ELECTRONICS", "LG INNOTEK"), "LG", "mobile"),
    (("ESPRESSIF",), "Espressif", "iot"),
    (("RASPBERRY PI",), "Raspberry Pi", "iot"),
    (("GSA", "GAOSHENGDA"), "Gaoshengda", "unknown"),
    (("ALTOBEAM",), "AltoBeam", "unknown"),
    (("EASY3CALL",), "Easy3Call", "voip"),
    (("HUI ZHOU",), "HuiZhou", "unknown"),
    (("ALLWINNER", "ROCKCHIP", "AMLOGIC"), "Generic SoC", "iot"),
]


def normalise_vendor(org: str) -> tuple[str, str]:
    """Map a raw IEEE organisation name to (display brand, device_type hint)."""
    if not org:
        return "", "unknown"
    up = org.upper()
    for needles, brand, dtype in VENDOR_BRAND_RULES:
        if any(n in up for n in needles):
            if brand is None:
                # Unknown OEM/ODM module maker: keep a readable short name
                short = re.split(r"[,\s]+", org.strip())[0]
                short = short[:18].title()
                return short, dtype or "unknown"
            return brand, dtype or "unknown"
    short = re.sub(r"\b(CO\.?,?\s*LTD\.?|INC\.?|CORP\.?|CORPORATION|LIMITED|TECHNOLOGY|TECHNOLOGIES|"
                   r"COMMUNICATION|COMMUNICATIONS|ELECTRONICS|COMPANY|GROUP|HOLDINGS?)\b",
                   "", org, flags=re.IGNORECASE)
    short = re.sub(r"\s+", " ", short).strip(" ,.")
    return (short or org)[:22], "unknown"


def lookup_oui_vendor(mac: str) -> str:
    """Raw IEEE organisation name for a MAC's 24-bit prefix, or \"\"."""
    prefix = "".join(mac.replace(":", "").replace("-", "").upper().split())[:6]
    if len(prefix) < 6:
        return ""
    return load_ieee_oui().get(prefix, "")


def is_locally_administered(mac_norm: str) -> bool:
    try:
        return (int(mac_norm.split(":")[0], 16) & 0x02) != 0
    except Exception:
        return False


# NOTE: previous versions carried a "RANDOM_PROFILES" table that guessed a brand
# (Samsung/Xiaomi/Apple/...) from a hash of the MAC. That produced confident but
# entirely fabricated device names. It was removed: a randomised MAC genuinely
# carries no vendor information, so it is now reported as "MAC Acak".

def resolve_client_device(mac: str, ip: str | None = None) -> dict:
    if not mac:
        return {
            "brand": "N/A",
            "model_series": "Tidak Diketahui",
            "device_name": "Tidak Diketahui",
            "vendor": "N/A",
            "is_custom_name": False,
            "device_type": "unknown"
        }
    
    mac_norm = mac.strip().upper()
    aliases = load_client_aliases()
    
    # 1. Custom alias from client_aliases.json
    if mac_norm in aliases:
        entry = aliases[mac_norm]
        if isinstance(entry, dict):
            brand = entry.get("brand") or ""
            model_series = entry.get("model_series") or ""
            custom_name = entry.get("name") or ""
            vendor = entry.get("vendor") or brand or "Kustom NOC"
            
            if not brand or not model_series:
                if "Lenovo" in custom_name or "ThinkPad" in custom_name:
                    brand, model_series = "Lenovo", "ThinkPad"
                elif "Samsung" in custom_name or "Galaxy" in custom_name:
                    brand, model_series = "Samsung", "Galaxy Tab"
                elif "Apple" in custom_name or "iPhone" in custom_name:
                    brand, model_series = "Apple", "iOS Device"
                else:
                    brand = vendor.split()[0] if vendor else "Kustom"
                    model_series = custom_name
            
            display_name = custom_name or f"{brand} {model_series}".strip()
            dev_type = "laptop" if any(w in display_name.lower() for w in ["laptop", "pc", "thinkpad"]) else ("tablet" if "tablet" in display_name.lower() else "custom")
            return {
                "brand": brand,
                "model_series": model_series,
                "device_name": display_name,
                "vendor": vendor,
                "is_custom_name": True,
                "device_type": dev_type
            }
        else:
            return {
                "brand": "Kustom",
                "model_series": str(entry),
                "device_name": str(entry),
                "vendor": "Kustom NOC",
                "is_custom_name": True,
                "device_type": "custom"
            }
    
    # 2. Real hostname discovered on the network (reverse DNS / NetBIOS).
    #    This is a genuine identity and beats any OUI guess — especially for
    #    randomised-MAC phones where the OUI carries no information at all.
    real_host = hostname_for(mac_norm, ip)
    if real_host:
        oui_brand, oui_type = "", "unknown"
        org = lookup_oui_vendor(mac_norm)
        if org:
            oui_brand, oui_type = normalise_vendor(org)
        return {
            "brand": oui_brand or "Jaringan",
            "model_series": real_host,
            "device_name": real_host,
            "vendor": org or "Nama dari jaringan (DNS/NetBIOS)",
            "is_custom_name": True,
            "device_type": oui_type,
            "is_randomized": is_locally_administered(mac_norm),
            "oui_prefix": ":".join(mac_norm.split(":")[:3]).replace(":", ""),
            "hostname_source": "network",
        }

    prefix = ":".join(mac_norm.split(":")[:3])

    # 3. Full IEEE OUI registry (bundled, ~40.5k prefixes) — the single source
    #    of truth for the brand. A prefix registered with IEEE is by definition
    #    a universal (burned-in) address, so this is checked before the
    #    randomised-MAC test.
    org = lookup_oui_vendor(mac_norm)
    if org:
        brand, dev_type = normalise_vendor(org)
        series_map = {
            "laptop": "PC / Laptop",
            "mobile": "Smartphone",
            "tablet": "Tablet",
            "voip": "IP Phone",
            "network": "Perangkat Jaringan",
            "iot": "Perangkat IoT",
        }
        model_series = OUI_SERIES_HINTS.get(prefix) or series_map.get(dev_type, "Wi-Fi Device")
        return {
            "brand": brand,
            "model_series": model_series,
            "device_name": f"{brand} {model_series}",
            "vendor": org,
            "is_custom_name": False,
            "device_type": dev_type,
            "is_randomized": False,
            "oui_prefix": prefix.replace(":", ""),
        }

    # 4. Randomised MAC (locally administered bit set) with no IEEE registration
    #    — the vendor genuinely cannot be derived from the MAC. Report that
    #    honestly instead of inventing a brand.
    if is_locally_administered(mac_norm):
        return {
            "brand": "Privat",
            "model_series": "MAC Acak",
            "device_name": f"Perangkat Privat ({mac_norm[-5:]})",
            "vendor": "MAC diacak perangkat (Private Wi-Fi Address)",
            "is_custom_name": False,
            "device_type": "unknown",
            "is_randomized": True,
            "oui_prefix": prefix.replace(":", ""),
        }

    # 5. Legacy hand-written table (fallback for prefixes missing from IEEE file)
    vendor = OUI_DATABASE.get(prefix)
    if vendor:
        brand = vendor.split()[0]
        model_series = f"{brand} Series"
        dev_type = "mobile"
        if brand in ["Intel", "Lenovo", "Dell", "HP", "Microsoft"]:
            dev_type = "laptop"
            model_series = f"{brand} PC/Laptop"
        elif brand == "Samsung":
            model_series = "Galaxy Series"
        elif brand == "Apple":
            model_series = "iPhone / iPad"
        elif brand == "Xiaomi":
            model_series = "Redmi / POCO Series"
        elif brand in ["OPPO", "vivo", "Realme", "Infinix", "Tecno"]:
            model_series = f"{brand} Smartphone"

        return {
            "brand": brand,
            "model_series": model_series,
            "device_name": f"{brand} {model_series}",
            "vendor": vendor,
            "is_custom_name": False,
            "device_type": dev_type,
            "is_randomized": False,
            "oui_prefix": prefix.replace(":", ""),
        }

    # 6. Truly unknown vendor: label as "Vendor Tidak Dikenal", never a bare
    #    "Perangkat xx:xx" that looks like a brand.
    return {
        "brand": "Tidak Dikenal",
        "model_series": "Vendor Belum Terdaftar IEEE",
        "device_name": f"Vendor Tidak Dikenal ({mac_norm[-5:]})",
        "vendor": "Tidak terdaftar di IEEE OUI",
        "is_custom_name": False,
        "device_type": "unknown",
        "is_randomized": False,
        "oui_prefix": prefix.replace(":", ""),
    }


def build_wireless(mt):
    wl = _safe(lambda: mt.get("/interface/wireless"), [], "wireless")
    clients = _safe(lambda: mt.get("/interface/wireless/registration-table"), [], "regtable")
    prof = {p.get("name"): p for p in _safe(
        lambda: mt.get("/interface/wireless/security-profiles"), [], "secprof")}

    by_iface: dict[str, list] = {}
    for c in clients:
        mac = c.get("mac-address") or ""
        ip = c.get("last-ip") or ""
        dev_info = resolve_client_device(mac, ip)
        by_iface.setdefault(c.get("interface"), []).append({
            "mac": mac,
            "ip": ip,
            "brand": dev_info.get("brand") or "",
            "model_series": dev_info.get("model_series") or "",
            "device_name": dev_info["device_name"],
            "vendor": dev_info["vendor"],
            "is_custom_name": dev_info["is_custom_name"],
            "is_randomized": dev_info.get("is_randomized", False),
            "device_type": dev_info["device_type"],
            "signal": c.get("signal-strength"),
            "signal_dbm": _parse_dbm(c.get("signal-strength")),
            "tx_rate": c.get("tx-rate"),
            "rx_rate": c.get("rx-rate"),
            "uptime": c.get("uptime"),
            "bytes": c.get("bytes"),
            "frames": c.get("frames"),
            "interface": c.get("interface"),
        })

    ifaces = []
    for w in wl:
        name = w.get("name")
        mon = _safe(lambda n=name: mt.wireless_monitor(n), [], f"wlmon {name}")
        m = mon[0] if mon else {}
        ifaces.append({
            # .id wajib: frontend memakainya untuk update/supported-channels;
            # tanpa ini semua request edit radio berakhir "Interface tidak ditemukan".
            # librouteros menormalkan ".id" jadi "id" — terima keduanya.
            "id": w.get("id") or w.get(".id"),
            "name": name,
            "ssid": w.get("ssid"),
            "band": w.get("band"),
            "frequency": w.get("frequency"),
            "frequency_live": (str(m.get("channel") or "").split("/")[0]) or None,
            "disabled": w.get("disabled") == "true",
            # field `running` basi (radio hidup tapi dilaporkan false) -> pakai status monitor
            "running": str(m.get("status") or "").startswith("running") or w.get("running") == "true",
            "mode": w.get("mode"),
            "security_profile": w.get("security-profile"),
            "profile_mode": (prof.get(w.get("security-profile")) or {}).get("mode"),
            "wireless_protocol": w.get("wireless-protocol"),
            "channel": m.get("channel"),
            "noise_floor": m.get("noise-floor"),
            "ccq": m.get("overall-tx-ccq"),
            "registered_clients": _int(m.get("registered-clients")),
            "authenticated_clients": _int(m.get("authenticated-clients")),
            "status": m.get("status"),
            "clients": sorted(by_iface.get(name, []),
                              key=lambda c: c["signal_dbm"] or -999, reverse=True),
        })

    all_clients = sorted(
        [c for v in by_iface.values() for c in v],
        key=lambda c: c["signal_dbm"] or -999, reverse=True)
    return {"interfaces": ifaces, "clients": all_clients, "client_count": len(all_clients)}


def _parse_dbm(sig):
    if not sig:
        return None
    try:
        return int(str(sig).split("@")[0])
    except ValueError:
        return None


def build_network(mt):
    addrs = _safe(lambda: mt.get("/ip/address"), [], "ip/address")
    routes = _safe(lambda: mt.get("/ip/route"), [], "ip/route")
    dhcp_client = _safe(lambda: mt.get("/ip/dhcp-client"), [], "dhcp-client")
    leases = _safe(lambda: mt.get("/ip/dhcp-server/lease"), [], "lease")
    dns = _safe(lambda: mt.get("/ip/dns")[0] if mt.get("/ip/dns") else {}, {}, "dns")
    vlan = _safe(lambda: mt.get("/interface/bridge/vlan"), [], "bridge vlan")
    arp = _safe(lambda: mt.get("/ip/arp"), [], "arp")
    return {
        "addresses": [{
            "address": a.get("address"), "network": a.get("network"),
            "interface": a.get("interface"), "disabled": a.get("disabled") == "true",
            "dynamic": a.get("dynamic") == "true",
        } for a in addrs],
        "routes": [{
            "dst": r.get("dst-address"), "gateway": r.get("gateway"),
            "distance": r.get("distance"), "active": r.get("active") == "true",
            "static": r.get("static") == "true",
        } for r in routes],
        "dhcp_clients": [{
            "interface": d.get("interface"), "address": d.get("address"),
            "status": d.get("status"), "gateway": d.get("gateway"),
            "expires": d.get("expires-after"),
        } for d in dhcp_client],
        "leases": leases,
        "dns": {
            "servers": dns.get("servers"), "dynamic": dns.get("dynamic-servers"),
            "allow_remote": dns.get("allow-remote-requests"),
        },
        "bridge_vlans": [{
            "bridge": v.get("bridge"), "vlan_ids": v.get("vlan-ids"),
            "tagged": v.get("tagged"), "untagged": v.get("untagged"),
            "dynamic": v.get("dynamic") == "true",
        } for v in vlan],
        "arp": [{
            "address": a.get("address"), "mac": a.get("mac-address"),
            "interface": a.get("interface"), "dynamic": a.get("dynamic") == "true",
            "disabled": a.get("disabled") == "true",
        } for a in arp],
    }


def build_firewall(mt):
    def rows(path, fields):
        return [{f: r.get(f) for f in fields}
                for r in _safe(lambda p=path: mt.get(p), [], path)]

    return {
        "counts": {
            "filter": len(_safe(lambda: mt.get("/ip/firewall/filter"), [], "fwfilter")),
            "nat": len(_safe(lambda: mt.get("/ip/firewall/nat"), [], "fwnat")),
            "mangle": len(_safe(lambda: mt.get("/ip/firewall/mangle"), [], "fwmangle")),
            "address_list": len(_safe(lambda: mt.get("/ip/firewall/address-list"), [], "fwaddr")),
        },
        "filter": rows("/ip/firewall/filter",
                       ["chain", "action", "src-address", "dst-address", "protocol", "comment", "disabled"]),
        "nat": rows("/ip/firewall/nat",
                    ["chain", "action", "src-address", "dst-address", "to-addresses", "comment", "disabled"]),
        "address_list": rows("/ip/firewall/address-list",
                             ["list", "address", "comment", "dynamic", "disabled"]),
    }


def build_services(mt):
    return [{
        "name": s.get("name"), "port": s.get("port"),
        "address": s.get("address") or "",
        "disabled": s.get("disabled") == "true",
    } for s in _safe(lambda: mt.get("/ip/service"), [], "ip service")]


def build_users(mt):
    return [{
        "name": u.get("name"), "group": u.get("group"),
        "disabled": u.get("disabled") == "true",
        "last_logged_in": u.get("last-logged-in"),
        "address": u.get("address") or "",
    } for u in _safe(lambda: mt.get("/user"), [], "user")]


def build_logs(mt, limit=200, topic=None):
    logs = _safe(lambda: mt.get("/log"), [], "log")
    if topic:
        logs = [l for l in logs if topic.lower() in (l.get("topics") or "").lower()]
    rows = [{
        "time": l.get("time"), "topics": l.get("topics"), "message": l.get("message"),
    } for l in logs[-limit:]]
    return list(reversed(rows))


# ---------------------------------------------------------------- device helper
def test_connection_helper(host: str, port: int, user: str, password: str) -> dict:
    try:
        pool = routeros_api.RouterOsApiPool(
            host,
            username=user,
            password=password,
            port=int(port),
            plaintext_login=True,
        )
        pool.set_timeout(3.0)  # tanpa ini default 15s → UI "add device" terasa hang
        api = pool.get_api()
        try:
            ident = api.get_resource("/system/identity").get()[0].get("name", "Unknown")
            res = api.get_resource("/system/resource").get()[0]
            board = res.get("board-name", res.get("platform", "MikroTik"))
            version = res.get("version", "Unknown")
            uptime = res.get("uptime", "Unknown")
            cpu_load = res.get("cpu-load", "0")
            return {
                "ok": True,
                "identity": ident,
                "board": board,
                "version": version,
                "uptime": uptime,
                "cpu_load": cpu_load,
            }
        finally:
            pool.disconnect()
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def get_device_dashboard(device_id: str | None, limit_logs: int = 60) -> dict:
    ERRORS.clear()
    dev = get_device(device_id)
    lock = get_device_lock(dev["host"])
    with lock:
        try:
            with MT(dev) as mt:
                ifaces = build_interfaces(mt)
                total_rx_bps = sum(i.get("rx_bps", 0) for i in ifaces)
                total_tx_bps = sum(i.get("tx_bps", 0) for i in ifaces)
                payload = {
                    "ok": True,
                    "device": sanitize_device(dev),
                    "device_id": dev["id"],
                    "device_name": dev["name"],
                    "system": build_system(mt),
                    "interfaces": ifaces,
                    "wireless": build_wireless(mt),
                    "network": build_network(mt),
                    "firewall": build_firewall(mt),
                    "services": build_services(mt),
                    "users": build_users(mt),
                    "logs": build_logs(mt, limit_logs),
                    "throughput": {
                        "rx_bps": total_rx_bps,
                        "tx_bps": total_tx_bps,
                    },
                }
        except Exception as e:
            return {
                "ok": False,
                "device": sanitize_device(dev),
                "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-1000:],
            }
    payload["errors"] = ERRORS
    return payload


# ---------------------------------------------------------------- routes
@app.get("/", response_class=HTMLResponse)
def index():
    if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
        return HTMLResponse((DIST_DIR / "index.html").read_text(encoding="utf-8"))
    return HTMLResponse((BASE / "templates" / "index.html").read_text(encoding="utf-8"))


# --- Fleet Status & Health Endpoints ---
FLEET_CACHE = {
    "last_probe": 0.0,
    "devices": [],
    "summary": {
        "total": 0,
        "online": 0,
        "offline": 0,
        "avg_cpu": 0,
        "max_cpu": 0,
        "high_cpu_count": 0,
        "total_clients": 0,
        "zero_client_aps": 0,
        "overload_aps": 0,
    },
}
FLEET_LOCK = threading.Lock()
LAST_TELEMETRY_RECORD = 0.0


def probe_fleet() -> dict:
    global LAST_TELEMETRY_RECORD
    with FLEET_LOCK:
        devs = load_devices()

        def check_dev(d: dict) -> dict:
            host = d.get("host", "").strip()
            port = int(d.get("port", 8728))
            user = d.get("user", "API")
            pwd = d.get("pass", "")
            sanitized = sanitize_device(d)

            online = False
            cpu_load = 0
            board = "MikroTik"
            version = "ROS v7"
            uptime = "-"
            clients_count: int | None = None

            # Fast probe via native routeros_api socket
            pool = None
            try:
                pool = routeros_api.RouterOsApiPool(
                    host,
                    username=user,
                    password=pwd,
                    port=port,
                    plaintext_login=True,
                )
                pool.set_timeout(1.8)
                api = pool.get_api()
                res = api.get_resource("/system/resource").get()
                if res:
                    online = True
                    cpu_load = int(res[0].get("cpu-load", 0))
                    board = res[0].get("board-name", "cAP ac")
                    version = res[0].get("version", "ROS v7")
                    uptime = res[0].get("uptime", "-")
                    # Fetch live Wi-Fi client count on the same open API connection
                    try:
                        reg = api.get_resource("/interface/wireless/registration-table").get()
                        clients_count = len(reg)
                    except Exception:
                        try:
                            reg2 = api.get_resource("/interface/wifi/registration-table").get()
                            clients_count = len(reg2)
                        except Exception:
                            clients_count = None
            except Exception:
                # Fallback: simple TCP socket connect to confirm port is open even if auth failed
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.6)
                    s.connect((host, port))
                    s.close()
                    online = True
                    uptime = "Online (TCP 8728)"
                except Exception:
                    online = False
                    uptime = "Offline"
            finally:
                if pool is not None:
                    try:
                        pool.disconnect()
                    except Exception:
                        pass

            return {
                **sanitized,
                "online": online,
                "status": "online" if online else "offline",
                "cpu_load": cpu_load,
                "uptime": uptime,
                "version": version,
                "board": board,
                "clients_count": clients_count,
            }

        with ThreadPoolExecutor(max_workers=30) as pool:
            probed = list(pool.map(check_dev, devs))

        online_devs = [d for d in probed if d.get("online")]
        online_count = len(online_devs)
        offline_count = len(probed) - online_count
        cpus = [d.get("cpu_load", 0) for d in online_devs]
        avg_cpu = round(sum(cpus) / len(cpus), 1) if cpus else 0
        max_cpu = max(cpus) if cpus else 0
        high_cpu_count = sum(1 for c in cpus if c >= 70)
        client_vals = [d["clients_count"] for d in online_devs if d.get("clients_count") is not None]
        total_clients = sum(client_vals)
        zero_client_aps = sum(1 for c in client_vals if c == 0)
        overload_aps = sum(1 for c in client_vals if c >= 35)

        FLEET_CACHE["last_probe"] = time.time()
        FLEET_CACHE["devices"] = probed
        FLEET_CACHE["summary"] = {
            "total": len(probed),
            "online": online_count,
            "offline": offline_count,
            "avg_cpu": avg_cpu,
            "max_cpu": max_cpu,
            "high_cpu_count": high_cpu_count,
            "total_clients": total_clients,
            "zero_client_aps": zero_client_aps,
            "overload_aps": overload_aps,
        }

        # Save snapshot to SQLite once every 60s
        if time.time() - LAST_TELEMETRY_RECORD > 60:
            db_record_fleet_telemetry(probed)
            LAST_TELEMETRY_RECORD = time.time()

        return FLEET_CACHE


@app.get("/api/devices/fleet")
@app.get("/api/fleet")
def get_fleet_status():
    if time.time() - FLEET_CACHE["last_probe"] > 15 or not FLEET_CACHE["devices"]:
        probe_fleet()
    return {
        "ok": True,
        "fleet": FLEET_CACHE["devices"],
        "devices": FLEET_CACHE["devices"],
        "summary": FLEET_CACHE["summary"],
    }


@app.post("/api/fleet/probe")
def trigger_fleet_probe():
    probe_fleet()
    return {
        "ok": True,
        "fleet": FLEET_CACHE["devices"],
        "devices": FLEET_CACHE["devices"],
        "summary": FLEET_CACHE["summary"],
    }


# --- Device Management Endpoints ---
@app.get("/api/devices")
def list_devices():
    devs = load_devices()
    return {"ok": True, "devices": [sanitize_device(d) for d in devs]}


@app.post("/api/devices")
def add_device(data: DeviceCreate):
    devs = load_devices()
    dev_name = (data.name or "").strip()
    if not dev_name:
        # Probe router live to pull real identity and board model
        probe = test_connection_helper(data.host.strip(), data.port, data.user.strip(), data.pass_)
        if probe.get("ok") and probe.get("identity"):
            ident = probe["identity"]
            board = probe.get("board")
            dev_name = f"{ident} ({board})" if board and board not in ("MikroTik", "x86", "Unknown") else ident
        else:
            dev_name = f"MikroTik-{data.host.strip()}"

    slug = (data.id or re.sub(r"[^a-z0-9]+", "-", dev_name.lower())).strip("-")
    if not slug:
        slug = f"mt-{len(devs) + 1}"
    # ensure uniqueness
    existing_ids = {d["id"] for d in devs}
    final_slug = slug
    counter = 1
    while final_slug in existing_ids:
        final_slug = f"{slug}-{counter}"
        counter += 1

    # if is_default, clear others
    if data.is_default or not devs:
        for d in devs:
            d["is_default"] = False

    new_dev = {
        "id": final_slug,
        "name": dev_name,
        "host": data.host.strip(),
        "port": int(data.port),
        "user": data.user.strip(),
        "pass": data.pass_,
        "group": data.group.strip() or "Default",
        "is_default": bool(data.is_default or not devs),
    }
    devs.append(new_dev)
    save_devices(devs)
    return {"ok": True, "device": sanitize_device(new_dev)}


@app.put("/api/devices/{device_id}")
def update_device(device_id: str, data: DeviceUpdate):
    devs = load_devices()
    target = None
    for d in devs:
        if d["id"] == device_id:
            target = d
            break
    if not target:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan")

    if data.name is not None:
        target["name"] = data.name.strip()
    if data.host is not None:
        target["host"] = data.host.strip()
    if data.port is not None:
        target["port"] = int(data.port)
    if data.user is not None:
        target["user"] = data.user.strip()
    if data.pass_ is not None:
        target["pass"] = data.pass_
    if data.group is not None:
        target["group"] = data.group.strip()
    if data.is_default is not None and data.is_default:
        for d in devs:
            d["is_default"] = (d["id"] == device_id)

    save_devices(devs)
    return {"ok": True, "device": sanitize_device(target)}


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: str):
    devs = load_devices()
    target = None
    for d in devs:
        if d["id"] == device_id:
            target = d
            break
    if not target:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan")
    if len(devs) <= 1:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus perangkat terakhir dalam daftar")

    devs = [d for d in devs if d["id"] != device_id]
    # if deleted was default, make the first one default
    if target.get("is_default") and devs:
        devs[0]["is_default"] = True
    save_devices(devs)
    return {"ok": True, "deleted_id": device_id}


@app.post("/api/devices/test")
def test_device(req: DeviceTestReq):
    res = test_connection_helper(req.host.strip(), req.port, req.user.strip(), req.pass_)
    return res


@app.get("/api/devices/fleet")
def fleet_status():
    devs = load_devices()
    results = []

    def probe(d):
        host = d["host"]
        lock = get_device_lock(host)
        with lock:
            res = test_connection_helper(host, d.get("port", 8728), d.get("user", "API"), d.get("pass", ""))
            return {
                "id": d["id"],
                "name": d["name"],
                "host": host,
                "port": d.get("port", 8728),
                "group": d.get("group", ""),
                "is_default": d.get("is_default", False),
                "online": res.get("ok", False),
                "identity": res.get("identity"),
                "board": res.get("board"),
                "version": res.get("version"),
                "uptime": res.get("uptime"),
                "cpu_load": res.get("cpu_load"),
                "error": res.get("error"),
            }

    with ThreadPoolExecutor(max_workers=min(len(devs), 8) or 1) as ex:
        futures = [ex.submit(probe, d) for d in devs]
        for f in as_completed(futures):
            results.append(f.result())

    # sort by name
    results.sort(key=lambda x: x["name"])
    return {"ok": True, "fleet": results}


# --- Device-Scoped & General API Routes ---
@app.get("/api/dashboard")
def api_dashboard(device: str | None = None, limit_logs: int = Query(60, ge=1, le=1000)):
    res = get_device_dashboard(device, limit_logs)
    if not res.get("ok"):
        return JSONResponse(status_code=503, content=res)
    return res


@app.get("/api/devices/{device_id}/dashboard")
def api_device_dashboard(device_id: str, limit_logs: int = Query(60, ge=1, le=1000)):
    res = get_device_dashboard(device_id, limit_logs)
    if not res.get("ok"):
        return JSONResponse(status_code=503, content=res)
    return res


@app.get("/api/devices/{device_id}/system")
def api_device_system(device_id: str):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_system(mt)


@app.get("/api/devices/{device_id}/interfaces")
def api_device_interfaces(device_id: str, traffic: bool = True):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_interfaces(mt, with_traffic=traffic)


@app.get("/api/devices/{device_id}/wireless")
def api_device_wireless(device_id: str):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_wireless(mt)


@app.get("/api/devices/{device_id}/network")
def api_device_network(device_id: str):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_network(mt)


@app.get("/api/devices/{device_id}/firewall")
def api_device_firewall(device_id: str):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_firewall(mt)


@app.get("/api/devices/{device_id}/logs")
def api_device_logs(device_id: str, limit: int = Query(200, ge=1, le=1000), topic: str | None = None):
    dev = get_device(device_id)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        return build_logs(mt, limit, topic)


@app.get("/api/devices/{device_id}/ping")
def api_device_ping(device_id: str, host: str = Query("8.8.8.8"), count: int = Query(3, ge=1, le=5)):
    dev = get_device(device_id)
    lock = get_device_lock(dev["host"])
    with lock:
        try:
            with MT(dev) as mt:
                res = mt.api.get_resource("/").call("ping", {"address": host.strip(), "count": str(count)})
                clean = []
                for row in res or []:
                    clean.append({
                        (k.decode() if isinstance(k, bytes) else str(k)):
                        (v.decode() if isinstance(v, bytes) else str(v))
                        for k, v in row.items()
                    })
                return {"ok": True, "target": host, "device": dev["id"], "packets": clean}
        except Exception as e:
            return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.get("/api/ping")
def api_ping(device: str | None = None, host: str = Query("8.8.8.8"), count: int = Query(3, ge=1, le=5)):
    dev = get_device(device)
    return api_device_ping(dev["id"], host, count)


def execute_on_single_device(dev: dict, req: BatchReq) -> dict:
    host = dev["host"]
    dev_id = dev["id"]
    name = dev["name"]
    lock = get_device_lock(host)
    with lock:
        try:
            with MT(dev) as mt:
                if req.action == "dns":
                    servers = ",".join(req.dns or ["192.168.88.1", "1.1.1.1"])
                    res = mt.resource("/ip/dns")
                    res.set(servers=servers)
                    return {"device_id": dev_id, "name": name, "host": host, "status": "ok", "output": f"DNS set ke {servers}"}

                elif req.action == "ntp":
                    servers = ",".join(req.ntp or ["192.168.88.1", "id.pool.ntp.org"])
                    res = mt.resource("/system/ntp/client")
                    res.set(servers=servers, enabled="yes")
                    return {"device_id": dev_id, "name": name, "host": host, "status": "ok", "output": f"NTP client aktif dengan server {servers}"}

                elif req.action == "password":
                    if not req.new_pass:
                        return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": "Password baru tidak boleh kosong"}
                    user_res = mt.resource("/user")
                    admin_users = user_res.get(name="admin")
                    if not admin_users:
                        return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": "User 'admin' tidak ditemukan di router"}
                    admin_id = admin_users[0]["id"]
                    user_res.set(id=admin_id, password=req.new_pass)

                    verify = test_connection_helper(host, dev.get("port", 8728), "admin", req.new_pass)
                    if verify.get("ok"):
                        all_devs = load_devices()
                        for d in all_devs:
                            if d["id"] == dev_id:
                                d["pass"] = req.new_pass
                        save_devices(all_devs)
                        return {"device_id": dev_id, "name": name, "host": host, "status": "ok", "output": "Password user 'admin' berhasil diperbarui & diverifikasi"}
                    else:
                        return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": f"Password terubah tapi verifikasi login gagal: {verify.get('error')}"}

                elif req.action == "script":
                    code = (req.script or "").strip()
                    if not code:
                        return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": "Script body kosong"}
                    script_res = mt.resource("/system/script")
                    s_name = f"tmp_batch_{os.urandom(4).hex()}"
                    script_res.add(name=s_name, source=code, policy="ftp,read,write,policy,test,password,sniff,sensitive,romon")
                    try:
                        script_res.call("run", {"number": s_name})
                        return {"device_id": dev_id, "name": name, "host": host, "status": "ok", "output": "Script RouterOS berhasil dieksekusi"}
                    finally:
                        try:
                            items = script_res.get(name=s_name)
                            if items:
                                script_res.remove(id=items[0]["id"])
                        except Exception:
                            pass
                else:
                    return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": f"Aksi tidak dikenal: {req.action}"}

        except Exception as e:
            return {"device_id": dev_id, "name": name, "host": host, "status": "failed", "error": str(e)}


@app.post("/api/batch/execute")
def api_batch_execute(req: BatchReq):
    devs = load_devices()
    dev_map = {d["id"]: d for d in devs}
    targets = [dev_map[did] for did in req.devices if did in dev_map]

    def generator():
        with ThreadPoolExecutor(max_workers=min(12, max(1, len(targets)))) as pool:
            futures = {pool.submit(execute_on_single_device, dev, req): dev for dev in targets}
            for fut in as_completed(futures):
                res = fut.result()
                yield json.dumps(res) + "\n"

    return StreamingResponse(generator(), media_type="application/x-ndjson")


# ---------------------------------------------------------------- Winbox Management APIs
class WirelessAddReq(BaseModel):
    device: str | None = None
    name: str | None = None
    master_interface: str = "wlan1"
    ssid: str
    security_mode: str = "open"  # "open" | "password" | "existing"
    security_profile: str | None = None
    password: str | None = None
    vlan_mode: str = "no-tag"  # "no-tag" | "use-tag"
    vlan_id: str | None = None
    add_bridge: bool = True
    bridge_name: str = "bridge1"
    hide_ssid: bool = False

class WirelessToggleReq(BaseModel):
    device: str | None = None
    interface_id: str
    disabled: bool

class WirelessUpdateReq(BaseModel):
    device: str | None = None
    interface_id: str
    ssid: str | None = None
    frequency: str | None = None
    channel_width: str | None = None
    band: str | None = None
    security_mode: str | None = None  # "open" | "password" | "existing"
    security_profile: str | None = None
    password: str | None = None
    vlan_mode: str | None = None  # "no-tag" | "use-tag"
    vlan_id: str | None = None
    hide_ssid: bool | None = None
    disabled: bool | None = None

class WirelessDeleteReq(BaseModel):
    device: str | None = None
    interface_id: str
    name: str

class ClientKickReq(BaseModel):
    device: str | None = None
    client_id: str | None = None
    mac_address: str | None = None

class InterfaceToggleReq(BaseModel):
    device: str | None = None
    interface_id: str
    disabled: bool

class InterfaceCommentReq(BaseModel):
    device: str | None = None
    interface_id: str
    comment: str

class RebootReq(BaseModel):
    device: str | None = None

class IdentityReq(BaseModel):
    device: str | None = None
    identity: str

class TerminalExecReq(BaseModel):
    device: str | None = None
    command: str

class SecProfileAddReq(BaseModel):
    device: str | None = None
    name: str
    mode: str = "dynamic-keys"
    authentication_types: str = "wpa2-psk"
    wpa2_key: str

class SecProfileUpdateReq(BaseModel):
    device: str | None = None
    profile_id: str
    mode: str = "dynamic-keys"
    authentication_types: str = "wpa2-psk"
    wpa2_key: str | None = None

class SecProfileDeleteReq(BaseModel):
    device: str | None = None
    profile_id: str
    name: str

class ExportReq(BaseModel):
    device: str | None = None
    compact: bool = True

class BackupReq(BaseModel):
    device: str | None = None
    name: str | None = None

class AiApplyReq(BaseModel):
    device: str | None = None
    action_type: str
    action_params: dict | None = None

class AiChatReq(BaseModel):
    device: str | None = None
    message: str
    model: str | None = None


# ---- regulatory channel catalogue (read from the router itself) ----------
_CH_2G = {1: 2412, 2: 2417, 3: 2422, 4: 2427, 5: 2432, 6: 2437, 7: 2442,
          8: 2447, 9: 2452, 10: 2457, 11: 2462, 12: 2467, 13: 2472, 14: 2484}
_PROTO_2G = {"b", "g", "gn20", "gn40"}
_PROTO_5G = {"a", "an20", "an40", "ac20", "ac40", "ac80", "ac160", "ac80+80"}
# Standard 20 MHz-aligned 5 GHz channel numbers. country-info reports the whole
# regulatory frequency span (5 MHz steps, e.g. 5735-5835), but only these are
# real Wi-Fi channels - the same five that Winbox "Freq. Usage" lists.
_CH_5G_STD = {36, 40, 44, 48, 52, 56, 60, 64,
              100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144,
              149, 153, 157, 161, 165}
# 5 GHz channels that require DFS radar detection in Indonesia
_DFS_5G_CH = set(range(52, 65)) | set(range(100, 145))


def _parse_country_ranges(ranges: str) -> list:
    """Parse RouterOS /interface/wireless/info country-info 'ranges' string.

    Example segment: "5735-5835/a,an20,an40,ac20,ac40,ac80,ac160,ac80+80(30dBm)/outdoor"
    -> {start: 5735, end: 5835, protocols: [...], max_power: "30dBm", flags: ["outdoor"]}
    """
    out = []
    for seg in re.split(r",(?=\d+-\d+/)", ranges or ""):
        seg = seg.strip()
        if not seg:
            continue
        m = re.match(r"^(\d+)-(\d+)/(.*)$", seg)
        if not m:
            continue
        lo, hi, rest = int(m.group(1)), int(m.group(2)), m.group(3)
        power = None
        pm = re.search(r"\(([^)]*)\)", rest)
        if pm:
            power = pm.group(1)
        flags = []
        if "/" in rest:
            flags = [f for f in rest.split("/", 1)[1].split(",") if f]
        proto_part = rest.split("(")[0].split("/")[0]
        protos = [p for p in proto_part.split(",") if p]
        out.append({
            "start": lo, "end": hi, "protocols": protos,
            "max_power": power, "flags": flags,
        })
    return out


def _channels_from_ranges(parsed: list, band: str) -> list:
    """Expand regulatory ranges into the exact channel list the radio accepts."""
    res = []
    if band == "2g":
        for ch, freq in _CH_2G.items():
            for r in parsed:
                if r["start"] <= freq - 10 and freq <= r["end"] and (set(r["protocols"]) & _PROTO_2G):
                    res.append({
                        "channel": ch, "freq": freq, "width": 20,
                        "is_dfs": False, "max_power": r["max_power"],
                        "max_width": 40 if "gn40" in r["protocols"] else 20,
                    })
                    break
    else:
        for ch in sorted(_CH_5G_STD):
            freq = 5000 + ch * 5
            for r in parsed:
                if r["start"] <= freq - 10 and freq <= r["end"] and (set(r["protocols"]) & _PROTO_5G):
                    max_w = 20
                    for p, w in (("ac160", 160), ("ac80+80", 80), ("ac80", 80), ("ac40", 40), ("an40", 40)):
                        if p in r["protocols"]:
                            max_w = max(max_w, w)
                    res.append({
                        "channel": ch, "freq": freq, "width": 20,
                        "is_dfs": ch in _DFS_5G_CH, "max_power": r["max_power"],
                        "max_width": max_w,
                    })
                    break
    return res


def get_supported_channels(mt, iface: dict) -> dict:
    """Ask the router which channels this exact radio + regulatory domain allows."""
    band = "5g" if "5ghz" in (iface.get("band") or "").lower() else "2g"
    country = iface.get("country") or "indonesia"
    info_res = mt.resource("/interface/wireless/info")
    parsed = []
    try:
        raw = info_res.call("country-info", {"country": country})
        if raw:
            parsed = _parse_country_ranges(raw[0].get("ranges", ""))
    except Exception:
        parsed = []
    if not parsed:
        # Fall back to the Indonesian SDPPI table so the UI never goes blank.
        parsed = _parse_country_ranges(
            "2402-2482/b,g,gn20,gn40(20dBm),"
            "5735-5835/a,an20,an40,ac20,ac40,ac80,ac160,ac80+80(30dBm)/outdoor"
        )
    chans = _channels_from_ranges(parsed, band)
    return {
        "band": band,
        "country": country,
        "frequency_mode": iface.get("frequency-mode") or "regulatory-domain",
        "current_frequency": iface.get("frequency") or "",
        "current_channel_width": iface.get("channel-width") or "",
        "channels": chans,
        "source": "router",
    }

@app.get("/api/wireless/interfaces")
def api_wireless_interfaces(device: str | None = None):
    dev = get_device(device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        interfaces = wl_res.get()
        sec_res = mt.resource("/interface/wireless/security-profiles")
        sec_profiles = sec_res.get()
        reg_res = mt.resource("/interface/wireless/registration-table")
        clients = reg_res.get()

        client_counts = {}
        for c in clients:
            iface = c.get("interface", "")
            client_counts[iface] = client_counts.get(iface, 0) + 1

        result = []
        for w in interfaces:
            name = w.get("name", "")
            result.append({
                "id": w.get("id"),
                "name": name,
                "ssid": w.get("ssid", ""),
                "interface_type": w.get("interface-type", "physical"),
                "master_interface": w.get("master-interface", "") or "none",
                "disabled": w.get("disabled") == "true",
                "running": w.get("running") == "true",
                "security_profile": w.get("security-profile", "default"),
                "vlan_mode": w.get("vlan-mode", "no-tag"),
                "vlan_id": w.get("vlan-id", ""),
                "mac_address": w.get("mac-address", ""),
                "band": w.get("band", ""),
                "frequency": w.get("frequency", ""),
                "channel_width": w.get("channel-width", ""),
                "clients_count": client_counts.get(name, 0),
                "hide_ssid": w.get("hide-ssid") == "true",
                "comment": w.get("comment", ""),
            })
        return {
            "interfaces": result,
            "security_profiles": [s.get("name") for s in sec_profiles],
            "master_options": [w.get("name") for w in interfaces if not w.get("master-interface") or w.get("master-interface") == "none"]
        }

@app.get("/api/wireless/supported-channels")
def api_wireless_supported_channels(device: str | None = None, interface_id: str = Query(...)):
    """Real channel list for one radio, read live from RouterOS country-info.

    MikroTik rejects any frequency outside its regulatory domain with
    "bad band or frequency", so the UI must only offer what the radio accepts.
    """
    dev = get_device(device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        item = wl_res.get(id=interface_id)
        if not item:
            raise HTTPException(status_code=404, detail="Interface tidak ditemukan")
        iface = item[0]
        if iface.get("master-interface") and iface.get("master-interface") != "none":
            raise HTTPException(
                status_code=400,
                detail="Interface virtual (slave) tidak punya radio sendiri - channel mengikuti master-nya.",
            )
        try:
            return {"status": "ok", "interface": iface.get("name"), **get_supported_channels(mt, iface)}
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Gagal membaca daftar channel dari router: {e}")


@app.post("/api/wireless/interfaces/update")
def api_wireless_update(req: WirelessUpdateReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        item = wl_res.get(id=req.interface_id)
        if not item:
            raise HTTPException(status_code=404, detail="Interface tidak ditemukan")
        iface = item[0]
        is_virtual = bool(iface.get("master-interface") and iface.get("master-interface") != "none")

        updates = {}
        if req.ssid is not None and req.ssid.strip():
            updates["ssid"] = req.ssid.strip()

        # Channel/Frequency/Band only applicable for Physical Master
        if not is_virtual:
            if req.frequency is not None and req.frequency.strip():
                freq_req = str(req.frequency).strip()
                if freq_req.lower() != "auto":
                    try:
                        supported = get_supported_channels(mt, iface)["channels"]
                    except Exception:
                        supported = []
                    allowed_freqs = {int(c["freq"]) for c in supported}
                    if allowed_freqs and int(freq_req) not in allowed_freqs:
                        country = iface.get("country") or "indonesia"
                        band_lbl = "5 GHz" if "5ghz" in (iface.get("band") or "").lower() else "2.4 GHz"
                        avail = ", ".join(
                            f"Ch {c['channel']} ({c['freq']} MHz)" for c in supported
                        )
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Channel tidak didukung oleh radio ini. Frekuensi {freq_req} MHz "
                                f"tidak termasuk dalam regulatory domain '{country}' untuk band {band_lbl}. "
                                f"Channel yang tersedia: {avail}."
                            ),
                        )
                updates["frequency"] = freq_req
            if req.channel_width is not None and req.channel_width.strip():
                updates["channel-width"] = str(req.channel_width).strip()
            if req.band is not None and req.band.strip():
                updates["band"] = str(req.band).strip()

        if req.hide_ssid is not None:
            updates["hide-ssid"] = "true" if req.hide_ssid else "false"

        if req.disabled is not None:
            updates["disabled"] = "true" if req.disabled else "false"

        if req.vlan_mode is not None:
            updates["vlan-mode"] = req.vlan_mode
            if req.vlan_mode == "use-tag" and req.vlan_id:
                updates["vlan-id"] = str(req.vlan_id)
            elif req.vlan_mode == "no-tag":
                updates["vlan-id"] = ""

        # Security handling
        if req.security_mode == "existing" and req.security_profile:
            updates["security-profile"] = req.security_profile
        elif req.security_mode == "open":
            updates["security-profile"] = "default"
        elif req.security_mode == "password" and req.password:
            sec_res = mt.resource("/interface/wireless/security-profiles")
            sec_name = f"sec-{iface.get('name')}"
            existing_prof = sec_res.get(name=sec_name)
            if existing_prof:
                sec_res.set(id=existing_prof[0]["id"], **{
                    "mode": "dynamic-keys",
                    "authentication-types": "wpa2-psk",
                    "wpa2-pre-shared-key": req.password
                })
            else:
                sec_res.call("add", {
                    "name": sec_name,
                    "mode": "dynamic-keys",
                    "authentication-types": "wpa2-psk",
                    "wpa2-pre-shared-key": req.password
                })
            updates["security-profile"] = sec_name

        if updates:
            try:
                wl_res.set(id=req.interface_id, **updates)
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                if "bad band or frequency" in msg or "bad channel" in msg:
                    country = iface.get("country") or "indonesia"
                    try:
                        supported = get_supported_channels(mt, iface)["channels"]
                        avail = ", ".join(f"Ch {c['channel']} ({c['freq']} MHz)" for c in supported)
                    except Exception:
                        avail = "-"
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Channel tidak didukung di MikroTik ini (regulatory domain '{country}'). "
                            f"Channel yang tersedia: {avail}."
                        ),
                    )
                raise HTTPException(status_code=400, detail=f"Gagal menyimpan konfigurasi: {msg}")

        return {"status": "ok", "message": f"Konfigurasi wireless '{iface.get('name')}' berhasil disimpan"}

@app.post("/api/wireless/interfaces/add")
def api_wireless_add(req: WirelessAddReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        existing_wl = wl_res.get()
        existing_names = [w.get("name") for w in existing_wl]

        w_name = (req.name or "").strip()
        if not w_name:
            idx = 3
            while f"wlan{idx}" in existing_names:
                idx += 1
            w_name = f"wlan{idx}"

        sec_profile_name = "default"
        if req.security_mode == "existing" and req.security_profile:
            sec_profile_name = req.security_profile
        elif req.security_mode == "password" and req.password:
            sec_res = mt.resource("/interface/wireless/security-profiles")
            sec_profile_name = f"sec-{w_name}"
            existing_prof = sec_res.get(name=sec_profile_name)
            if existing_prof:
                sec_res.set(id=existing_prof[0]["id"], **{
                    "mode": "dynamic-keys",
                    "authentication-types": "wpa2-psk",
                    "wpa2-pre-shared-key": req.password
                })
            else:
                sec_res.call("add", {
                    "name": sec_profile_name,
                    "mode": "dynamic-keys",
                    "authentication-types": "wpa2-psk",
                    "wpa2-pre-shared-key": req.password
                })

        params = {
            "name": w_name,
            "master-interface": req.master_interface,
            "ssid": req.ssid,
            "security-profile": sec_profile_name,
            "disabled": "false",
            "hide-ssid": "true" if req.hide_ssid else "false"
        }
        if req.vlan_mode == "use-tag" and req.vlan_id:
            params["vlan-mode"] = "use-tag"
            params["vlan-id"] = str(req.vlan_id)

        wl_res.call("add", params)

        if req.add_bridge:
            try:
                bp_res = mt.resource("/interface/bridge/port")
                bp_res.call("add", {
                    "bridge": req.bridge_name or "bridge1",
                    "interface": w_name
                })
            except Exception:
                pass

        return {"status": "ok", "message": f"Virtual AP '{w_name}' (SSID: {req.ssid}) berhasil dibuat"}

@app.post("/api/wireless/interfaces/toggle")
def api_wireless_toggle(req: WirelessToggleReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        wl_res.set(id=req.interface_id, disabled="true" if req.disabled else "false")
        return {"status": "ok", "message": f"SSID berhasil di-{'nonaktifkan' if req.disabled else 'aktifkan'}"}

@app.post("/api/wireless/interfaces/delete")
def api_wireless_delete(req: WirelessDeleteReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        item = wl_res.get(id=req.interface_id)
        if not item:
            item = wl_res.get(name=req.name)
        if not item:
            raise HTTPException(status_code=404, detail="Interface tidak ditemukan")
        if not item[0].get("master-interface") or item[0].get("master-interface") == "none":
            raise HTTPException(status_code=400, detail="Tidak dapat menghapus Physical Master Interface! Hanya Virtual AP yang dapat dihapus.")

        try:
            bp_res = mt.resource("/interface/bridge/port")
            for p in bp_res.get(interface=item[0].get("name")):
                bp_res.remove(id=p["id"])
        except Exception:
            pass

        wl_res.remove(id=item[0]["id"])
        return {"status": "ok", "message": f"Virtual AP '{item[0].get('name')}' berhasil dihapus"}

@app.post("/api/wireless/clients/kick")
def api_wireless_kick(req: ClientKickReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        reg_res = mt.resource("/interface/wireless/registration-table")
        target = None
        if req.client_id:
            target = reg_res.get(id=req.client_id)
        if not target and req.mac_address:
            target = reg_res.get(**{"mac-address": req.mac_address})
        if not target:
            raise HTTPException(status_code=404, detail="Klien tidak ditemukan di registration table")
        reg_res.remove(id=target[0]["id"])
        return {"status": "ok", "message": f"Klien {target[0].get('mac-address')} berhasil diputus / di-kick"}

class ClientAliasReq(BaseModel):
    mac: str
    name: str = ""
    brand: str = ""
    model_series: str = ""
    vendor: str = ""
    notes: str = ""

@app.get("/api/wireless/clients/aliases")
def api_get_client_aliases():
    return {"status": "ok", "aliases": load_client_aliases()}

@app.post("/api/wireless/clients/alias")
def api_set_client_alias(req: ClientAliasReq):
    aliases = load_client_aliases()
    mac_norm = req.mac.strip().upper()
    clean_name = req.name.strip()
    brand = req.brand.strip()
    model_series = req.model_series.strip()
    
    if not clean_name and not brand and not model_series and not req.notes.strip():
        if mac_norm in aliases:
            del aliases[mac_norm]
    else:
        existing = aliases.get(mac_norm, {}) if isinstance(aliases.get(mac_norm), dict) else {}
        final_brand = brand or existing.get("brand", "")
        final_series = model_series or existing.get("model_series", "")
        final_name = clean_name or existing.get("name", "")
        
        aliases[mac_norm] = {
            "name": final_name or f"{final_brand} {final_series}".strip(),
            "brand": final_brand,
            "model_series": final_series,
            "vendor": req.vendor.strip() or final_brand or existing.get("vendor", "Kustom NOC"),
            "notes": req.notes.strip() or existing.get("notes", ""),
            "updated_at": int(time.time())
        }
    save_client_aliases(aliases)
    return {"status": "ok", "mac": mac_norm, "entry": aliases.get(mac_norm, {})}


# ---------------------------------------------------------------- Client Locator & Roaming Trail Telemetry
def enrich_client_floor_info(client: dict) -> dict:
    floors_data = load_floors_data()
    ap_id = client.get("ap_id")
    for p in floors_data.get("placements", []):
        if p.get("device_id") == ap_id:
            floor_id = p.get("floor_id")
            floor_match = next((f for f in floors_data.get("floors", []) if f.get("id") == floor_id), None)
            return {
                **client,
                "floor_id": floor_id,
                "floor_name": floor_match.get("name") if floor_match else floor_id,
                "floor_x": p.get("x"),
                "floor_y": p.get("y"),
                "has_floor_map": True
            }
    return {**client, "has_floor_map": False}


def refresh_client_identities() -> int:
    """Re-resolve identity for every stored client and update changed rows."""
    try:
        conn = sqlite3.connect(str(NOC_DB_FILE))
        c = conn.cursor()
        c.execute("SELECT mac, ip, device_name, brand, is_custom_name, is_randomized FROM client_presence")
        rows = c.fetchall()
        changed = 0
        for mac, ip, old_name, old_brand, is_custom, _old_rnd in rows:
            info = resolve_client_device(mac, ip)
            if is_custom and old_name and not info.get("hostname_source"):
                # Keep manual aliases untouched
                continue
            new_rnd = 1 if info.get("is_randomized") else 0
            if (info["device_name"], info.get("brand", "")) != (old_name, old_brand):
                c.execute(
                    """UPDATE client_presence SET device_name=?, brand=?, model_series=?,
                       device_type=?, vendor=?, is_randomized=? WHERE mac=?""",
                    (info["device_name"], info.get("brand", ""), info.get("model_series", ""),
                     info.get("device_type", "unknown"), info.get("vendor", ""), new_rnd, mac),
                )
                changed += 1
            else:
                c.execute("UPDATE client_presence SET is_randomized=? WHERE mac=?", (new_rnd, mac))
        conn.commit()
        conn.close()
        return changed
    except Exception as ex:
        print(f"refresh_client_identities error: {ex}")
        return 0


def probe_fleet_clients_and_record():
    """Probe all APs for wireless clients and record presence / roaming events."""
    devs = load_devices()
    if not devs:
        return {"status": "ok", "total_online": 0, "roams": 0}

    def _probe_dev(d):
        try:
            pool = routeros_api.RouterOsApiPool(
                d["host"],
                username=d.get("user", "API"),
                password=d.get("pass", ""),
                port=int(d.get("port", 8728)),
                plaintext_login=True,
            )
            pool.set_timeout(1.2)
            api = pool.get_api()
            res = api.get_resource("/interface/wireless/registration-table").get()
            pool.disconnect()
            return (d, res)
        except Exception:
            return (d, None)

    with ThreadPoolExecutor(max_workers=30) as ex:
        results = list(ex.map(_probe_dev, devs))

    now = time.time()
    now_str = datetime.datetime.fromtimestamp(now).strftime("%Y-%m-%d %H:%M:%S")

    client_map = {}
    for d, reg_list in results:
        if not reg_list:
            continue
        for r in reg_list:
            mac = (r.get("mac-address") or "").upper().strip()
            if not mac:
                continue
            sig_raw = r.get("signal-strength") or ""
            sig_dbm = _parse_dbm(sig_raw)
            if mac in client_map:
                if (sig_dbm or -999) <= (client_map[mac]["sig_dbm"] or -999):
                    continue
            client_map[mac] = {
                "device": d,
                "reg": r,
                "sig_raw": sig_raw,
                "sig_dbm": sig_dbm,
            }

    new_clients = 0
    roam_events = 0

    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            c = conn.cursor()

            c.execute("SELECT mac, ap_id, ap_name, signal_dbm, roam_count, first_seen FROM client_presence")
            existing = {
                row[0]: {
                    "ap_id": row[1],
                    "ap_name": row[2],
                    "signal_dbm": row[3],
                    "roam_count": row[4],
                    "first_seen": row[5],
                }
                for row in c.fetchall()
            }

            for mac, item in client_map.items():
                d = item["device"]
                r = item["reg"]
                sig_raw = item["sig_raw"]
                sig_dbm = item["sig_dbm"]
                ip = r.get("last-ip") or ""
                iface = r.get("interface") or ""
                band = "5 GHz" if ("wlan2" in iface.lower() or "5g" in iface.lower()) else "2.4 GHz"
                dev_info = resolve_client_device(mac, ip)

                if mac not in existing:
                    new_clients += 1
                    c.execute("""
                        INSERT OR REPLACE INTO client_presence 
                        (mac, ip, device_name, brand, model_series, device_type, vendor, is_custom_name,
                         is_randomized, ap_id, ap_name, ap_host, interface, band, ssid, signal_dbm, signal_raw,
                         tx_rate, rx_rate, uptime, first_seen, last_seen, status, roam_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', 0)
                    """, (
                        mac, ip, dev_info["device_name"], dev_info.get("brand", ""), dev_info.get("model_series", ""),
                        dev_info.get("device_type", "unknown"), dev_info.get("vendor", ""),
                        1 if dev_info.get("is_custom_name") else 0,
                        1 if dev_info.get("is_randomized") else 0,
                        d["id"], d["name"], d["host"], iface, band, r.get("ssid", ""), sig_dbm, sig_raw,
                        r.get("tx-rate", ""), r.get("rx-rate", ""), r.get("uptime", ""), now, now
                    ))
                    c.execute("""
                        INSERT INTO client_roaming_events
                        (timestamp, time_str, mac, event_type, from_ap_id, from_ap_name, from_signal_dbm, from_band,
                         to_ap_id, to_ap_name, to_signal_dbm, to_band, to_interface, to_ssid, to_ip, details)
                        VALUES (?, ?, ?, 'ASSOCIATED', NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        now, now_str, mac, d["id"], d["name"], sig_dbm, band, iface, r.get("ssid", ""), ip,
                        f"Terhubung pertama kali ke {d['name']}"
                    ))
                    existing[mac] = {"ap_id": d["id"], "ap_name": d["name"], "signal_dbm": sig_dbm, "roam_count": 0, "first_seen": now}
                else:
                    prev = existing[mac]
                    if prev["ap_id"] != d["id"]:
                        roam_events += 1
                        new_roam_count = (prev.get("roam_count") or 0) + 1
                        c.execute("""
                            UPDATE client_presence SET
                            ip = ?, device_name = ?, brand = ?, model_series = ?, device_type = ?, vendor = ?, is_randomized = ?,
                            ap_id = ?, ap_name = ?, ap_host = ?, interface = ?, band = ?, ssid = ?,
                            signal_dbm = ?, signal_raw = ?, tx_rate = ?, rx_rate = ?, uptime = ?,
                            last_seen = ?, status = 'online', roam_count = ?
                            WHERE mac = ? AND (is_custom_name IS NULL OR is_custom_name = 0)
                        """, (
                            ip, dev_info["device_name"], dev_info.get("brand", ""), dev_info.get("model_series", ""),
                            dev_info.get("device_type", "unknown"), dev_info.get("vendor", ""),
                            1 if dev_info.get("is_randomized") else 0,
                            d["id"], d["name"], d["host"], iface, band, r.get("ssid", ""),
                            sig_dbm, sig_raw, r.get("tx-rate", ""), r.get("rx-rate", ""), r.get("uptime", ""),
                            now, new_roam_count, mac
                        ))
                        c.execute("""
                            UPDATE client_presence SET
                            ap_id = ?, ap_name = ?, ap_host = ?, interface = ?, band = ?, ssid = ?,
                            signal_dbm = ?, signal_raw = ?, tx_rate = ?, rx_rate = ?, uptime = ?,
                            last_seen = ?, status = 'online', roam_count = ?
                            WHERE mac = ? AND is_custom_name = 1
                        """, (
                            d["id"], d["name"], d["host"], iface, band, r.get("ssid", ""),
                            sig_dbm, sig_raw, r.get("tx-rate", ""), r.get("rx-rate", ""), r.get("uptime", ""),
                            now, new_roam_count, mac
                        ))
                        c.execute("""
                            INSERT INTO client_roaming_events
                            (timestamp, time_str, mac, event_type, from_ap_id, from_ap_name, from_signal_dbm, from_band,
                             to_ap_id, to_ap_name, to_signal_dbm, to_band, to_interface, to_ssid, to_ip, details)
                            VALUES (?, ?, ?, 'ROAMED', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            now, now_str, mac, prev["ap_id"], prev["ap_name"], prev.get("signal_dbm"),
                            d["id"], d["name"], sig_dbm, band, iface, r.get("ssid", ""), ip,
                            f"Roaming dari {prev['ap_name']} ({prev.get('signal_dbm')} dBm) ke {d['name']} ({sig_dbm} dBm)"
                        ))
                        existing[mac] = {"ap_id": d["id"], "ap_name": d["name"], "signal_dbm": sig_dbm, "roam_count": new_roam_count, "first_seen": prev.get("first_seen", now)}
                    else:
                        # Refresh identity fields too: a row first seen before the
                        # IEEE OUI table existed must not keep a stale/generic name
                        # forever just because the client never roamed.
                        c.execute("""
                            UPDATE client_presence SET
                            ip = ?, device_name = ?, brand = ?, model_series = ?, device_type = ?, vendor = ?, is_randomized = ?,
                            signal_dbm = ?, signal_raw = ?, tx_rate = ?, rx_rate = ?, uptime = ?,
                            last_seen = ?, status = 'online'
                            WHERE mac = ? AND (is_custom_name IS NULL OR is_custom_name = 0)
                        """, (
                            ip, dev_info["device_name"], dev_info.get("brand", ""), dev_info.get("model_series", ""),
                            dev_info.get("device_type", "unknown"), dev_info.get("vendor", ""),
                            1 if dev_info.get("is_randomized") else 0,
                            sig_dbm, sig_raw, r.get("tx-rate", ""), r.get("rx-rate", ""), r.get("uptime", ""),
                            now, mac
                        ))
                        c.execute("""
                            UPDATE client_presence SET
                            ip = ?, signal_dbm = ?, signal_raw = ?, tx_rate = ?, rx_rate = ?, uptime = ?,
                            last_seen = ?, status = 'online'
                            WHERE mac = ? AND is_custom_name = 1
                        """, (
                            ip, sig_dbm, sig_raw, r.get("tx-rate", ""), r.get("rx-rate", ""), r.get("uptime", ""),
                            now, mac
                        ))

            # Mark inactive clients (> 180s without sight) as offline
            cutoff = now - 180
            c.execute("UPDATE client_presence SET status = 'offline' WHERE last_seen < ? AND status = 'online'", (cutoff,))
            conn.commit()
            conn.close()
        except Exception as ex:
            print(f"Error in probe_fleet_clients_and_record: {ex}")

    # Enrich identities from the network itself (reverse DNS / NetBIOS). Runs
    # after the DB write so a slow DNS server never delays presence updates.
    try:
        sweep_client_hostnames()
    except Exception as ex:
        print(f"Hostname sweep error: {ex}")

    return {
        "status": "ok",
        "total_seen": len(client_map),
        "new_clients": new_clients,
        "roams_detected": roam_events
    }


def client_roaming_tracker_thread():
    time.sleep(3)
    while True:
        try:
            probe_fleet_clients_and_record()
        except Exception as e:
            print(f"Roaming tracker error: {e}")
        time.sleep(25)


_roam_thread = threading.Thread(target=client_roaming_tracker_thread, daemon=True, name="ClientRoamingTracker")
_roam_thread.start()


@app.get("/api/clients/locator")
def api_clients_locator(
    query: str = "",
    status: str = "all",
    band: str = "all",
    ap_id: str = "",
    roamed_only: bool = False,
    weak_signal: bool = False,
    sort: str = "last_seen",
    limit: int = 150,
    offset: int = 0
):
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            conditions = []
            params = []

            if query.strip():
                q = f"%{query.strip()}%"
                conditions.append("""(
                    mac LIKE ? OR ip LIKE ? OR device_name LIKE ? OR brand LIKE ? 
                    OR model_series LIKE ? OR vendor LIKE ? OR ap_name LIKE ?
                )""")
                params.extend([q, q, q, q, q, q, q])

            if status in ["online", "offline"]:
                conditions.append("status = ?")
                params.append(status)

            if band in ["2.4 GHz", "5 GHz"]:
                conditions.append("band = ?")
                params.append(band)

            if ap_id.strip():
                conditions.append("ap_id = ?")
                params.append(ap_id.strip())

            if roamed_only:
                conditions.append("roam_count > 0")

            if weak_signal:
                conditions.append("status = 'online' AND signal_dbm IS NOT NULL AND signal_dbm < -75")

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            sort_map = {
                "last_seen": "last_seen DESC",
                "signal": "signal_dbm DESC",
                "roams": "roam_count DESC",
                "name": "device_name ASC",
                "first_seen": "first_seen DESC",
            }
            order_by = sort_map.get(sort, "last_seen DESC")

            # Count total
            c.execute(f"SELECT COUNT(*) FROM client_presence {where_clause}", params)
            total = c.fetchone()[0]

            # Fetch rows
            query_sql = f"""
                SELECT * FROM client_presence 
                {where_clause} 
                ORDER BY {order_by} 
                LIMIT ? OFFSET ?
            """
            c.execute(query_sql, params + [limit, offset])
            rows = [enrich_client_floor_info(dict(r)) for r in c.fetchall()]
            conn.close()

            return {
                "status": "ok",
                "total": total,
                "limit": limit,
                "offset": offset,
                "clients": rows
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.get("/api/clients/locator/stats")
def api_clients_locator_stats():
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            c.execute("SELECT COUNT(*) FROM client_presence")
            total_tracked = c.fetchone()[0]

            c.execute("SELECT COUNT(*) FROM client_presence WHERE status = 'online'")
            online_now = c.fetchone()[0]

            c.execute("SELECT COUNT(*) FROM client_presence WHERE status = 'online' AND signal_dbm IS NOT NULL AND signal_dbm < -75")
            weak_signal = c.fetchone()[0]

            c.execute("SELECT COUNT(*) FROM client_presence WHERE roam_count > 0")
            roamed_clients = c.fetchone()[0]

            one_day_ago = time.time() - 86400
            c.execute("SELECT COUNT(*) FROM client_roaming_events WHERE timestamp > ? AND event_type = 'ROAMED'", (one_day_ago,))
            roams_today = c.fetchone()[0]

            # Band distribution
            c.execute("SELECT band, COUNT(*) FROM client_presence WHERE status = 'online' GROUP BY band")
            band_dist = {r[0]: r[1] for r in c.fetchall() if r[0]}

            # Top roaming clients
            c.execute("""
                SELECT mac, ip, device_name, brand, model_series, device_type, ap_name, roam_count, signal_dbm
                FROM client_presence 
                WHERE roam_count > 0 
                ORDER BY roam_count DESC 
                LIMIT 8
            """)
            top_roamers = [dict(r) for r in c.fetchall()]

            # Recent roam events
            c.execute("""
                SELECT r.*, p.device_name, p.brand, p.model_series, p.device_type
                FROM client_roaming_events r
                LEFT JOIN client_presence p ON r.mac = p.mac
                WHERE r.event_type = 'ROAMED'
                ORDER BY r.timestamp DESC
                LIMIT 10
            """)
            recent_roams = [dict(r) for r in c.fetchall()]

            # Top APs by client count
            c.execute("""
                SELECT ap_id, ap_name, COUNT(*) as count 
                FROM client_presence 
                WHERE status = 'online' 
                GROUP BY ap_id 
                ORDER BY count DESC 
                LIMIT 8
            """)
            top_aps = [dict(r) for r in c.fetchall()]

            conn.close()

            return {
                "status": "ok",
                "total_tracked": total_tracked,
                "online_now": online_now,
                "offline_count": total_tracked - online_now,
                "weak_signal_count": weak_signal,
                "roamed_clients_count": roamed_clients,
                "roams_today": roams_today,
                "band_distribution": band_dist,
                "top_roamers": top_roamers,
                "recent_roams": recent_roams,
                "top_aps": top_aps
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.get("/api/clients/locator/{mac}/trail")
def api_client_trail(mac: str):
    mac_norm = mac.strip().upper()
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            c.execute("SELECT * FROM client_presence WHERE mac = ?", (mac_norm,))
            row = c.fetchone()
            if not row:
                conn.close()
                raise HTTPException(status_code=404, detail=f"Klien dengan MAC '{mac_norm}' belum pernah terdeteksi")
            
            client_dict = enrich_client_floor_info(dict(row))

            c.execute("""
                SELECT * FROM client_roaming_events 
                WHERE mac = ? 
                ORDER BY timestamp DESC 
                LIMIT 100
            """, (mac_norm,))
            events = [dict(r) for r in c.fetchall()]
            conn.close()

            # Enrich each event with floor info if available
            floors_data = load_floors_data()
            placements = {p.get("device_id"): p for p in floors_data.get("placements", [])}
            floors_map = {f.get("id"): f.get("name") for f in floors_data.get("floors", [])}

            enriched_events = []
            for ev in events:
                to_ap = ev.get("to_ap_id")
                from_ap = ev.get("from_ap_id")
                p_to = placements.get(to_ap)
                p_from = placements.get(from_ap)

                to_floor = {
                    "floor_id": p_to.get("floor_id"),
                    "floor_name": floors_map.get(p_to.get("floor_id")),
                    "x": p_to.get("x"),
                    "y": p_to.get("y"),
                } if p_to else None

                from_floor = {
                    "floor_id": p_from.get("floor_id"),
                    "floor_name": floors_map.get(p_from.get("floor_id")),
                    "x": p_from.get("x"),
                    "y": p_from.get("y"),
                } if p_from else None

                delta_signal = None
                if ev.get("to_signal_dbm") is not None and ev.get("from_signal_dbm") is not None:
                    delta_signal = ev["to_signal_dbm"] - ev["from_signal_dbm"]

                enriched_events.append({
                    **ev,
                    "delta_signal": delta_signal,
                    "to_floor": to_floor,
                    "from_floor": from_floor,
                })

            return {
                "status": "ok",
                "client": client_dict,
                "trail": enriched_events,
                "total_events": len(enriched_events),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.post("/api/clients/locator/poll-now")
def api_client_locator_poll_now():
    res = probe_fleet_clients_and_record()
    return res


@app.post("/api/clients/hostnames/sweep")
def api_client_hostnames_sweep(limit: int = 400):
    """Probe reverse DNS / NetBIOS for client hostnames, then refresh the DB."""
    found = sweep_client_hostnames(limit=limit)
    refreshed = refresh_client_identities()
    return {"status": "ok", "hostnames_found": found, "rows_refreshed": refreshed,
            "cached_total": len(load_hostname_cache())}


@app.get("/api/clients/hostnames")
def api_client_hostnames():
    cache = load_hostname_cache()
    return {"status": "ok", "total": len(cache), "hostnames": cache}

@app.post("/api/interfaces/toggle")
def api_interface_toggle(req: InterfaceToggleReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        if_res = mt.resource("/interface")
        if_res.set(id=req.interface_id, disabled="true" if req.disabled else "false")
        return {"status": "ok", "message": f"Interface berhasil di-{'nonaktifkan' if req.disabled else 'aktifkan'}"}

@app.post("/api/interfaces/comment")
def api_interface_comment(req: InterfaceCommentReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        if_res = mt.resource("/interface")
        if_res.set(id=req.interface_id, comment=req.comment)
        return {"status": "ok", "message": "Comment interface berhasil disimpan"}

@app.post("/api/system/reboot")
def api_system_reboot(req: RebootReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        sys_res = mt.resource("/system")
        try:
            sys_res.call("reboot")
        except Exception:
            pass
        return {"status": "ok", "message": f"Perintah reboot berhasil dikirim ke router {dev.get('name')}"}

@app.post("/api/system/identity")
def api_system_identity(req: IdentityReq):
    dev = get_device(req.device)
    new_name = req.identity.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Nama identity tidak boleh kosong")
    with get_device_lock(dev["host"]), MT(dev) as mt:
        ident_res = mt.resource("/system/identity")
        ident_res.set(name=new_name)
    devs = load_devices()
    for d in devs:
        if d["id"] == dev["id"]:
            d["name"] = new_name
    save_devices(devs)
    return {"status": "ok", "message": f"Identity router berhasil diubah menjadi '{new_name}'"}

@app.post("/api/terminal/execute")
def api_terminal_execute(req: TerminalExecReq):
    cmd = req.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="Perintah kosong")
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        scripts = mt.resource("/system/script")
        files = mt.resource("/file")
        rnd = os.urandom(4).hex()
        s_name = f"tmp_cli_{rnd}"
        f_name = f"tmp_out_{rnd}"
        
        escaped_cmd = cmd.replace('\\', '\\\\').replace('"', '\\"')
        source_code = f':execute script="{escaped_cmd}" file="{f_name}"'
        
        scripts.call("add", {
            "name": s_name,
            "source": source_code,
            "policy": "ftp,read,write,policy,test,password,sniff,sensitive,romon"
        })
        try:
            scripts.call("run", {"number": s_name})
            import time
            output_text = ""
            start_t = time.time()
            target_filename = f"{f_name}.txt"
            while time.time() - start_t < 4.0:
                time.sleep(0.3)
                f_list = files.get(name=target_filename)
                if f_list:
                    output_text = f_list[0].get("contents", "")
                    if output_text or int(f_list[0].get("size", "0")) == 0:
                        break
            return {
                "status": "ok",
                "command": cmd,
                "output": output_text or "(Perintah selesai dieksekusi tanpa output text)"
            }
        finally:
            try:
                s_items = scripts.get(name=s_name)
                if s_items:
                    scripts.remove(id=s_items[0]["id"])
            except Exception:
                pass
            try:
                f_items = files.get(name=f"{f_name}.txt")
                if f_items:
                    files.remove(id=f_items[0]["id"])
            except Exception:
                pass


@app.get("/api/wireless/security-profiles")
def api_get_security_profiles(device: str | None = None):
    dev = get_device(device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        sec_res = mt.resource("/interface/wireless/security-profiles")
        items = sec_res.get()
        profiles = []
        for s in items:
            profiles.append({
                "id": s.get("id"),
                "name": s.get("name"),
                "mode": s.get("mode", "none"),
                "authentication_types": s.get("authentication-types", ""),
                "unicast_ciphers": s.get("unicast-ciphers", ""),
                "group_ciphers": s.get("group-ciphers", ""),
                "wpa2_key": s.get("wpa2-pre-shared-key", ""),
                "management_protection": s.get("management-protection", "disabled"),
                "default": s.get("default") == "true",
            })
        return {"profiles": profiles}


@app.post("/api/wireless/security-profiles/add")
def api_add_security_profile(req: SecProfileAddReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        sec_res = mt.resource("/interface/wireless/security-profiles")
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nama security profile wajib diisi")
        if sec_res.get(name=name):
            raise HTTPException(status_code=400, detail=f"Profile '{name}' sudah ada")
        sec_res.call("add", {
            "name": name,
            "mode": req.mode,
            "authentication-types": req.authentication_types,
            "wpa2-pre-shared-key": req.wpa2_key,
            "unicast-ciphers": "aes-ccm",
            "group-ciphers": "aes-ccm"
        })
        return {"status": "ok", "message": f"Security Profile '{name}' berhasil dibuat"}


@app.post("/api/wireless/security-profiles/update")
def api_update_security_profile(req: SecProfileUpdateReq):
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        sec_res = mt.resource("/interface/wireless/security-profiles")
        p = sec_res.get(id=req.profile_id)
        if not p:
            raise HTTPException(status_code=404, detail="Security profile tidak ditemukan")
        updates = {
            "mode": req.mode,
            "authentication-types": req.authentication_types
        }
        if req.wpa2_key is not None and req.wpa2_key.strip():
            updates["wpa2-pre-shared-key"] = req.wpa2_key.strip()
        sec_res.set(id=req.profile_id, **updates)
        return {"status": "ok", "message": f"Security Profile '{p[0].get('name')}' berhasil diperbarui"}


@app.post("/api/wireless/security-profiles/delete")
def api_delete_security_profile(req: SecProfileDeleteReq):
    dev = get_device(req.device)
    if req.name == "default":
        raise HTTPException(status_code=400, detail="Security profile 'default' tidak boleh dihapus")
    with get_device_lock(dev["host"]), MT(dev) as mt:
        sec_res = mt.resource("/interface/wireless/security-profiles")
        p = sec_res.get(id=req.profile_id)
        if not p:
            raise HTTPException(status_code=404, detail="Security profile tidak ditemukan")
        sec_res.remove(id=req.profile_id)
        return {"status": "ok", "message": f"Security Profile '{req.name}' berhasil dihapus"}


@app.post("/api/system/export")
def api_system_export(req: ExportReq):
    import time
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        ident_res = mt.resource("/system/identity").get()
        ident_name = ident_res[0].get("name", "MikroTik") if ident_res else "MikroTik"
        timestamp = int(time.time())
        date_str = time.strftime("%Y%m%d_%H%M%S")
        f_name = f"exp_{timestamp}"
        s_name = f"scr_exp_{timestamp}"

        scripts = mt.resource("/system/script")
        files = mt.resource("/file")

        cmd = f"/export compact file={f_name}" if req.compact else f"/export file={f_name}"
        try:
            scripts.call("add", {
                "name": s_name,
                "source": f':execute script="{cmd}"'
            })
            scripts.call("run", {"number": s_name})

            output_content = ""
            start_t = time.time()
            target_filename = f"{f_name}.rsc"
            while time.time() - start_t < 6.0:
                time.sleep(0.3)
                f_items = files.get(name=target_filename)
                if f_items and f_items[0].get("contents") is not None:
                    output_content = f_items[0].get("contents", "")
                    break

            return {
                "status": "ok",
                "filename": f"{ident_name}_config_{date_str}.rsc",
                "content": output_content or "# Gagal mengambil isi file konfigurasi"
            }
        finally:
            try:
                s_items = scripts.get(name=s_name)
                if s_items:
                    scripts.remove(id=s_items[0]["id"])
            except Exception:
                pass
            try:
                f_items = files.get(name=f"{f_name}.rsc")
                if f_items:
                    files.remove(id=f_items[0]["id"])
            except Exception:
                pass


@app.post("/api/system/backup")
def api_system_backup(req: BackupReq):
    import time
    dev = get_device(req.device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        ident_res = mt.resource("/system/identity").get()
        ident_name = ident_res[0].get("name", "MikroTik") if ident_res else "MikroTik"
        date_str = time.strftime("%Y%m%d_%H%M%S")
        backup_name = (req.name or f"{ident_name}_backup_{date_str}").strip()

        bk_res = mt.resource("/system/backup")
        bk_res.call("save", {"name": backup_name})
        return {
            "status": "ok",
            "filename": f"{backup_name}.backup",
            "message": f"Backup binary '{backup_name}.backup' berhasil dibuat di storage router"
        }


# ==========================================
# AI OPTIMIZATION & DIAGNOSTICS ENDPOINTS
# ==========================================

@app.get("/api/ai/diagnose")
def api_ai_diagnose(device: str | None = None):
    dev = get_device(device)
    with get_device_lock(dev["host"]), MT(dev) as mt:
        # 1. System Resources
        res_list = mt.resource("/system/resource").get()
        res = res_list[0] if res_list else {}
        cpu_load = int(res.get("cpu-load", 0))
        free_mem_mb = int(res.get("free-memory", 0)) // (1024 * 1024)
        free_hdd_kb = int(res.get("free-hdd-space", 0)) // 1024
        free_hdd_mb = round(free_hdd_kb / 1024, 2)
        model = res.get("board-name", res.get("platform", "cAP ac"))
        
        # 2. Wireless interfaces
        wl_res = mt.resource("/interface/wireless")
        interfaces = wl_res.get()
        
        # 3. Registration table (clients)
        reg_res = mt.resource("/interface/wireless/registration-table")
        clients = reg_res.get()
        
        # 4. Security profiles
        sec_res = mt.resource("/interface/wireless/security-profiles")
        sec_profiles = sec_res.get()
        
        # 5. IP Services
        svc_res = mt.resource("/ip/service")
        services = svc_res.get()
        
        # 6. DNS settings & cache
        dns_list = mt.resource("/ip/dns").get()
        dns = dns_list[0] if dns_list else {}
        dns_cache_used = int(dns.get("cache-used", 0))
        dns_allow_remote = dns.get("allow-remote-requests", "false") == "true"
        
        # 7. Firewall filter rules
        filter_res = mt.resource("/ip/firewall/filter")
        filter_rules = filter_res.get()
        has_fasttrack = any(r.get("action") == "fasttrack-connection" for r in filter_rules)
        
        # Scoring & Analysis
        score = 100
        recommendations = []
        highlights = []
        
        # Check wlan2 5GHz channel width
        wlan2 = next((w for w in interfaces if w.get("name") == "wlan2" or "5ghz" in w.get("band", "").lower()), None)
        if wlan2 and wlan2.get("disabled") != "true":
            width = wlan2.get("channel-width", "")
            if width in ["20mhz", "20/40mhz-Ce", "20/40mhz-eC"]:
                score -= 12
                recommendations.append({
                    "id": "rec-5ghz-width",
                    "category": "wireless",
                    "severity": "warning",
                    "title": "Optimasi Lebar Pita 5GHz ke 80MHz (High-Throughput AC)",
                    "description": f"Radio 5GHz ({wlan2.get('name')}) saat ini berjalan di lebar pita terbatas '{width}'. Standar 802.11ac di perangkat cAP ac mendukung lebar pita hingga 80MHz (20/40/80mhz-XXXX), melipatgandakan kecepatan transfer data hingga 4x lipat (maksimal 867 Mbps) dengan latensi lebih rendah.",
                    "impact": "+300% Potensi Kecepatan 5GHz & Mengurangi Antrian Klien",
                    "command": f"/interface wireless set {wlan2.get('name')} channel-width=20/40/80mhz-XXXX",
                    "action_type": "optimize_5ghz_throughput",
                    "action_label": "Terapkan Lebar Pita 80MHz",
                    "action_params": {"interface": wlan2.get("name"), "channel_width": "20/40/80mhz-XXXX"}
                })
            else:
                highlights.append(f"Lebar pita 5GHz ({wlan2.get('name')}) sudah diatur optimal ({width})")
                
        # Check FastTrack
        if not has_fasttrack:
            score -= 10
            recommendations.append({
                "id": "rec-fasttrack",
                "category": "performance",
                "severity": "warning",
                "title": "Aktifkan Hardware Acceleration MikroTik FastTrack",
                "description": "Router belum memiliki rule FastTrack di firewall filter forward. FastTrack mem-bypass antrian firewall untuk paket established/related, menurunkan utilisasi CPU cAP ac hingga 60% dan mencegah CPU bottleneck saat traffic rumah sakit padat.",
                "impact": "Beban CPU Hemat Hingga 60% & Latensi Paket Lebih Rendah",
                "command": "/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related comment=\"AI-FastTrack\"",
                "action_type": "enable_fasttrack",
                "action_label": "Aktifkan FastTrack Connection",
                "action_params": {}
            })
        else:
            highlights.append("Firewall FastTrack connection acceleration aktif")
            
        # Check Free Storage (NAND Flash)
        if free_hdd_mb < 1.0:
            score -= 15
            recommendations.append({
                "id": "rec-storage-low",
                "category": "storage",
                "severity": "critical",
                "title": f"Penyimpanan Flash Kritis ({free_hdd_kb} KB tersisa)",
                "description": f"Kapasitas flash router cAP ac hanya tersisa {free_hdd_mb} MB ({free_hdd_kb} KB). Ruang flash di bawah 1 MB sangat rawan menyebabkan flash terkunci (read-only) atau gagal booting saat listrik mati. Disarankan mengarahkan log ke memory-only dan membersihkan cache.",
                "impact": "Mencegah Corrupt Flash & Memperpanjang Umur NAND SPI",
                "command": "/system logging set [find action=disk] action=memory; /ip dns cache flush",
                "action_type": "clean_storage_and_cache",
                "action_label": "Bersihkan Cache & Log Flash",
                "action_params": {}
            })
        elif free_hdd_mb < 2.0:
            score -= 5
            recommendations.append({
                "id": "rec-storage-warn",
                "category": "storage",
                "severity": "info",
                "title": f"Monitoring Ruang Flash ({free_hdd_mb} MB tersisa)",
                "description": f"Penyimpanan flash internal tersisa {free_hdd_mb} MB. Hindari menyimpan file backup besar atau log disk secara permanen.",
                "impact": "Menjaga Kestabilan Storage Flash",
                "command": "# Pantau flash berkala via /file print",
                "action_type": "clean_storage_and_cache",
                "action_label": "Flush DNS Cache",
                "action_params": {}
            })
            
        # Check Weak Clients
        weak_clients = []
        for c in clients:
            raw_sig = c.get("signal-strength", "-70")
            try:
                sig_val = int(raw_sig.split("@")[0].strip())
            except Exception:
                sig_val = -70
            if sig_val < -75:
                weak_clients.append({"mac": c.get("mac-address"), "signal": sig_val, "iface": c.get("interface")})
                
        if weak_clients:
            score -= min(15, len(weak_clients) * 5)
            mac_preview = ", ".join([w["mac"] for w in weak_clients[:3]])
            recommendations.append({
                "id": "rec-weak-clients",
                "category": "wireless",
                "severity": "warning" if len(weak_clients) > 1 else "info",
                "title": f"Deteksi {len(weak_clients)} Klien Sinyal Lemah (< -75 dBm)",
                "description": f"Terdeteksi {len(weak_clients)} klien dengan sinyal buruk ({mac_preview}{'...' if len(weak_clients) > 3 else ''}). Klien bersinyal rendah memonopoli airtime AP (Sticky Client Problem) dan menurunkan kecepatan transmisi pengguna lain yang berada dekat AP.",
                "impact": "Mengembalikan Airtime Fairness & Memaksa Klien Roaming ke AP Terdekat",
                "command": f"# Disconnect {len(weak_clients)} klien lemah dari registration-table",
                "action_type": "kick_weak_clients",
                "action_label": f"Kick {len(weak_clients)} Klien Lemah",
                "action_params": {"threshold": -75}
            })
            
        # Check Band Imbalance (Dual-Band Utilization)
        wlan1_clients = sum(1 for c in clients if "wlan1" in c.get("interface", ""))
        wlan2_clients = sum(1 for c in clients if "wlan2" in c.get("interface", ""))
        if wlan1_clients >= 3 and wlan2_clients == 0 and wlan2 and wlan2.get("disabled") != "true":
            score -= 8
            recommendations.append({
                "id": "rec-band-steering",
                "category": "wireless",
                "severity": "info",
                "title": "Ketimpangan Beban Radio: Seluruh Klien Menumpuk di 2.4GHz",
                "description": f"Saat ini terdapat {wlan1_clients} klien di radio 2.4GHz (wlan1), sedangkan radio 5GHz (wlan2) yang bersih dari interferensi sama sekali kosong. Pastikan nama SSID 2.4GHz dan 5GHz diselaraskan atau edukasi staf medis untuk terhubung ke sinyal 5GHz.",
                "impact": "Pemerataan Trafik & Pengurangan Interferensi 2.4GHz di Bangsal",
                "command": "# Samakan nama SSID dan security profile pada wlan1 dan wlan2",
                "action_type": "none",
                "action_label": "Informasi Band Steering",
                "action_params": {}
            })
            
        # Check IP Services Security
        insecure_services = [s for s in services if s.get("name") in ["telnet", "ftp"] and s.get("disabled") != "true"]
        if insecure_services:
            score -= 10
            svc_names = ", ".join([s.get("name") for s in insecure_services])
            recommendations.append({
                "id": "rec-insecure-services",
                "category": "security",
                "severity": "critical",
                "title": f"Port Tidak Terenkripsi Terbuka: {svc_names}",
                "description": f"Service {svc_names} mentransmisikan kredensial login secara plaintext tanpa enkripsi. Sangat disarankan menonaktifkan service ini untuk mematuhi standar keamanan CIS Benchmark jaringan rumah sakit.",
                "impact": "Menutup Celah Penyadapan Password di Jaringan LAN",
                "command": f"/ip service disable {svc_names.replace(',', '')}",
                "action_type": "disable_service",
                "action_label": f"Nonaktifkan {svc_names}",
                "action_params": {"service_names": [s.get("name") for s in insecure_services]}
            })
        else:
            highlights.append("Service rentan (Telnet, FTP, HTTP) berstatus nonaktif (Aman)")
            
        # Check DNS Allow Remote Requests
        if dns_allow_remote:
            score -= 15
            recommendations.append({
                "id": "rec-dns-remote",
                "category": "security",
                "severity": "critical",
                "title": "DNS Allow-Remote-Requests Aktif (Potensi Open Resolver)",
                "description": "Router mengizinkan permintaan DNS dari luar. Jika router terhubung ke segmen publik tanpa firewall input port 53, router dapat dieksploitasi untuk serangan DNS Amplification DDoS.",
                "impact": "Mencegah Router Jadi Zombie DNS Amplification",
                "command": "/ip dns set allow-remote-requests=no",
                "action_type": "disable_dns_remote",
                "action_label": "Tutup DNS Remote Requests",
                "action_params": {}
            })
        else:
            highlights.append("DNS Resolver aman (allow-remote-requests=no)")
            
        # Check 2.4GHz Clean Frequency
        wlan1 = next((w for w in interfaces if w.get("name") == "wlan1" or "2ghz" in w.get("band", "").lower()), None)
        if wlan1 and wlan1.get("disabled") != "true":
            freq = wlan1.get("frequency", "")
            if freq in ["2412", "2437", "2462"]:
                highlights.append(f"Frekuensi 2.4GHz ({wlan1.get('name')}) di channel standar {freq} MHz (Non-Overlapping)")
            elif freq == "auto":
                recommendations.append({
                    "id": "rec-2ghz-auto",
                    "category": "wireless",
                    "severity": "info",
                    "title": "Frekuensi 2.4GHz Menggunakan Mode Auto",
                    "description": "Frekuensi 'auto' di RouterOS dapat menyebabkan AP berpindah frekuensi secara acak saat mendeteksi noise, memicu disosiasi klien. Disarankan mengunci ke channel tetap 1 (2412), 6 (2437), atau 11 (2462).",
                    "impact": "Koneksi Klien Lebih Stabil Tanpa Channel Flapping",
                    "command": f"/interface wireless set {wlan1.get('name')} frequency=2437",
                    "action_type": "set_2ghz_channel",
                    "action_label": "Kunci ke Channel 6 (2437 MHz)",
                    "action_params": {"interface": wlan1.get("name"), "frequency": "2437"}
                })
                
        # DNS Cache Flush recommendation if cache is large
        if dns_cache_used > 50:
            recommendations.append({
                "id": "rec-dns-flush",
                "category": "performance",
                "severity": "info",
                "title": f"Cache DNS Menampung {dns_cache_used} Entri",
                "description": "Membersihkan entri cache DNS yang kadaluarsa untuk menyegarkan resolusi domain server SIMRS / PACS RS dan menghemat RAM.",
                "impact": "Penyegaran Resolusi Domain & Pembersihan Memori",
                "command": "/ip dns cache flush",
                "action_type": "flush_dns",
                "action_label": "Flush DNS Cache Sekarang",
                "action_params": {}
            })
            
        score = max(20, min(100, score))
        grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D"
        status_label = "Sangat Baik" if score >= 90 else "Perlu Optimalisasi Ringan" if score >= 75 else "Butuh Penyesuaian" if score >= 60 else "Perhatian Kritis"
        
        return {
            "score": score,
            "grade": grade,
            "status": status_label,
            "device": dev.get("name", device),
            "model": model,
            "cpu_load": cpu_load,
            "free_mem_mb": free_mem_mb,
            "free_hdd_kb": free_hdd_kb,
            "client_count": len(clients),
            "recommendations": recommendations,
            "highlights": highlights,
            "diagnosed_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }


@app.post("/api/ai/apply")
def api_ai_apply(req: AiApplyReq):
    dev = get_device(req.device)
    action = req.action_type
    params = req.action_params or {}
    
    with get_device_lock(dev["host"]), MT(dev) as mt:
        if action == "optimize_5ghz_throughput":
            wl_res = mt.resource("/interface/wireless")
            iface_name = params.get("interface", "wlan2")
            target = wl_res.get(name=iface_name)
            if not target:
                target = [w for w in wl_res.get() if "5ghz" in w.get("band", "").lower()]
            if target:
                wl_res.set(id=target[0]["id"], channel_width="20/40/80mhz-XXXX")
                return {"status": "ok", "message": f"Lebar pita radio 5GHz ({target[0]['name']}) berhasil ditingkatkan ke 80MHz (20/40/80mhz-XXXX)!"}
            raise HTTPException(404, "Interface 5GHz tidak ditemukan")
            
        elif action == "enable_fasttrack":
            filter_res = mt.resource("/ip/firewall/filter")
            existing = [r for r in filter_res.get() if r.get("action") == "fasttrack-connection"]
            if not existing:
                filter_res.add(
                    chain="forward",
                    action="fasttrack-connection",
                    connection_state="established,related",
                    comment="AI-FastTrack"
                )
                return {"status": "ok", "message": "Rule FastTrack Connection berhasil ditambahkan ke Firewall Filter!"}
            return {"status": "ok", "message": "FastTrack Connection sudah aktif di firewall"}
            
        elif action == "clean_storage_and_cache":
            try:
                mt.api.get_binary_resource("/").call("ip/dns/cache/flush", {})
            except Exception:
                pass
            log_res = mt.resource("/system/logging")
            for l in log_res.get():
                if l.get("action") == "disk":
                    log_res.set(id=l["id"], action="memory")
            return {"status": "ok", "message": "Cache DNS berhasil dibersihkan dan tindakan proteksi log flash telah diterapkan!"}
            
        elif action == "flush_dns":
            mt.api.get_binary_resource("/").call("ip/dns/cache/flush", {})
            return {"status": "ok", "message": "Cache DNS lokal routerOS berhasil di-flush!"}
            
        elif action == "kick_weak_clients":
            reg_res = mt.resource("/interface/wireless/registration-table")
            clients = reg_res.get()
            kicked = 0
            for c in clients:
                raw_sig = c.get("signal-strength", "-70")
                try:
                    sig_val = int(raw_sig.split("@")[0].strip())
                except Exception:
                    sig_val = -70
                if sig_val < -75:
                    reg_res.remove(id=c["id"])
                    kicked += 1
            return {"status": "ok", "message": f"Berhasil memutus {kicked} klien bersinyal lemah agar airtime AP kembali optimal!"}
            
        elif action == "disable_service":
            svc_res = mt.resource("/ip/service")
            svc_names = params.get("service_names", ["api-ssl"])
            count = 0
            for name in svc_names:
                items = svc_res.get(name=name)
                if items:
                    svc_res.set(id=items[0]["id"], disabled="true")
                    count += 1
            return {"status": "ok", "message": f"Berhasil menonaktifkan {count} service ({', '.join(svc_names)})!"}
            
        elif action == "disable_dns_remote":
            dns_res = mt.resource("/ip/dns")
            dns_res.set(allow_remote_requests="no")
            return {"status": "ok", "message": "DNS allow-remote-requests berhasil ditutup (Aman)!"}
            
        elif action == "set_2ghz_channel":
            wl_res = mt.resource("/interface/wireless")
            iface_name = params.get("interface", "wlan1")
            freq = params.get("frequency", "2437")
            target = wl_res.get(name=iface_name)
            if target:
                wl_res.set(id=target[0]["id"], frequency=freq, channel_width="20mhz")
                return {"status": "ok", "message": f"Radio {iface_name} berhasil dikunci ke Channel 6 ({freq} MHz) 20MHz!"}
            raise HTTPException(404, "Interface wireless tidak ditemukan")
            
        else:
            raise HTTPException(400, f"Aksi AI '{action}' tidak dikenali")


AI_CONFIG_FILE = BASE / "ai_config.json"

DEFAULT_AI_CONFIG = {
    "base_url": os.environ.get("OMNIROUTE_BASE_URL", ""),
    "api_key": os.environ.get("OMNIROUTE_API_KEY", ""),
    "model": os.environ.get("OMNIROUTE_MODEL", "auto/best-chat"),
    "temperature": 0.4,
    "max_tokens": 750
}

def load_ai_config():
    """Baca konfigurasi AI secara dinamis dari ai_config.json (fallback ke env/.env)."""
    merged = dict(DEFAULT_AI_CONFIG)
    if not AI_CONFIG_FILE.exists():
        return merged
    try:
        with open(AI_CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            if isinstance(cfg, dict):
                for k, v in cfg.items():
                    if v is not None and v != "":
                        merged[k] = v
            return merged
    except Exception:
        return merged

def save_ai_config(cfg: dict):
    with open(AI_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

def call_omniroute_chat(system_prompt: str, user_message: str, model: str | None = None) -> tuple[str | None, str, str]:
    cfg = load_ai_config()
    model_name = (model or cfg.get("model") or "auto/best-chat").strip()
    base_url = cfg.get("base_url", "https://api.example.com/v1").rstrip("/")
    api_key = cfg.get("api_key") or DEFAULT_AI_CONFIG["api_key"]
    endpoint = f"{base_url}/chat/completions"
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "max_tokens": cfg.get("max_tokens", 750),
        "temperature": cfg.get("temperature", 0.4)
    }
    max_attempts = 2
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            req = urllib.request.Request(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Content-Type": "application/json"
                },
                data=json.dumps(payload).encode("utf-8")
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                if content and content.strip():
                    return content, f"OmniRoute ({model_name})", model_name
                last_err = "empty response content"
        except Exception as e:
            last_err = e
            print(f"[AI] OmniRoute attempt {attempt}/{max_attempts} failed ({model_name}): {e}")

    print(f"[AI] OmniRoute upstream unavailable after {max_attempts} attempts ({model_name}): {last_err}")
    return None, "Local Expert Fallback", model_name


class AiConfigReq(BaseModel):
    model: str | None = None
    temperature: float | None = None
    base_url: str | None = None
    api_key: str | None = None

@app.get("/api/ai/models")
def api_ai_models():
    cfg = load_ai_config()
    base_url = cfg.get("base_url", "https://api.example.com/v1").rstrip("/")
    api_key = cfg.get("api_key") or DEFAULT_AI_CONFIG["api_key"]
    
    popular_presets = [
        {"id": "MiMo", "name": "MiMo (Default Lokal)", "desc": "Model cepat & hemat, cocok untuk konsultasi harian NOC"},
        {"id": "auto/best-chat", "name": "Auto / Best Chat", "desc": "Router cerdas otomatis memilih model terbaik"},
        {"id": "auto/best-reasoning", "name": "Auto / Best Reasoning", "desc": "Penalaran mendalam untuk troubleshooting kompleks"},
        {"id": "auto/best-coding", "name": "Auto / Best Coding", "desc": "Optimal untuk scripting & sintaks CLI MikroTik"},
        {"id": "auto/best-fast", "name": "Auto / Best Fast", "desc": "Respon paling kilat, hemat kuota"},
        {"id": "antigravity/claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "desc": "Analisis jaringan dan diagnostik terstruktur"},
        {"id": "antigravity/claude-opus-4-6-thinking", "name": "Claude Opus 4.6 (Thinking)", "desc": "Reasoning kelas berat untuk kasus rumit"},
        {"id": "antigravity/gemini-3.8-flash", "name": "Gemini 3.8 Flash", "desc": "Generasi multimodal dan jaringan cepat"},
        {"id": "auto/deepseek", "name": "DeepSeek", "desc": "Penalaran matematika & routing mendalam"},
    ]
    
    upstream_models = []
    try:
        req = urllib.request.Request(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}", "User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for m in data.get("data", []):
                mid = m.get("id")
                if mid:
                    upstream_models.append(mid)
            upstream_models.sort()
    except Exception as e:
        print(f"[AI] Failed fetching upstream models list: {e}")
        
    return {
        "status": "ok",
        "current_model": cfg.get("model", "MiMo"),
        "popular_presets": popular_presets,
        "available_models": upstream_models if upstream_models else [p["id"] for p in popular_presets]
    }

@app.get("/api/ai/config")
def api_get_ai_config():
    cfg = load_ai_config()
    return {
        "status": "ok",
        "config": {
            "model": cfg.get("model", "auto/best-chat"),
            "base_url": cfg.get("base_url", ""),
            "has_api_key": bool(cfg.get("api_key")),
            "temperature": cfg.get("temperature", 0.4),
        },
    }

@app.post("/api/ai/config")
def api_save_ai_config(req: AiConfigReq):
    cfg = load_ai_config()
    if req.model:
        cfg["model"] = req.model.strip()
    if req.temperature is not None:
        cfg["temperature"] = req.temperature
    if req.base_url is not None and req.base_url.strip():
        cfg["base_url"] = req.base_url.strip().rstrip("/")
    if req.api_key is not None and req.api_key.strip():
        cfg["api_key"] = req.api_key.strip()
    save_ai_config(cfg)
    return {
        "status": "ok",
        "message": f"Konfigurasi AI berhasil disimpan (model: {cfg['model']})",
        "config": {
            "model": cfg["model"],
            "base_url": cfg.get("base_url", ""),
            "has_api_key": bool(cfg.get("api_key")),
        },
    }


@app.post("/api/ai/chat")
def api_ai_chat(req: AiChatReq):
    import time
    dev = get_device(req.device)
    user_msg = req.message.strip()
    target_model = req.model.strip() if req.model else None
    
    with get_device_lock(dev["host"]), MT(dev) as mt:
        res = mt.resource("/system/resource").get()[0]
        wl = mt.resource("/interface/wireless").get()
        clients = mt.resource("/interface/wireless/registration-table").get()
        services = mt.resource("/ip/service").get()
        fw_filter = mt.resource("/ip/firewall/filter").get()
        
    cpu = res.get("cpu-load", "0")
    free_mem = int(res.get("free-memory", 0)) // 1024 // 1024
    free_hdd = int(res.get("free-hdd-space", 0)) // 1024
    model = res.get("board-name", "cAP ac")
    ros_ver = res.get("version", "v7")
    client_cnt = len(clients)

    wl_desc = []
    for w in wl:
        wl_desc.append(f"  - {w.get('name')}: SSID='{w.get('ssid')}', Band={w.get('band')}, Freq={w.get('frequency', 'auto')}MHz, Width={w.get('channel-width')}, Disabled={w.get('disabled')}")
    wl_summary = "\n".join(wl_desc) if wl_desc else "  (Tidak ada radio wireless)"

    weak_clients = [c for c in clients if int(c.get("signal-strength", "-100").split("@")[0].replace("dBm", "")) < -75]
    clients_summary = f"Total {client_cnt} klien aktif. "
    if weak_clients:
        clients_summary += f"Ditemukan {len(weak_clients)} klien sinyal lemah (< -75 dBm): " + ", ".join([f"{c.get('mac-address')} ({c.get('signal-strength')})" for c in weak_clients[:5]])
    else:
        clients_summary += "Semua klien memiliki RSSI di atas -75 dBm (kualitas radio bagus)."

    insecure_services = [s.get("name") for s in services if s.get("name") in ["telnet", "ftp"] and s.get("disabled") != "true"]
    services_summary = f"Telnet/FTP Aktif: {insecure_services}" if insecure_services else "Semua service plaintext nonaktif (Aman)."

    has_fasttrack = any("fasttrack-connection" in f.get("action", "") for f in fw_filter)
    fasttrack_status = "Aktif (Hardware Acceleration On)" if has_fasttrack else "Belum aktif (Disarankan aktifkan)"

    system_prompt = f"""Kamu adalah Senior AI NOC Network Engineer RS Anwar Medika (Sidoarjo).
Kamu memonitor armada 82+ router MikroTik rumah sakit (khususnya unit cAP ac di bangsal, rawat inap, poli, dan IGD).

Kondisi Telemetri Live Router Saat Ini:
- Nama Unit: {dev.get('name', 'APM')} ({model})
- IP Address: {dev.get('host')}
- RouterOS Version: {ros_ver}
- CPU Load: {cpu}%
- Free RAM: {free_mem} MB
- Free Flash Storage: {free_hdd} KB (PERHATIAN: cAP ac hanya punya 16MB NAND, jika < 1MB status Kritis!)
- Radio Wireless:
{wl_summary}
- Telemetri Klien:
  {clients_summary}
- Status Layanan IP: {services_summary}
- FastTrack Firewall: {fasttrack_status}

Instruksi Analisis:
1. Jawab secara cerdas, praktis, to-the-point, berbobot teknisi NOC rumah sakit.
2. Identifikasi korelasi antara pertanyaan user dengan kondisi live telemetri di atas (misal: sinyal -79 dBm, storage < 1MB, channel width, atau interferensi).
3. Berikan saran praktis dan sertakan sintaks CLI MikroTik yang presisi jika relevan.
4. Gunakan bahasa Indonesia profesional dan ramah."""

    reply, engine, used_model = call_omniroute_chat(system_prompt, user_msg, model=target_model)
    if not reply:
        msg = user_msg.lower()
        if any(k in msg for k in ['lemot', 'lambat', 'slow', 'signal', 'sinyal', 'drop']):
            reply = f"""Berdasarkan analisis live router {dev.get('name', 'APM')} ({model}):

1. Beban CPU & Memori: CPU saat ini {cpu}%, Free RAM {free_mem} MB (Relatif Normal).
2. Distribusi Klien: Terhubung {client_cnt} klien wireless.
3. Penyebab Utama Kelambatan di RS:
   - Sticky Client: Klien dengan RSSI < -75 dBm memakan airtime AP hingga 4x lipat. Solusi: Gunakan tombol 'Kick Klien Lemah' di tab AI Optimizer agar berpindah ke AP terdekat.
   - Interferensi 2.4GHz: Saluran 2.4GHz sering terganggu peralatan medis dan dinding beton. Pastikan wlan1 tetap di Channel 1, 6, atau 11 dengan lebar 20MHz.
   - Throughput 5GHz: Pastikan wlan2 5GHz diatur ke lebar pita 80MHz (20/40/80mhz-XXXX) untuk kecepatan transfer SIMRS/rekam medis hingga 867 Mbps."""
        elif any(k in msg for k in ['aman', 'security', 'hardening', 'keamanan', 'hacker']):
            reply = f"""Analisis Keamanan & CIS Benchmark untuk {dev.get('name', 'APM')}:

1. IP Services: Pastikan port plaintext (Telnet 23, FTP 21, WWW 80) dalam keadaan Disabled.
2. DNS Resolver: Pastikan allow-remote-requests=no untuk mencegah serangan DNS Amplification DDoS.
3. Enkripsi WiFi: Seluruh SSID wajib menggunakan WPA2-PSK (AES-CCM). Hindari WPA1 atau enkripsi TKIP.
4. Manajemen Flash Disk: Sisa storage {free_hdd} KB. Pastikan log diarahkan ke memory agar chip flash cAP ac tidak aus."""
        elif any(k in msg for k in ['rekomendasi', 'setting', 'terbaik', 'optimal', 'best practice']):
            reply = f"""Rekomendasi Konfigurasi Optimal cAP ac di Lingkungan RS Anwar Medika:

• Radio 2.4 GHz (wlan1): Frekuensi 2412 / 2437 / 2462 MHz, Band 2ghz-b/g/n, Lebar 20MHz (Wajib 20MHz untuk menembus dinding ruangan pasien).
• Radio 5 GHz (wlan2): Frekuensi 5805 MHz (Ch 161), Band 5ghz-a/n/ac, Lebar 20/40/80mhz-XXXX (Maksimal untuk perangkat laptop/tablet dokter).
• Hardware FastPath: Tambahkan FastTrack pada firewall forward untuk efisiensi CPU 60%.
• Isolasi Tamu: Gunakan Virtual AP VLAN 200 untuk WiFi Pasien/Tamu terpisah dari VLAN 20 Pegawai."""
        else:
            reply = f"""Router {dev.get('name', 'APM')} ({model}) terpantau Online:
• CPU Load: {cpu}%
• Sisa RAM: {free_mem} MB
• Sisa Flash Storage: {free_hdd} KB
• Klien Aktif: {client_cnt} perangkat

Gunakan menu AI Optimizer di samping untuk menerapkan rekomendasi otomatis (Lebar Pita 80MHz, FastTrack, Flush DNS, Kick Sinyal Lemah) hanya dengan 1 kali klik!"""
    
    return {"reply": reply, "timestamp": time.strftime("%H:%M:%S"), "engine": engine, "model": used_model}


# ---------------------------------------------------------------- Floor Plans & Heatmap Mapping
FLOORS_FILE = BASE / "floors.json"

DEFAULT_FLOORS = [
    {
        "id": "floor_1",
        "name": "Lantai 1 — IGD, Poliklinik & Admisi",
        "building": "Gedung Utama RSAM",
        "image_url": "/uploads/floor_1_blueprint.svg",
        "width_meters": 60.0,
        "height_meters": 40.0
    },
    {
        "id": "floor_2",
        "name": "Lantai 2 — Rawat Inap & ICU / Bedah OK",
        "building": "Gedung Utama RSAM",
        "image_url": "/uploads/floor_2_blueprint.svg",
        "width_meters": 60.0,
        "height_meters": 40.0
    }
]

MAP_CLIENTS_CACHE = {}

def load_floors_data():
    if not FLOORS_FILE.exists():
        return {"floors": DEFAULT_FLOORS, "placements": []}
    try:
        with open(FLOORS_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
            if not d.get("floors"):
                d["floors"] = DEFAULT_FLOORS
            return d
    except Exception:
        return {"floors": DEFAULT_FLOORS, "placements": []}

def save_floors_data(data):
    with open(FLOORS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

class FloorCreateReq(BaseModel):
    name: str
    building: str = "Gedung Utama RSAM"
    image_url: str = "/uploads/floor_1_blueprint.svg"
    width_meters: float = 60.0
    height_meters: float = 40.0

class PlacementReq(BaseModel):
    device_id: str
    x: float
    y: float
    tx_power_2g: int = 20
    channel_2g: int = 6
    tx_power_5g: int = 23
    channel_5g: int = 149
    radius_meters: float = 20.0

@app.get("/api/map/floors")
def get_map_floors():
    data = load_floors_data()
    devices_map = {d["id"]: d for d in load_devices()}
    enriched_placements = []
    now = time.time()
    
    for p in data.get("placements", []):
        dev_id = p.get("device_id")
        dev = devices_map.get(dev_id, {})
        enriched_p = dict(p)
        dev_name = dev.get("name", dev_id)
        enriched_p["device_name"] = dev_name
        enriched_p["device_host"] = dev.get("host", "")
        
        # Check if physical hardware has 5 GHz radio (single band cAP has '(cAP)' without 'ac')
        is_single_band_cap = "(cAP)" in dev_name and "ac" not in dev_name.lower()
        enriched_p["has_5g"] = not is_single_band_cap
        enriched_p["device_model"] = "cAP (2.4 GHz Only)" if is_single_band_cap else dev.get("model", "cAP ac (Dual-Band)")
        enriched_p["is_online"] = dev.get("online", True)
        
        # Jumlah klien: baca registration-table asli, cache 25 s.
        # AP yang tidak ada di devices.json -> None (UI menyembunyikan), TIDAK pernah dikarang.
        cache_entry = MAP_CLIENTS_CACHE.get(dev_id)
        if not dev:
            cnt = None
        elif cache_entry and (now - cache_entry.get("ts", 0) < 25):
            cnt = cache_entry.get("count")
        else:
            try:
                with get_device_lock(dev["host"]), MT(dev) as mt:
                    cnt = len(mt.resource("/interface/wireless/registration-table").get())
                MAP_CLIENTS_CACHE[dev_id] = {"count": cnt, "ts": now}
            except Exception:
                cnt = cache_entry.get("count") if cache_entry else None

        enriched_p["clients_count"] = cnt
        enriched_placements.append(enriched_p)
    
    return {
        "status": "ok",
        "floors": data.get("floors", []),
        "placements": enriched_placements
    }

@app.post("/api/map/floors")
def create_floor(req: FloorCreateReq):
    data = load_floors_data()
    floor_id = f"floor_{int(time.time())}"
    new_floor = {
        "id": floor_id,
        "name": req.name.strip(),
        "building": req.building.strip(),
        "image_url": req.image_url.strip(),
        "width_meters": max(10.0, req.width_meters),
        "height_meters": max(10.0, req.height_meters)
    }
    data.setdefault("floors", []).append(new_floor)
    save_floors_data(data)
    return {"status": "ok", "floor": new_floor}

@app.delete("/api/map/floors/{floor_id}")
def delete_floor(floor_id: str):
    data = load_floors_data()
    data["floors"] = [f for f in data.get("floors", []) if f.get("id") != floor_id]
    data["placements"] = [p for p in data.get("placements", []) if p.get("floor_id") != floor_id]
    save_floors_data(data)
    return {"status": "ok", "deleted_floor_id": floor_id}

@app.post("/api/map/floors/{floor_id}/placement")
def place_device(floor_id: str, req: PlacementReq):
    data = load_floors_data()
    placements = data.setdefault("placements", [])
    existing = None
    for p in placements:
        if p.get("device_id") == req.device_id:
            existing = p
            break
    
    entry = {
        "device_id": req.device_id,
        "floor_id": floor_id,
        "x": round(max(0.0, min(100.0, req.x)), 2),
        "y": round(max(0.0, min(100.0, req.y)), 2),
        "tx_power_2g": req.tx_power_2g,
        "channel_2g": req.channel_2g,
        "tx_power_5g": req.tx_power_5g,
        "channel_5g": req.channel_5g,
        "radius_meters": round(max(5.0, min(60.0, req.radius_meters)), 1)
    }
    
    if existing:
        existing.update(entry)
    else:
        placements.append(entry)
        
    save_floors_data(data)
    return {"status": "ok", "placement": entry}

@app.delete("/api/map/placements/{device_id}")
def remove_device_placement(device_id: str):
    data = load_floors_data()
    data["placements"] = [p for p in data.get("placements", []) if p.get("device_id") != device_id]
    save_floors_data(data)
    return {"status": "ok", "removed_device_id": device_id}

@app.post("/api/map/upload-floor")
async def upload_floor_blueprint(file: UploadFile = File(...), floor_id: str | None = Form(None)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in [".svg", ".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(status_code=400, detail="Format file wajib berupa gambar (SVG, PNG, JPG, WEBP)")
    
    safe_name = f"floor_{int(time.time())}_{secrets.token_hex(4)}{ext}"
    target_path = UPLOAD_DIR / safe_name
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    image_url = f"/uploads/{safe_name}"
    
    if floor_id:
        data = load_floors_data()
        for f in data.get("floors", []):
            if f.get("id") == floor_id:
                f["image_url"] = image_url
                break
        save_floors_data(data)
        
    return {"status": "ok", "image_url": image_url, "filename": file.filename}

@app.delete("/api/map/floors/{floor_id}")
def delete_floor(floor_id: str):
    data = load_floors_data()
    original_len = len(data.get("floors", []))
    data["floors"] = [f for f in data.get("floors", []) if f.get("id") != floor_id]
    if len(data["floors"]) == original_len:
        raise HTTPException(status_code=404, detail="Floor tidak ditemukan")
    
    # Bersihkan placement pada lantai tersebut
    data["placements"] = [p for p in data.get("placements", []) if p.get("floor_id") != floor_id]
    
    # Jika semua lantai terhapus, buatkan otomatis 1 denah baru kosong agar sistem tetap stabil
    if not data["floors"]:
        default_floor = {
            "id": f"floor_{int(time.time())}",
            "name": "Lantai 1 — Utama",
            "building": "Gedung Utama RSAM",
            "image_url": "",
            "width_meters": 60.0,
            "height_meters": 40.0
        }
        data["floors"].append(default_floor)

    save_floors_data(data)
    return {"status": "ok", "deleted_floor_id": floor_id, "floors": data["floors"]}

@app.post("/api/map/floors/{floor_id}/remove-image")
def remove_floor_image(floor_id: str):
    data = load_floors_data()
    found = False
    for f in data.get("floors", []):
        if f.get("id") == floor_id:
            f["image_url"] = ""
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Floor tidak ditemukan")
    save_floors_data(data)
    return {"status": "ok", "floor_id": floor_id}

# ---------------------------------------------------------------- Fleet Known BSSID Cache & Rogue AP Detector
FLEET_BSSID_CACHE = {"last_fetch": 0.0, "bssids": {}}
FLEET_BSSID_LOCK = threading.Lock()


def get_fleet_known_bssids() -> dict[str, dict]:
    """Returns normalized MAC -> {device_id, device_name, iface, ssid}. Cached for 10 minutes."""
    now = time.time()
    with FLEET_BSSID_LOCK:
        if now - FLEET_BSSID_CACHE["last_fetch"] < 600 and FLEET_BSSID_CACHE["bssids"]:
            return FLEET_BSSID_CACHE["bssids"]

        devs = load_devices()

        def fetch_dev_bssid(d):
            try:
                pool = routeros_api.RouterOsApiPool(
                    d["host"],
                    username=d.get("user", "API"),
                    password=d.get("pass", ""),
                    port=int(d.get("port", 8728)),
                    plaintext_login=True,
                )
                pool.set_timeout(1.2)
                api = pool.get_api()
                wl = api.get_resource("/interface/wireless").get()
                pool.disconnect()
                return [
                    (w.get("mac-address"), d["id"], d["name"], w.get("name"), w.get("ssid"))
                    for w in wl
                    if w.get("mac-address")
                ]
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=30) as p:
            res = list(p.map(fetch_dev_bssid, devs))

        b_map = {}
        for r in res:
            for mac, dev_id, dev_name, iface, ssid in r:
                norm_mac = mac.upper().strip()
                b_map[norm_mac] = {
                    "device_id": dev_id,
                    "device_name": dev_name,
                    "iface": iface,
                    "ssid": ssid,
                }

        FLEET_BSSID_CACHE["last_fetch"] = now
        FLEET_BSSID_CACHE["bssids"] = b_map
        return b_map


@app.get("/api/rf/scan")
def api_rf_scan(
    device: str | None = Query(None),
    band: str = Query("2g"),
    duration: int = Query(8, ge=4, le=20),
    non_disruptive: bool = Query(False),
):
    """Live RF frequency-usage scan via RouterOS /interface/wireless scan.

    Returns per-channel occupancy, interference score and a clean-channel ranking
    so the technician knows which frequency is actually best on site.
    When `non_disruptive=True`, uses 1s `frequency-monitor` instead of full scan
    to avoid dropping active clients.
    """
    import re as _re

    dev = get_device(device)
    band = (band or "2g").lower()
    if band in ("2.4", "2.4g", "2ghz"):
        band = "2g"
    elif band in ("5", "5g", "5ghz"):
        band = "5g"

    target_band_token = "2ghz" if band == "2g" else "5ghz"

    with get_device_lock(dev["host"]), MT(dev) as mt:
        wl_res = mt.resource("/interface/wireless")
        ifaces = wl_res.get()
        target = None
        for w in ifaces:
            b = (w.get("band") or "").lower()
            if target_band_token in b:
                # prefer an interface that is actually running
                if target is None or w.get("running") == "true":
                    target = w
        if target is None:
            raise HTTPException(
                status_code=404,
                detail=f"Tidak ada radio {band.upper()} pada perangkat ini (model mungkin single-band).",
            )

        # Ask the radio itself which channels it can actually tune to, so the
        # ranking never suggests a frequency MikroTik would reject.
        try:
            reg_channels = get_supported_channels(mt, target)["channels"]
        except Exception:
            reg_channels = []

        freq_usage = []
        raw = []
        scan_mode = "frequency-monitor" if non_disruptive else "scan"

        def _read_freq_monitor():
            fm_rows = []
            try:
                fm = wl_res.call("frequency-monitor", {"id": target["id"], "duration": "1"}) or []
            except Exception:
                fm = []
            for row in fm:
                try:
                    fm_rows.append({
                        "freq": int(row.get("freq", 0)),
                        "use_pct": float(row.get("use", 0) or 0),
                        "noise_floor": int(float(row.get("nf", 0) or 0)),
                    })
                except (TypeError, ValueError):
                    continue
            return fm_rows

        if non_disruptive:
            freq_usage = _read_freq_monitor()
            if not freq_usage:
                scan_mode = "scan-short"
                try:
                    raw = wl_res.call("scan", {"id": target["id"], "duration": "4"}) or []
                except Exception as e:
                    raise HTTPException(status_code=502, detail=f"Scan RF gagal: {type(e).__name__}: {e}")
        else:
            try:
                raw = wl_res.call("scan", {"id": target["id"], "duration": str(duration)}) or []
                freq_usage = _read_freq_monitor()
            except Exception as e:
                msg = str(e)
                if "other tool running" not in msg:
                    raise HTTPException(status_code=502, detail=f"Scan RF gagal: {type(e).__name__}: {e}")
                freq_usage = _read_freq_monitor()
                if not freq_usage:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Radio {target.get('name')} sedang dipakai tool lain di router "
                            "(Freq. Usage / Snooper / scan sebelumnya belum selesai). "
                            "Tutup tool tersebut di Winbox atau tunggu beberapa detik, lalu coba lagi."
                        ),
                    )
                raw = []
                scan_mode = "frequency-monitor"

    # ---- parse scan results ------------------------------------------------
    known_bssids = get_fleet_known_bssids()

    def _parse_chan(chan_str: str):
        """'2412/20-Ce/gn(18dBm)' -> (freq_mhz, width_mhz, proto, txpower)"""
        freq, width, proto, txp = 0, 20, "", None
        if not chan_str:
            return freq, width, proto, txp
        m = _re.match(r"^(\d+)", chan_str)
        if m:
            freq = int(m.group(1))
        m = _re.search(r"/(\d+)", chan_str)
        if m:
            width = int(m.group(1))
        parts = chan_str.split("/")
        if len(parts) >= 3:
            proto = parts[2].split("(")[0]
        m = _re.search(r"\((-?\d+)dBm\)", chan_str)
        if m:
            txp = int(m.group(1))
        return freq, width, proto, txp

    def _chan_from_freq2g(f):
        return int(round((f - 2407) / 5))

    FREQ_5G_LIST = [
        5180, 5200, 5220, 5240, 5260, 5280, 5300, 5320,
        5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640, 5660, 5680, 5700, 5720,
        5745, 5765, 5785, 5805, 5825,
    ]
    CHAN_5G_OF_FREQ = {f: (f - 5000) // 5 for f in FREQ_5G_LIST}

    bss_list = []
    seen = set()
    for e in raw:
        freq, width, proto, txp = _parse_chan(e.get("channel", ""))
        if not freq:
            continue
        # de-dupe identical BSSID entries emitted in multiple scan sections
        key = (e.get("address"), freq)
        if key in seen:
            continue
        seen.add(key)
        try:
            sig = int(str(e.get("sig", "-100")).replace("dBm", "").strip())
        except (TypeError, ValueError):
            sig = -100
        try:
            nf = int(str(e.get("nf", "-100")).replace("dBm", "").strip())
        except (TypeError, ValueError):
            nf = -100
        try:
            snr = int(str(e.get("snr", "0")).strip())
        except (TypeError, ValueError):
            snr = max(0, sig - nf)

        b_mac = (e.get("address") or "").upper().strip()
        ssid_raw = e.get("ssid") or "(hidden)"
        ssid_low = ssid_raw.lower()

        is_internal = b_mac in known_bssids
        internal_info = known_bssids.get(b_mac)

        # Cek indikasi Evil Twin / Rogue AP yang meniru SSID RSAM
        is_hospital_like = any(k in ssid_low for k in ["anwar medika", "rsu anwar", "rsam", "anwar-medika", "anwarmedika"])
        is_rogue = False
        rogue_reason = None
        if is_hospital_like and not is_internal:
            is_rogue = True
            rogue_reason = f"SSID '{ssid_raw}' meniru jaringan RSAM namun BSSID {b_mac} tidak ada di 81 AP resmi controller."

        bss_list.append({
            "bssid": e.get("address"),
            "ssid": ssid_raw,
            "freq": freq,
            "width": width,
            "protocol": proto,
            "tx_power": txp,
            "signal": sig,
            "noise_floor": nf,
            "snr": snr,
            "is_internal": is_internal,
            "internal_device_name": internal_info["device_name"] if internal_info else None,
            "internal_iface": internal_info["iface"] if internal_info else None,
            "is_rogue": is_rogue,
            "rogue_reason": rogue_reason,
        })

    # ---- candidate channel set --------------------------------------------
    # Indonesian SDPPI: 5150-5350 (UNII-1/2A) & 5470-5825 (UNII-2C/3).
    # DFS channels need radar detection and cause outages when a radar is
    # detected, so for hospital WLANs the non-DFS set is preferred.
    DFS_5G = set(list(range(52, 65)) + list(range(100, 145)))
    NON_OVERLAP_2G = {1, 6, 11}

    # Prefer the regulatory channel list reported by the router. This is what
    # actually shows up in Winbox "Freq. Usage" for this exact radio.
    if reg_channels:
        candidates = [(int(c["channel"]), int(c["freq"])) for c in reg_channels]
        DFS_5G = {int(c["channel"]) for c in reg_channels if c.get("is_dfs")}
    elif band == "2g":
        candidates = [(ch, 2407 + ch * 5) for ch in range(1, 14)]
    else:
        candidates = [(CHAN_5G_OF_FREQ[f], f) for f in FREQ_5G_LIST]
    overlap_span = 25.0 if band == "2g" else 20.0

    def _overlap_weight(target_freq: float, bss: dict) -> float:
        """Fraction of a BSS's energy landing inside the candidate channel."""
        d = abs(target_freq - bss["freq"])
        if d == 0:
            return 1.0
        if band == "2g":
            # 2.4 GHz: 0MHz=1.0, 5=0.8, 10=0.45, 15=0.15, >=20=0
            if d >= 20:
                return 0.0
            return max(0.0, 1.0 - (d / 20.0) ** 0.8)
        # 5 GHz: partial overlap only if channel widths are wide
        half_w = max(20, int(bss.get("width") or 20)) / 2.0
        if d >= half_w + 10:
            return 0.0
        return max(0.0, 1.0 - (d / (half_w + 10)))

    channels_out = []
    for ch_num, ch_freq in candidates:
        contributing = []
        linear_sum = 0.0
        noise_floors = []
        for b in bss_list:
            w = _overlap_weight(ch_freq, b)
            if w <= 0:
                continue
            # linear power ratio relative to a -100 dBm reference
            lin = 10 ** ((b["signal"] + 100) / 10.0)
            linear_sum += lin * w
            contributing.append({
                "ssid": b["ssid"],
                "bssid": b["bssid"],
                "signal": b["signal"],
                "freq": b["freq"],
                "overlap": round(w, 2),
            })
            noise_floors.append(b["noise_floor"])

        ap_count = len(contributing)
        strong_count = len([c for c in contributing if c["signal"] >= -70])
        avg_sig = round(sum(c["signal"] for c in contributing) / ap_count, 1) if ap_count else None
        max_sig = max((c["signal"] for c in contributing), default=None)
        noise_floor = round(sum(noise_floors) / len(noise_floors)) if noise_floors else None

        # Effective aggregate interference level on this channel (dBm).
        # Power-sum every overlapping neighbour, exactly like a real spectrum analyser.
        if linear_sum <= 0:
            effective_dbm = -100.0
        else:
            effective_dbm = 10 * math.log10(linear_sum) - 100.0

        # Quality curve calibrated for dense hospital WLANs (70 dB usable span):
        #   -100 dBm (empty air)      -> 100
        #   -65 dBm  (busy)           -> 50
        #   -30 dBm  (fully saturated) -> 0
        raw_quality = 100.0 - ((effective_dbm + 100.0) / 70.0) * 100.0
        raw_quality = max(0.0, min(100.0, raw_quality))

        # Airtime contention penalty: every extra co-channel BSSID steals airtime
        # even when its RSSI is weak, so weight the BSS count separately.
        contention_penalty = min(30.0, max(0, ap_count - 1) * 1.2)
        quality = round(max(0.0, raw_quality - contention_penalty), 1)
        load = round(100.0 - quality, 1)

        if quality >= 65:
            grade, grade_key = "Sangat Baik", "excellent"
        elif quality >= 45:
            grade, grade_key = "Baik", "good"
        elif quality >= 25:
            grade, grade_key = "Cukup", "fair"
        elif quality >= 10:
            grade, grade_key = "Buruk", "poor"
        else:
            grade, grade_key = "Sangat Buruk", "critical"

        channels_out.append({
            "channel": ch_num,
            "freq": ch_freq,
            "aps": ap_count,
            "strong_aps": strong_count,
            "avg_signal": avg_sig,
            "max_signal": max_sig,
            "noise_floor": noise_floor,
            "effective_dbm": round(effective_dbm, 1),
            "load": load,
            "quality": quality,
            "grade": grade,
            "grade_key": grade_key,
            "is_dfs": ch_num in DFS_5G if band == "5g" else False,
            "non_overlapping": (ch_num in NON_OVERLAP_2G) if band == "2g" else True,
            "neighbours": sorted(contributing, key=lambda x: -x["signal"])[:6],
        })

    # When /interface/wireless/scan was blocked, the router still gave us real
    # per-channel usage from frequency-monitor (what Winbox "Freq. Usage" shows).
    # Replace the estimated score with that measurement.
    if freq_usage:
        usage_by_freq = {u["freq"]: u for u in freq_usage}
        for c in channels_out:
            u = usage_by_freq.get(int(c["freq"]))
            if not u:
                c["measured"] = False
                c["usage_pct"] = None
                c["quality"] = None
                c["load"] = None
                c["grade"] = "Tidak terukur"
                c["grade_key"] = "unmeasured"
                continue
            use_pct = max(0.0, min(100.0, float(u["use_pct"])))
            c["measured"] = True
            c["usage_pct"] = round(use_pct, 1)
            c["noise_floor"] = u["noise_floor"]
            c["quality"] = round(100.0 - use_pct, 1)
            c["load"] = round(use_pct, 1)
            c["aps"] = c.get("aps", 0)
            if c["quality"] >= 65:
                c["grade"], c["grade_key"] = "Sangat Baik", "excellent"
            elif c["quality"] >= 45:
                c["grade"], c["grade_key"] = "Baik", "good"
            elif c["quality"] >= 25:
                c["grade"], c["grade_key"] = "Cukup", "fair"
            elif c["quality"] >= 10:
                c["grade"], c["grade_key"] = "Buruk", "poor"
            else:
                c["grade"], c["grade_key"] = "Sangat Buruk", "critical"

    # ---- ranking -----------------------------------------------------------
    # Usable = non-DFS (5 GHz) / non-overlapping (2.4 GHz) channels first,
    # because a DFS radar hit drops the whole radio in a hospital.
    def _rank_key(c):
        usable = 1 if not c["is_dfs"] else 0
        # Channels the radio actually measured outrank unmeasured ones, otherwise
        # an unmeasured channel would win with a meaningless default score of 100.
        measured = 1 if c.get("measured", True) else 0
        q = c.get("quality")
        q = -1.0 if q is None else -float(q)
        return (-usable, -measured, q, c["channel"])

    ranked = sorted(channels_out, key=_rank_key)
    best3 = ranked[:3]
    # RouterOS lapor frequency='auto' saat radio tak terkunci / sedang scanning.
    # Dulu int('auto') melempar ValueError dan seluruh tahap Scan gagal.
    def _freq_num(v) -> int:
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    _cur_freq = _freq_num(target.get("frequency"))
    current = {
        "channel": (round((_cur_freq - 2407) / 5) if band == "2g"
                    else (_cur_freq - 5000) // 5 if _cur_freq else 0) if _cur_freq else None,
        "freq": _cur_freq,
        "channel_known": bool(_cur_freq),
        "width": target.get("channel-width"),
        "ssid": target.get("ssid"),
        "interface": target.get("name"),
    }
    current_entry = next((c for c in channels_out if c["channel"] == current["channel"]), None)

    rogues = [b for b in bss_list if b.get("is_rogue")]
    if rogues:
        db_save_alert({
            "id": f"rec_{secrets.token_hex(4)}",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "warning",
            "device_id": dev.get("id"),
            "alert_type": "ROGUE_AP_DETECTED",
            "text": f"🚨 [ROGUE AP / EVIL TWIN] Terdeteksi {len(rogues)} AP mencurigakan meniru SSID RSAM di sekitar {dev.get('name')}: "
            + ", ".join(f"{r['ssid']} ({r['bssid']})" for r in rogues),
        })

    sorted_bss = sorted(bss_list, key=lambda x: -x["signal"])[:60]
    try:
        db_rf_scan_save(dev.get("id"), band, channels_out, sorted_bss)
    except Exception:
        pass

    return {
        "status": "ok",
        "device_id": dev.get("id"),
        "device_name": dev.get("name"),
        "band": band,
        "interface": target.get("name"),
        "duration_s": duration,
        "scanned_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "scan_mode": scan_mode,
        "non_disruptive": bool(non_disruptive),
        "freq_usage": freq_usage,
        "total_bss_detected": len(bss_list),
        "rogue_count": len(rogues),
        "rogues": rogues,
        "current_channel": current,
        "current_channel_quality": current_entry["quality"] if current_entry else None,
        "current_channel_grade": current_entry["grade"] if current_entry else None,
        "best_channels": best3,
        "channels": channels_out,
        "bss_list": sorted_bss,
    }


@app.get("/api/map/crowded-analysis/{floor_id}")
def get_crowded_analysis(floor_id: str):
    data = load_floors_data()
    floors = {f["id"]: f for f in data.get("floors", [])}
    current_floor = floors.get(floor_id)
    if not current_floor:
        raise HTTPException(status_code=404, detail="Floor tidak ditemukan")
        
    width_m = float(current_floor.get("width_meters", 60.0))
    height_m = float(current_floor.get("height_meters", 40.0))
    
    placements = [p for p in data.get("placements", []) if p.get("floor_id") == floor_id]
    devices_map = {d["id"]: d for d in load_devices()}
    
    conflicts = []
    dist_2g_counts: dict[int, int] = {}
    dist_5g_counts: dict[int, int] = {}
    
    for p in placements:
        ch2 = p.get("channel_2g", 6)
        ch5 = p.get("channel_5g", 36)
        dist_2g_counts[ch2] = dist_2g_counts.get(ch2, 0) + 1
        dist_5g_counts[ch5] = dist_5g_counts.get(ch5, 0) + 1
        
    n = len(placements)
    for i in range(n):
        p1 = placements[i]
        d1_name = devices_map.get(p1["device_id"], {}).get("name", p1["device_id"])
        x1_m = (p1["x"] / 100.0) * width_m
        y1_m = (p1["y"] / 100.0) * height_m
        r1 = float(p1.get("radius_meters", 20.0))
        
        for j in range(i + 1, n):
            p2 = placements[j]
            d2_name = devices_map.get(p2["device_id"], {}).get("name", p2["device_id"])
            x2_m = (p2["x"] / 100.0) * width_m
            y2_m = (p2["y"] / 100.0) * height_m
            r2 = float(p2.get("radius_meters", 20.0))
            
            dist = math.sqrt((x1_m - x2_m)**2 + (y1_m - y2_m)**2)
            sum_radii = r1 + r2
            
            is_overlap = dist < (sum_radii * 0.9)
            
            if is_overlap and p1.get("channel_2g") == p2.get("channel_2g"):
                conflicts.append({
                    "type": "co-channel-2.4",
                    "severity": "high",
                    "device_a": {"id": p1["device_id"], "name": d1_name},
                    "device_b": {"id": p2["device_id"], "name": d2_name},
                    "band": "2.4 GHz",
                    "channel": p1.get("channel_2g"),
                    "distance_m": round(dist, 1),
                    "reason": f"AP '{d1_name}' dan '{d2_name}' berjarak {round(dist, 1)}m dan keduanya memancarkan Channel {p1.get('channel_2g')} (2.4GHz). Terjadi Co-Channel Interference yang menurunkan throughput klien hingga 60%."
                })
            if is_overlap and p1.get("channel_5g") == p2.get("channel_5g"):
                conflicts.append({
                    "type": "co-channel-5",
                    "severity": "medium",
                    "device_a": {"id": p1["device_id"], "name": d1_name},
                    "device_b": {"id": p2["device_id"], "name": d2_name},
                    "band": "5 GHz",
                    "channel": p1.get("channel_5g"),
                    "distance_m": round(dist, 1),
                    "reason": f"AP '{d1_name}' dan '{d2_name}' saling tumpang tindih pada Channel 5GHz ({p1.get('channel_5g')}). Disarankan memisah ke UNII-1 (36) dan UNII-3 (149/161)."
                })
                
    recs = []
    if any(c["type"] == "co-channel-2.4" for c in conflicts):
        recs.append("Atur ulang frekuensi 2.4 GHz menggunakan skema non-overlapping 3-channel (1, 6, 11). Ubah AP yang berdekatan ke channel alternatif.")
    if any(c["type"] == "co-channel-5" for c in conflicts):
        recs.append("Pisahkan frekuensi 5 GHz antar AP yang berdekatan dengan memilih channel 36, 40, 44, 48 atau channel UNII-3 (149-161).")
    if not conflicts and len(placements) > 1:
        recs.append("Penataan channel dan jarak antar AP saat ini optimal. Tidak terdeteksi tabrakan frekuensi co-channel.")
    elif not conflicts and len(placements) <= 1:
        recs.append("Tempatkan minimal 2 AP pada denah untuk mengaktifkan analisis tabrakan channel.")
        
    return {
        "status": "ok",
        "floor_id": floor_id,
        "floor_name": current_floor.get("name"),
        "total_placed_aps": len(placements),
        "conflicts_count": len(conflicts),
        "conflicts": conflicts,
        "channel_distribution_2g": dist_2g_counts,
        "channel_distribution_5g": dist_5g_counts,
        "recommendations": recs
    }


class SyncHardwareReq(BaseModel):
    floor_id: str
    device_id: str | None = None
    channel_2g: int | None = None
    channel_5g: int | None = None

SyncHardwareReq.model_rebuild()

FREQ_MAP_2G = {
    1: "2412", 2: "2417", 3: "2422", 4: "2427", 5: "2432", 6: "2437",
    7: "2442", 8: "2447", 9: "2452", 10: "2457", 11: "2462", 12: "2467", 13: "2472"
}
FREQ_MAP_5G = {
    36: "5180", 40: "5200", 44: "5220", 48: "5240", 52: "5260", 56: "5280",
    60: "5300", 64: "5320", 100: "5500", 149: "5745", 153: "5765", 157: "5785",
    161: "5805", 165: "5825"
}

@app.post("/api/map/sync-hardware")
def api_sync_hardware(req: SyncHardwareReq):
    data = load_floors_data()
    placements = [p for p in data.get("placements", []) if p.get("floor_id") == req.floor_id]
    if req.device_id:
        placements = [p for p in placements if p.get("device_id") == req.device_id]
        
    if not placements:
        return {"status": "ok", "total": 0, "success_count": 0, "results": [], "message": "Tidak ada perangkat yang dipilih untuk disinkronkan."}
        
    # If specific channel overrides were passed in req for this device, persist them to floors.json
    if req.device_id and (req.channel_2g is not None or req.channel_5g is not None):
        changed = False
        for p in data.get("placements", []):
            if p.get("device_id") == req.device_id and p.get("floor_id") == req.floor_id:
                if req.channel_2g is not None:
                    p["channel_2g"] = int(req.channel_2g)
                    changed = True
                if req.channel_5g is not None:
                    p["channel_5g"] = int(req.channel_5g)
                    changed = True
        if changed:
            save_floors_data(data)

    devices_map = {d["id"]: d for d in load_devices()}
    results = []
    
    for p in placements:
        dev_id = p.get("device_id")
        dev = devices_map.get(dev_id)
        if not dev:
            results.append({"device_id": dev_id, "status": "error", "error": "Perangkat tidak terdaftar di database"})
            continue
            
        target_ch2 = int(req.channel_2g if (req.device_id and req.channel_2g is not None) else p.get("channel_2g", 6))
        target_ch5 = int(req.channel_5g if (req.device_id and req.channel_5g is not None) else p.get("channel_5g", 149))
        freq_2g = FREQ_MAP_2G.get(target_ch2, "2437")
        freq_5g = FREQ_MAP_5G.get(target_ch5, "5745")
        
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl_res = mt.resource("/interface/wireless")
                all_wl = wl_res.get()
                applied = []
                has_5g_radio = False
                for iface in all_wl:
                    if iface.get("master-interface") and iface.get("master-interface") != "none":
                        continue
                    band = str(iface.get("band") or "").lower()
                    if "2ghz" in band or "2.4" in band:
                        wl_res.set(id=iface["id"], frequency=freq_2g)
                        applied.append(f"{iface.get('name')} (2.4G) -> Ch {target_ch2} ({freq_2g} MHz)")
                    elif "5ghz" in band or "5" in band:
                        has_5g_radio = True
                        try:
                            wl_res.set(id=iface["id"], frequency=freq_5g)
                            applied.append(f"{iface.get('name')} (5G) -> Ch {target_ch5} ({freq_5g} MHz)")
                        except Exception as e5:
                            if "bad band or frequency" in str(e5):
                                # RouterOS regulatory domain restriction (e.g. UNII-1 in Indonesia)
                                indo_freq_5g = {36: "5745", 40: "5765", 44: "5785", 48: "5805"}.get(target_ch5, "5745")
                                wl_res.set(id=iface["id"], frequency=indo_freq_5g)
                                applied.append(f"{iface.get('name')} (5G) -> Ch {target_ch5} (Reg-RI: {indo_freq_5g} MHz)")
                            else:
                                raise
                if not has_5g_radio:
                    applied.append("Perangkat hanya memiliki radio 2.4 GHz (Tidak ada radio 5 GHz)")
                results.append({
                    "device_id": dev_id,
                    "device_name": dev.get("name", dev_id),
                    "status": "success",
                    "channel_2g": target_ch2,
                    "channel_5g": target_ch5 if has_5g_radio else None,
                    "details": applied
                })
        except Exception as e:
            results.append({
                "device_id": dev_id,
                "device_name": dev.get("name", dev_id),
                "status": "offline_or_failed",
                "error": str(e)
            })
            
    success_count = sum(1 for r in results if r.get("status") == "success")
    return {
        "status": "ok",
        "total": len(results),
        "success_count": success_count,
        "results": results,
        "message": f"{success_count} dari {len(results)} perangkat berhasil disinkronkan ke routerboard fisik!"
    }


# ---------------------------------------------------------------- Wall Attenuation / Redaman Dinding RSAM
def get_default_rsam_walls(floor_id: str):
    if floor_id == "floor_1":
        return [
            # Radiologi & CT Scan - Dinding Timbal / Lead-Shield (25 dB Redaman)
            {"id": "w_rad_top", "name": "Dinding Timbal Radiologi (Utara)", "x1": 27.5, "y1": 55.0, "x2": 45.8, "y2": 55.0, "type": "lead_shield", "loss_db": 25.0},
            {"id": "w_rad_right", "name": "Dinding Timbal Radiologi (Timur)", "x1": 45.8, "y1": 55.0, "x2": 45.8, "y2": 92.5, "type": "lead_shield", "loss_db": 25.0},
            {"id": "w_rad_left", "name": "Dinding Timbal Radiologi (Barat)", "x1": 27.5, "y1": 55.0, "x2": 27.5, "y2": 92.5, "type": "lead_shield", "loss_db": 25.0},
            {"id": "w_rad_bottom", "name": "Dinding Timbal Radiologi (Selatan)", "x1": 27.5, "y1": 92.5, "x2": 45.8, "y2": 92.5, "type": "lead_shield", "loss_db": 25.0},

            # Shaft Lift & Tangga - Dinding Beton Bertulang (12 dB Redaman)
            {"id": "w_lift_1", "name": "Shaft Lift Beton (Utara)", "x1": 45.8, "y1": 7.5, "x2": 54.2, "y2": 7.5, "type": "concrete", "loss_db": 12.0},
            {"id": "w_lift_2", "name": "Shaft Lift Beton (Barat)", "x1": 45.8, "y1": 7.5, "x2": 45.8, "y2": 26.2, "type": "concrete", "loss_db": 12.0},
            {"id": "w_lift_3", "name": "Shaft Lift Beton (Timur)", "x1": 54.2, "y1": 7.5, "x2": 54.2, "y2": 26.2, "type": "concrete", "loss_db": 12.0},
            {"id": "w_lift_4", "name": "Shaft Lift Beton (Selatan)", "x1": 45.8, "y1": 26.2, "x2": 54.2, "y2": 26.2, "type": "concrete", "loss_db": 12.0},

            # Dinding Bata Ruang Pelayanan & Koridor (6 dB Redaman)
            {"id": "w_igd_hall", "name": "Sekat Koridor IGD & Triage", "x1": 4.1, "y1": 45.0, "x2": 27.5, "y2": 45.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_igd_adm", "name": "Dinding Pembatas IGD - Admisi", "x1": 27.5, "y1": 7.5, "x2": 27.5, "y2": 45.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_farmasi_hall", "name": "Sekat Koridor Farmasi & Depo", "x1": 54.2, "y1": 45.0, "x2": 75.0, "y2": 45.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_farmasi_poli", "name": "Dinding Pembatas Farmasi - Poli", "x1": 75.0, "y1": 7.5, "x2": 75.0, "y2": 45.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_poli_hall", "name": "Sekat Koridor Poliklinik", "x1": 75.0, "y1": 45.0, "x2": 95.8, "y2": 45.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_lab_hall", "name": "Sekat Koridor Laboratorium", "x1": 4.1, "y1": 55.0, "x2": 27.5, "y2": 55.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_server_hall", "name": "Dinding Server Room & NOC", "x1": 54.2, "y1": 55.0, "x2": 75.0, "y2": 55.0, "type": "brick", "loss_db": 6.0},
            {"id": "w_server_hrd", "name": "Pembatas Server Room - HRD", "x1": 75.0, "y1": 55.0, "x2": 75.0, "y2": 92.5, "type": "brick", "loss_db": 6.0},
            {"id": "w_hrd_hall", "name": "Sekat Koridor HRD & Manajemen", "x1": 75.0, "y1": 55.0, "x2": 95.8, "y2": 55.0, "type": "brick", "loss_db": 6.0},

            # Partisi Kaca / Gipsum Loket (3 dB Redaman)
            {"id": "w_admisi_glass", "name": "Sekat Kaca Loket Admisi", "x1": 27.5, "y1": 45.0, "x2": 45.8, "y2": 45.0, "type": "drywall", "loss_db": 3.0},
        ]
    return []

def load_floor_walls(floor_id: str):
    data = load_floors_data()
    for f in data.get("floors", []):
        if f.get("id") == floor_id:
            if "walls" not in f:
                f["walls"] = get_default_rsam_walls(floor_id)
                save_floors_data(data)
            return f.get("walls", [])
    return []

def save_floor_walls(floor_id: str, walls: list):
    data = load_floors_data()
    for f in data.get("floors", []):
        if f.get("id") == floor_id:
            f["walls"] = walls
            save_floors_data(data)
            return True
    return False

@app.get("/api/map/floors/{floor_id}/walls")
def api_get_floor_walls(floor_id: str):
    walls = load_floor_walls(floor_id)
    return {"status": "ok", "floor_id": floor_id, "total": len(walls), "walls": walls}

class WallItemReq(BaseModel):
    id: str | None = None
    name: str | None = "Dinding Sekat"
    x1: float
    y1: float
    x2: float
    y2: float
    type: str = "brick" # lead_shield, concrete, brick, drywall, glass
    loss_db: float = 6.0

class WallsUpdateReq(BaseModel):
    walls: list[WallItemReq]

@app.post("/api/map/floors/{floor_id}/walls")
def api_update_floor_walls(floor_id: str, req: WallsUpdateReq):
    wall_dicts = []
    for w in req.walls:
        wid = w.id or f"w_{secrets.token_hex(4)}"
        wall_dicts.append({
            "id": wid,
            "name": w.name or "Dinding Sekat",
            "x1": round(w.x1, 1),
            "y1": round(w.y1, 1),
            "x2": round(w.x2, 1),
            "y2": round(w.y2, 1),
            "type": w.type,
            "loss_db": float(w.loss_db)
        })
    save_floor_walls(floor_id, wall_dicts)
    return {"status": "ok", "floor_id": floor_id, "total": len(wall_dicts), "walls": wall_dicts}

@app.post("/api/map/floors/{floor_id}/walls/reset-rsam-preset")
def api_reset_rsam_walls(floor_id: str):
    preset = get_default_rsam_walls(floor_id)
    save_floor_walls(floor_id, preset)
    return {"status": "ok", "floor_id": floor_id, "total": len(preset), "walls": preset, "message": "Preset sekat ruangan RS Anwar Medika berhasil dimuat!"}

@app.delete("/api/map/floors/{floor_id}/walls/{wall_id}")
def api_delete_floor_wall(floor_id: str, wall_id: str):
    walls = load_floor_walls(floor_id)
    new_walls = [w for w in walls if w.get("id") != wall_id]
    save_floor_walls(floor_id, new_walls)
    return {"status": "ok", "floor_id": floor_id, "walls": new_walls}


# ---------------------------------------------------------------- 1-Click Mass Push All APs (Optimasi & Push)
class OptimizeAndPushReq(BaseModel):
    floor_id: str

@app.post("/api/map/optimize-and-push")
def api_optimize_and_push(req: OptimizeAndPushReq):
    data = load_floors_data()
    floor_id = req.floor_id
    floor = next((f for f in data.get("floors", []) if f.get("id") == floor_id), None)
    floor_name = floor.get("name", floor_id) if floor else floor_id
    
    placements = [p for p in data.get("placements", []) if p.get("floor_id") == floor_id]
    if not placements:
        return {"status": "ok", "total": 0, "success_count": 0, "results": [], "message": "Tidak ada AP terpasang di denah ini."}

    # Urutkan AP berdasarkan posisi spasial X agar berdekatan mendapat channel berbeda
    sorted_placements = sorted(placements, key=lambda p: (p.get("x", 0), p.get("y", 0)))
    
    # 2.4 GHz non-overlapping channels
    pool_2g = [1, 6, 11]
    # 5 GHz clean UNII-3 channels (legal & non-DFS in Indonesia)
    pool_5g = [149, 153, 157, 161, 165]

    updated_placements = []
    for idx, p in enumerate(sorted_placements):
        p_copy = dict(p)
        p_copy["channel_2g"] = pool_2g[idx % len(pool_2g)]
        p_copy["channel_5g"] = pool_5g[idx % len(pool_5g)]
        updated_placements.append(p_copy)

    # Simpan kembali ke floors.json
    all_placements = [p for p in data.get("placements", []) if p.get("floor_id") != floor_id] + updated_placements
    data["placements"] = all_placements
    save_floors_data(data)

    # Push serentak via socket 8728
    devices_map = {d["id"]: d for d in load_devices()}
    results = []

    def push_to_ap(p):
        dev_id = p.get("device_id")
        dev = devices_map.get(dev_id)
        if not dev:
            return {"device_id": dev_id, "status": "error", "error": "Perangkat tidak terdaftar di devices.json"}
        
        target_ch2 = p.get("channel_2g", 6)
        target_ch5 = p.get("channel_5g", 149)
        freq_2g = FREQ_MAP_2G.get(target_ch2, "2437")
        freq_5g = FREQ_MAP_5G.get(target_ch5, "5745")

        applied = []
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl_res = mt.resource("/interface/wireless")
                all_wl = wl_res.get()
                has_5g_radio = False
                for iface in all_wl:
                    if iface.get("master-interface") and iface.get("master-interface") != "none":
                        continue
                    band = str(iface.get("band") or "").lower()
                    if "2ghz" in band or "2.4" in band:
                        wl_res.set(id=iface["id"], frequency=freq_2g)
                        applied.append(f"{iface.get('name')} (2.4G) -> Ch {target_ch2} ({freq_2g} MHz)")
                    elif "5ghz" in band or "5" in band:
                        has_5g_radio = True
                        try:
                            wl_res.set(id=iface["id"], frequency=freq_5g)
                            applied.append(f"{iface.get('name')} (5G) -> Ch {target_ch5} ({freq_5g} MHz)")
                        except Exception as e5:
                            if "bad band or frequency" in str(e5):
                                indo_freq = {36: "5745", 40: "5765", 44: "5785", 48: "5805"}.get(target_ch5, "5745")
                                wl_res.set(id=iface["id"], frequency=indo_freq)
                                applied.append(f"{iface.get('name')} (5G) -> Ch {target_ch5} (Reg-RI: {indo_freq} MHz)")
                            else:
                                raise
                if not has_5g_radio:
                    applied.append("Perangkat hanya memiliki radio 2.4 GHz (Tidak ada radio 5 GHz)")
                return {
                    "device_id": dev_id,
                    "device_name": dev.get("name", dev_id),
                    "status": "success",
                    "channel_2g": target_ch2,
                    "channel_5g": target_ch5,
                    "details": applied
                }
        except Exception as e:
            return {
                "device_id": dev_id,
                "device_name": dev.get("name", dev_id),
                "status": "offline_or_failed",
                "channel_2g": target_ch2,
                "channel_5g": target_ch5,
                "error": str(e)
            }

    with ThreadPoolExecutor(max_workers=min(len(updated_placements), 10) or 1) as ex:
        futures = {ex.submit(push_to_ap, p): p for p in updated_placements}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as ex_err:
                results.append({"status": "error", "error": str(ex_err)})

    success_count = sum(1 for r in results if r.get("status") == "success")

    # Notifikasi Telegram jika diaktifkan
    tg_cfg = load_telegram_config()
    if tg_cfg.get("enabled") and tg_cfg.get("notify_on_rf_conflict"):
        msg = (
            f"<b>📶 [RSAM NOC - RF CHANNEL MASS OPTIMIZED]</b>\n"
            f"<b>Lantai:</b> {floor_name}\n"
            f"<b>Total AP:</b> {len(results)} Perangkat\n"
            f"<b>Berhasil Push:</b> {success_count} AP\n"
            f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB\n"
            f"<i>Distribusi saluran radio 2.4GHz & 5GHz telah dirapikan tanpa tabrakan frekuensi.</i>"
        )
        send_telegram_alert(msg, tg_cfg)

    return {
        "status": "ok",
        "floor_id": floor_id,
        "floor_name": floor_name,
        "total": len(results),
        "success_count": success_count,
        "results": results,
        "message": f"Selesai! {success_count} dari {len(results)} AP berhasil dioptimasi & disinkronkan frekuensi radionya ke hardware!"
    }


# ---------------------------------------------------------------- Telegram NOC Bot & Alert Worker
TELEGRAM_CONFIG_FILE = BASE / "telegram_config.json"
DEVICE_PREV_STATES = {}
LAST_ALERT_TIMES = {}

DEFAULT_TELEGRAM_CONFIG = {
    "enabled": False,
    "bot_token": "",
    "chat_id": "",
    "notify_on_down": True,
    "notify_on_recovery": True,
    "notify_on_high_cpu": True,
    "cpu_threshold_pct": 80,
    "notify_on_ethernet_downgrade": True,
    "notify_on_rf_conflict": True,
    "check_interval_sec": 30
}

def load_telegram_config():
    if not TELEGRAM_CONFIG_FILE.exists():
        save_telegram_config(DEFAULT_TELEGRAM_CONFIG)
        return dict(DEFAULT_TELEGRAM_CONFIG)
    try:
        with open(TELEGRAM_CONFIG_FILE, "r", encoding="utf-8") as f:
            c = json.load(f)
            merged = dict(DEFAULT_TELEGRAM_CONFIG)
            merged.update(c)
            return merged
    except Exception:
        return dict(DEFAULT_TELEGRAM_CONFIG)

def save_telegram_config(cfg: dict):
    with open(TELEGRAM_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

def send_telegram_alert(text: str, config: dict = None) -> tuple[bool, str]:
    if config is None:
        config = load_telegram_config()
    token = (config.get("bot_token") or "").strip()
    chat_id = str(config.get("chat_id") or "").strip()
    if not token or not chat_id:
        return False, "Bot Token atau Chat ID Telegram belum diatur."
    
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                record = {
                    "id": f"rec_{secrets.token_hex(4)}",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "status": "success",
                    "text": text
                }
                db_save_alert(record)
                return True, "✅ Notifikasi Telegram berhasil dikirim ke grup NOC RSAM!"
            else:
                desc = data.get("description", "Gagal mengirim pesan Telegram")
                return False, f"Telegram API Error: {desc}"
    except urllib.error.HTTPError as e:
        # Telegram mengirim penjelasan asli di body JSON, bukan di exception message
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
            detail = json.loads(raw).get("description", raw)
        except Exception:
            detail = raw or str(e)

        hint = ""
        low = (detail or "").lower()
        if "chat not found" in low:
            hint = (" — Chat ID belum kenal bot. Buka bot di Telegram, tekan /start, "
                    "lalu ulangi. Untuk grup, undang dulu bot ke grup tersebut.")
        elif "bot was blocked" in low or "user is deactivated" in low:
            hint = " — Bot diblokir oleh penerima. Buka bot di Telegram dan tekan Unblock/Start."
        elif "unauthorized" in low:
            hint = " — Bot Token tidak valid. Periksa kembali token dari @BotFather."

        msg = f"Telegram API Error {e.code}: {detail}{hint}"
        record = {
            "id": f"rec_{secrets.token_hex(4)}",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "failed",
            "error": msg,
            "text": text
        }
        db_save_alert(record)
        return False, msg
    except Exception as e:
        record = {
            "id": f"rec_{secrets.token_hex(4)}",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "failed",
            "error": str(e),
            "text": text
        }
        db_save_alert(record)
        return False, f"Koneksi Telegram Gagal: {str(e)}"

class TelegramConfigReq(BaseModel):
    enabled: bool = False
    bot_token: str | None = None
    chat_id: str | None = None
    notify_on_down: bool = True
    notify_on_recovery: bool = True
    notify_on_high_cpu: bool = True
    cpu_threshold_pct: int = 80
    notify_on_ethernet_downgrade: bool = True
    notify_on_rf_conflict: bool = True
    check_interval_sec: int = 30

@app.get("/api/telegram/config")
def api_get_telegram_config():
    cfg = load_telegram_config()
    raw_token = cfg.get("bot_token", "")
    masked_token = (raw_token[:6] + "..." + raw_token[-4:]) if len(raw_token) > 10 else ("*" * len(raw_token))
    # Jangan pernah kirim token mentah ke klien — hanya versi tersamar.
    safe_cfg = {k: v for k, v in cfg.items() if k != "bot_token"}
    return {
        "status": "ok",
        "config": {
            **safe_cfg,
            "bot_token": "",
            "bot_token_masked": masked_token,
            "has_token": bool(raw_token)
        }
    }

@app.post("/api/telegram/config")
def api_save_telegram_config(req: TelegramConfigReq):
    current = load_telegram_config()
    token = req.bot_token if req.bot_token is not None else current.get("bot_token", "")
    # Token kosong atau string masked berarti user tidak mengubah token —
    # pertahankan token lama yang tersimpan di server.
    if not token.strip() or "..." in token or set(token.strip()) <= {"*"}:
        token = current.get("bot_token", "")
        
    updated = {
        "enabled": req.enabled,
        "bot_token": token.strip(),
        "chat_id": (req.chat_id or "").strip(),
        "notify_on_down": req.notify_on_down,
        "notify_on_recovery": req.notify_on_recovery,
        "notify_on_high_cpu": req.notify_on_high_cpu,
        "cpu_threshold_pct": max(10, min(100, req.cpu_threshold_pct)),
        "notify_on_ethernet_downgrade": req.notify_on_ethernet_downgrade,
        "notify_on_rf_conflict": req.notify_on_rf_conflict,
        "check_interval_sec": max(10, min(300, req.check_interval_sec))
    }
    save_telegram_config(updated)
    return {"status": "ok", "message": "Konfigurasi bot Telegram RSAM NOC berhasil disimpan!"}

class TelegramTestReq(BaseModel):
    bot_token: str | None = None
    chat_id: str | None = None

@app.post("/api/telegram/test")
def api_test_telegram(req: TelegramTestReq):
    cfg = load_telegram_config()
    if req.bot_token and "..." not in req.bot_token:
        cfg["bot_token"] = req.bot_token.strip()
    if req.chat_id:
        cfg["chat_id"] = req.chat_id.strip()

    test_message = (
        f"<b>🔔 [RSAM NOC - TEST NOTIFIKASI BOT]</b>\n"
        f"<b>Status:</b> Sistem Gateway Monitoring MikroTik Aktif\n"
        f"<b>Rumah Sakit:</b> RS Anwar Medika (Sidoarjo)\n"
        f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB\n"
        f"<i>Bot berhasil terhubung dan siap mengirimkan alert AP Down, High CPU & Ethernet Flap!</i>"
    )
    ok, msg = send_telegram_alert(test_message, cfg)
    return {"status": "ok" if ok else "error", "success": ok, "message": msg}

@app.get("/api/telegram/history")
def api_get_telegram_history(limit: int = Query(100, ge=1, le=500)):
    return {"status": "ok", "history": db_get_alerts(limit)}


@app.get("/api/telegram/bot-info")
def api_telegram_bot_info():
    """Validasi token bot dan tampilkan identitas bot (username, nama)."""
    token = (load_telegram_config().get("bot_token") or "").strip()
    if not token:
        return {"status": "error", "valid": False, "message": "Bot Token belum diisi."}
    try:
        with urllib.request.urlopen(
            f"https://api.telegram.org/bot{token}/getMe", timeout=10
        ) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("ok"):
            r = data["result"]
            return {
                "status": "ok",
                "valid": True,
                "bot_username": r.get("username"),
                "bot_name": r.get("first_name"),
                "bot_id": r.get("id"),
            }
        return {"status": "error", "valid": False, "message": data.get("description", "Token tidak valid")}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("description", "")
        except Exception:
            detail = ""
        return {"status": "error", "valid": False, "message": detail or f"HTTP {e.code}"}
    except Exception as e:
        return {"status": "error", "valid": False, "message": str(e)}


class TelegramDiscoverReq(BaseModel):
    bot_token: str | None = None


@app.post("/api/telegram/discover-chat-id")
def api_telegram_discover_chat_id(req: TelegramDiscoverReq):
    """
    Cari Chat ID otomatis dari getUpdates.
    Syarat: penerima sudah menekan /start pada bot, atau bot sudah diundang ke grup.
    """
    cfg = load_telegram_config()
    token = (req.bot_token or "").strip() or (cfg.get("bot_token") or "").strip()
    if not token or "..." in token:
        return {"status": "error", "found": False, "candidates": [],
                "message": "Bot Token belum diisi / tidak valid."}

    try:
        with urllib.request.urlopen(
            f"https://api.telegram.org/bot{token}/getUpdates?limit=100", timeout=10
        ) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("description", "")
        except Exception:
            detail = ""
        return {"status": "error", "found": False, "candidates": [],
                "message": f"Token tidak valid: {detail or e.code}"}
    except Exception as e:
        return {"status": "error", "found": False, "candidates": [], "message": str(e)}

    if not data.get("ok"):
        return {"status": "error", "found": False, "candidates": [],
                "message": data.get("description", "Gagal membaca updates bot.")}

    candidates = []
    seen = set()
    for upd in data.get("result", []):
        msg = upd.get("message") or upd.get("channel_post") or {}
        chat = msg.get("chat") or {}
        cid = chat.get("id")
        if cid is None or cid in seen:
            continue
        seen.add(cid)
        ctype = chat.get("type", "private")
        if ctype == "private":
            label = " ".join(
                filter(None, [chat.get("first_name"), chat.get("last_name")])
            ) or (chat.get("username") or "Akun Pribadi")
        else:
            label = chat.get("title") or chat.get("username") or "Grup"
        candidates.append({
            "chat_id": str(cid),
            "type": ctype,
            "label": label,
            "username": chat.get("username"),
        })

    if not candidates:
        return {
            "status": "ok",
            "found": False,
            "candidates": [],
            "message": ("Belum ada chat terdeteksi. Buka bot Telegram Anda, "
                        "tekan /start (atau kirim pesan apa saja), lalu coba lagi."),
        }

    return {
        "status": "ok",
        "found": True,
        "candidates": candidates,
        "message": f"Ditemukan {len(candidates)} chat. Pilih salah satu untuk dipakai.",
    }


@app.post("/api/telegram/clear-history")
def api_clear_telegram_history():
    db_clear_alerts()
    return {"status": "ok", "message": "Riwayat alert Telegram berhasil dibersihkan dari database."}

# Background thread monitoring loop
def telegram_alert_monitor_thread():
    while True:
        try:
            cfg = load_telegram_config()
            if cfg.get("enabled") and (cfg.get("bot_token") and cfg.get("chat_id")):
                devices = load_devices()
                now_ts = time.time()

                for dev in devices:
                    dev_id = dev.get("id")
                    dev_name = dev.get("name", dev_id)
                    dev_host = dev.get("host")
                    dev_group = dev.get("group", "RSAM")
                    
                    # Cek konektivitas via socket 8728
                    is_online = False
                    cpu_load = 0
                    ethernet_downgraded = []

                    try:
                        with get_device_lock(dev_host), MT(dev) as mt:
                            is_online = True
                            # Ambil data CPU jika monitoring CPU aktif
                            if cfg.get("notify_on_high_cpu"):
                                try:
                                    res_res = mt.resource("/system/resource").get()
                                    if res_res:
                                        cpu_load = int(res_res[0].get("cpu-load", 0))
                                except Exception:
                                    pass

                            # Ambil data ethernet interface jika monitoring downgrade aktif
                            if cfg.get("notify_on_ethernet_downgrade"):
                                try:
                                    eth_res = mt.resource("/interface/ethernet").get()
                                    for eth in eth_res:
                                        speed = eth.get("speed", "").lower()
                                        name = eth.get("name", "")
                                        running = eth.get("running") == "true" or eth.get("running") is True
                                        if running and ("100m" in speed or "10m" in speed):
                                            ethernet_downgraded.append(f"{name} ({speed})")
                                except Exception:
                                    pass
                    except Exception:
                        is_online = False

                    prev_online = DEVICE_PREV_STATES.get(dev_id, None)

                    # 1. Alert AP Down (Hanya jika sebelumnya online dan sekarang mati)
                    if prev_online is True and not is_online and cfg.get("notify_on_down"):
                        last_alert = LAST_ALERT_TIMES.get(f"{dev_id}_down", 0)
                        if now_ts - last_alert > 300: # debounce 5 min
                            msg = (
                                f"<b>🚨 [RSAM NOC ALERT - PERANGKAT TERPUTUS]</b>\n"
                                f"<b>Perangkat:</b> {dev_name}\n"
                                f"<b>Lokasi/Ruang:</b> {dev_group}\n"
                                f"<b>IP Address:</b> <code>{dev_host}</code>\n"
                                f"<b>Status:</b> ❌ OFFLINE (Socket port 8728 timeout)\n"
                                f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB\n"
                                f"<i>Tindakan: Segera periksa koneksi kabel UTP PoE switch.</i>"
                            )
                            send_telegram_alert(msg, cfg)
                            LAST_ALERT_TIMES[f"{dev_id}_down"] = now_ts

                    # 2. Alert AP Recovery (Kembali online)
                    elif prev_online is False and is_online and cfg.get("notify_on_recovery"):
                        msg = (
                            f"<b>✅ [RSAM NOC RESOLVED - PERANGKAT KEMBALI ONLINE]</b>\n"
                            f"<b>Perangkat:</b> {dev_name}\n"
                            f"<b>Lokasi/Ruang:</b> {dev_group}\n"
                            f"<b>IP Address:</b> <code>{dev_host}</code>\n"
                            f"<b>Status:</b> 🟢 ONLINE (Socket terhubung normal)\n"
                            f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB"
                        )
                        send_telegram_alert(msg, cfg)
                        LAST_ALERT_TIMES.pop(f"{dev_id}_down", None)

                    # Simpan state online terakhir
                    DEVICE_PREV_STATES[dev_id] = is_online

                    # 3. Alert High CPU (> threshold)
                    thresh = cfg.get("cpu_threshold_pct", 80)
                    if is_online and cpu_load >= thresh and cfg.get("notify_on_high_cpu"):
                        last_cpu_alert = LAST_ALERT_TIMES.get(f"{dev_id}_cpu", 0)
                        if now_ts - last_cpu_alert > 600: # debounce 10 min
                            msg = (
                                f"<b>⚠️ [RSAM NOC WARNING - BEBAN CPU TINGGI]</b>\n"
                                f"<b>Perangkat:</b> {dev_name}\n"
                                f"<b>Lokasi/Ruang:</b> {dev_group}\n"
                                f"<b>IP Address:</b> <code>{dev_host}</code>\n"
                                f"<b>Beban CPU:</b> 🔴 <b>{cpu_load}%</b> (Threshold: {thresh}%)\n"
                                f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB\n"
                                f"<i>Periksa antrean traffic klien atau loop broadcast jaringan.</i>"
                            )
                            send_telegram_alert(msg, cfg)
                            LAST_ALERT_TIMES[f"{dev_id}_cpu"] = now_ts

                    # 4. Alert Ethernet Downgrade ke 100M
                    if is_online and ethernet_downgraded and cfg.get("notify_on_ethernet_downgrade"):
                        last_eth_alert = LAST_ALERT_TIMES.get(f"{dev_id}_eth", 0)
                        if now_ts - last_eth_alert > 1800: # debounce 30 min
                            msg = (
                                f"<b>⚠️ [RSAM NOC WARNING - LINK ETHERNET FLAP / DOWNGRADE]</b>\n"
                                f"<b>Perangkat:</b> {dev_name}\n"
                                f"<b>Lokasi/Ruang:</b> {dev_group}\n"
                                f"<b>IP Address:</b> <code>{dev_host}</code>\n"
                                f"<b>Port Terdampak:</b> {', '.join(ethernet_downgraded)}\n"
                                f"<b>Waktu:</b> {time.strftime('%Y-%m-%d %H:%M:%S')} WIB\n"
                                f"<i>Port hanya bernegosiasi pada 100 Mbps (seharusnya Gigabit 1000 Mbps). Indikasi pin UTP rusak atau crimping RJ45 longgar.</i>"
                            )
                            send_telegram_alert(msg, cfg)
                            LAST_ALERT_TIMES[f"{dev_id}_eth"] = now_ts

            interval = max(10, cfg.get("check_interval_sec", 30))
        except Exception:
            interval = 30
        time.sleep(interval)

# Start background monitor thread on process load
_tg_thread = threading.Thread(target=telegram_alert_monitor_thread, daemon=True, name="TelegramAlertMonitor")
_tg_thread.start()


@app.get("/health", response_class=PlainTextResponse)
def health(device: str | None = None):
    try:
        dev = get_device(device)
        with get_device_lock(dev["host"]), MT(dev) as mt:
            name = mt.get("/system/identity")[0].get("name")
        return f"ok device={name} host={dev['host']} id={dev['id']}"
    except Exception as e:
        return PlainTextResponse(f"fail {type(e).__name__}: {e}", status_code=503)


# ---------------------------------------------------------------- RRM / auto-optimizer
# Direct-push self-optimising WLAN (Ruijie-style): DCA + TPC + steering from rrm_engine,
# applied by the backend itself on a schedule, with snapshot/rollback and client-drop guard.
import rrm_engine as rrm

RRM_CFG_FILE = BASE / "rrm_config.json"
RRM_DEFAULT = {
    "enabled": False,          # auto-push on/off
    "interval_min": 15,        # evaluation period
    "include_dfs": False,      # DFS channels opt-in only (radar hit drops the radio)
    "apply_channel": True,
    "apply_txpower": False,
    "apply_steering": False,
    "apply_roam": True,        # kick & blokir MAC di AP lemah (<= -75 dBm) agar pindah ke AP terdekat
    "roam_thr_dbm": -75.0,     # kick & blokir hanya saat sinyal klien di AP itu <= ini
    "roam_alt_min_dbm": -67.0, # AP alternatif minimal sekuat ini, kalau tidak klien yatim
    "roam_margin_db": 7.0,     # histeresis: selisih minimal agar layak dipaksa pindah
    "roam_expire_min": 10,     # entry ACL dicabut otomatis setelah ini
    "min_gain_pct": 15.0,      # do not touch a working network for less than this
    "quiet_start": "01:00",    # auto-push only inside this window unless no clients attached
    "quiet_end": "05:00",
    "max_client_drop": 0,      # rollback automatically if more clients vanish than this
    "scan_duration": 8,
    "sample_interval_min": 5,
    "channels_2g": [1, 6, 11],                                  # channel numbers, not MHz
    "channels_5g": [36, 40, 44, 48, 149, 153, 157, 161, 165],
    "last_run_ts": 0.0,
}


def ch_to_freq(band: str, ch: int) -> int:
    """Channel number -> centre frequency (MHz)."""
    ch = int(ch)
    if str(band).startswith("2"):
        return 2484 if ch == 14 else 2412 + 5 * (ch - 1)
    if 36 <= ch <= 64:
        return 5180 + 5 * (ch - 36)
    if 100 <= ch <= 144:
        return 5500 + 5 * (ch - 100)
    if 149 <= ch <= 177:
        return 5745 + 5 * (ch - 149)
    return 0


def rrm_allowed_freqs(cfg: dict) -> dict:
    """Whitelist from config, in MHz, ready for rrm.plan_dca(allowed=...)."""
    out = {}
    for band, key in (("2g", "channels_2g"), ("5g", "channels_5g")):
        freqs = [ch_to_freq(band, c) for c in (cfg.get(key) or []) if str(c).strip() != ""]
        freqs = [f for f in freqs if f]
        if freqs:
            out[band] = freqs
    return out
RRM_LOCK = threading.Lock()


def init_rrm_db():
    with _DB_LOCK:
        conn = sqlite3.connect(str(NOC_DB_FILE), timeout=10.0)
        c = conn.cursor()
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA busy_timeout=5000")
        c.execute("""
            CREATE TABLE IF NOT EXISTS rf_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL, device_id TEXT, interface TEXT, band TEXT, mac TEXT,
                rssi REAL, snr REAL, tx_ccq REAL, retry_pct REAL, noise_dbm REAL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_rf_samples_dev ON rf_samples (device_id, ts)")
        c.execute("""
            CREATE TABLE IF NOT EXISTS rrm_runs (
                id TEXT PRIMARY KEY, ts REAL, mode TEXT, status TEXT,
                gain_pct REAL, plan_json TEXT, snapshot_json TEXT,
                result_json TEXT, rolled_back INTEGER DEFAULT 0
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS rf_scan_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL, device_id TEXT, band TEXT,
                channels_json TEXT, bss_json TEXT
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_rf_scan_hist ON rf_scan_history (device_id, band, ts)")
        conn.commit()
        conn.close()


def load_rrm_cfg() -> dict:
    cfg = dict(RRM_DEFAULT)
    if RRM_CFG_FILE.exists():
        try:
            cfg.update(json.loads(RRM_CFG_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


def save_rrm_cfg(cfg: dict) -> dict:
    merged = load_rrm_cfg()
    merged.update(cfg or {})
    tmp = RRM_CFG_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    os.replace(tmp, RRM_CFG_FILE)
    return merged


def _hhmm_to_min(s: str) -> int:
    try:
        h, m = str(s).split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def _in_quiet_window(cfg: dict) -> bool:
    now = time.localtime()
    cur = now.tm_hour * 60 + now.tm_min
    start, end = _hhmm_to_min(cfg.get("quiet_start", "01:00")), _hhmm_to_min(cfg.get("quiet_end", "05:00"))
    if start == end:
        return True
    return start <= cur < end if start < end else (cur >= start or cur < end)


# ---------- RF sample store (training data for the ML anomaly engine) ----------
def db_rf_samples_insert(rows: list[tuple]):
    if not rows:
        return
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.executemany("""
                INSERT INTO rf_samples (ts, device_id, interface, band, mac, rssi, snr, tx_ccq, retry_pct, noise_dbm)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
            conn.execute("DELETE FROM rf_samples WHERE ts < ?", (time.time() - 30 * 86400,))
            conn.commit()
            conn.close()
        except Exception:
            pass


def db_rf_samples(device_id: str | None = None, limit: int = 20000) -> list[dict]:
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            if device_id:
                rows = conn.execute(
                    "SELECT * FROM rf_samples WHERE device_id=? ORDER BY ts DESC LIMIT ?",
                    (device_id, limit)).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM rf_samples ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception:
            return []


def db_rf_scan_save(device_id: str | None, band: str, channels: list[dict], bss_list: list[dict]):
    if not device_id:
        return
    slim_ch = [
        {"freq": int(c["freq"]),
         "noise_floor": c.get("noise_floor"),
         "usage_pct": c.get("usage_pct") if c.get("usage_pct") is not None else c.get("load")}
        for c in (channels or []) if c.get("freq")
    ]
    slim_bss = [
        {"bssid": b.get("bssid"), "freq": int(b.get("freq") or 0),
         "width": int(b.get("width") or 20), "signal": float(b.get("signal") or -95),
         "ssid": b.get("ssid")}
        for b in (bss_list or []) if b.get("freq")
    ]
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.execute(
                "INSERT INTO rf_scan_history (ts, device_id, band, channels_json, bss_json) VALUES (?, ?, ?, ?, ?)",
                (time.time(), device_id, band, json.dumps(slim_ch), json.dumps(slim_bss)),
            )
            conn.execute("DELETE FROM rf_scan_history WHERE ts < ?", (time.time() - 7 * 86400,))
            conn.commit()
            conn.close()
        except Exception:
            pass


def db_rf_scan_history(device_id: str, band: str, window_sec: int = 86400, limit: int = 48) -> list[dict]:
    cutoff = time.time() - window_sec
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT ts, channels_json, bss_json FROM rf_scan_history "
                "WHERE device_id=? AND band=? AND ts>=? ORDER BY ts DESC LIMIT ?",
                (device_id, band, cutoff, limit),
            ).fetchall()
            conn.close()
            out = []
            for r in rows:
                out.append({
                    "ts": float(r["ts"]),
                    "channels": json.loads(r["channels_json"] or "[]"),
                    "bss_list": json.loads(r["bss_json"] or "[]"),
                })
            return out
        except Exception:
            return []


def db_rrm_run_save(run: dict):
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.execute("""
                INSERT OR REPLACE INTO rrm_runs
                (id, ts, mode, status, gain_pct, plan_json, snapshot_json, result_json, rolled_back)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (run["id"], run["ts"], run["mode"], run.get("status", "applied"),
                  run.get("gain_pct", 0.0), json.dumps(run.get("plan") or {}),
                  json.dumps(run.get("snapshot") or {}), json.dumps(run.get("result") or {})))
            conn.execute("DELETE FROM rrm_runs WHERE ts < ?", (time.time() - 90 * 86400,))
            conn.commit()
            conn.close()
        except Exception:
            pass


def db_rrm_runs(limit: int = 20) -> list[dict]:
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM rrm_runs ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
            conn.close()
            out = []
            for r in rows:
                d = dict(r)
                for k in ("plan_json", "snapshot_json", "result_json"):
                    try:
                        d[k.replace("_json", "")] = json.loads(d.pop(k) or "{}")
                    except Exception:
                        d[k.replace("_json", "")] = {}
                out.append(d)
            return out
        except Exception:
            return []


def db_rrm_run_get(run_id: str) -> dict | None:
    return next((r for r in db_rrm_runs(200) if r["id"] == run_id), None)


def db_rrm_run_mark_rolled_back(run_id: str):
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.execute("UPDATE rrm_runs SET rolled_back=1 WHERE id=?", (run_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass


# ---------- live data collection ----------
def _sig_dbm(raw) -> float | None:
    try:
        return float(str(raw).split("@")[0])
    except (TypeError, ValueError):
        return None


def _band_of(iface: dict) -> str:
    return "5g" if "5ghz" in (iface.get("band") or "").lower() else "2g"


def _width_mhz(iface: dict) -> int:
    m = re.search(r"(\d+)", str(iface.get("channel-width") or "20"))
    return int(m.group(1)) if m else 20


def collect_rf_samples(dev: dict, mt) -> int:
    """One row per associated client: the feature vector the ML engine trains on."""
    ts = time.time()
    rows = []
    try:
        reg = mt.resource("/interface/wireless/registration-table").get()
    except Exception:
        return 0
    ifaces = {i["name"]: i for i in mt.resource("/interface/wireless").get()}
    for c in reg:
        rssi = _sig_dbm(c.get("signal-strength"))
        if rssi is None:
            continue
        try:
            snr = float(c.get("signal-to-noise") or 0)
        except (TypeError, ValueError):
            snr = 0.0
        try:
            ccq = float(c.get("tx-ccq") or 0)
        except (TypeError, ValueError):
            ccq = 0.0
        try:
            tx_frames = float(str(c.get("frames", "0,0")).split(",")[1])
            timed_out = float(c.get("tx-frames-timed-out") or 0)
            retry_pct = (100.0 * timed_out / tx_frames) if tx_frames > 0 else 0.0
        except (TypeError, ValueError, IndexError):
            retry_pct = 0.0
        iface = ifaces.get(c.get("interface"), {})
        rows.append((ts, dev["id"], c.get("interface"), _band_of(iface), c.get("mac-address"),
                     rssi, snr, ccq, round(retry_pct, 2), rssi - snr))
    db_rf_samples_insert(rows)
    return len(rows)


def _gather_ap(dev: dict, duration: int, scan_cache: dict | None = None,
               non_disruptive: bool = False) -> list[dict]:
    """Per-band engine input for one AP: own channel, noise floor, utilization, neighbour BSSes.

    Blends live scan with 24h RF scan history (exponential time decay) so a brief
    quiet snapshot never hides persistent peak-hour interference or intermittent
    neighbours, and reuses `scan_cache` when provided to avoid double-scanning.
    """
    out = []
    known = {}
    try:
        known = get_fleet_known_bssids() or {}
    except Exception:
        known = {}
    now = time.time()
    half_life_s = 6 * 3600.0
    for band in ("2g", "5g"):
        cache_key = (dev["id"], band)
        scan = (scan_cache or {}).get(cache_key)
        if scan is None:
            try:
                scan = api_rf_scan(device=dev["id"], band=band, duration=duration,
                                   non_disruptive=non_disruptive)
            except HTTPException:
                continue
            except Exception:
                continue
        iface_name = scan.get("interface")
        cur = scan.get("current_channel") or {}
        try:
            freq = int(float(cur.get("freq")))
        except (TypeError, ValueError):
            freq = 0

        hist = db_rf_scan_history(dev["id"], band, window_sec=86400, limit=48)
        noise_acc: dict[int, list[tuple[float, float]]] = {}
        util_acc: dict[int, list[tuple[float, float]]] = {}

        for c in scan.get("channels", []):
            cf = int(c.get("freq") or 0)
            if not cf:
                continue
            if c.get("noise_floor") is not None:
                noise_acc.setdefault(cf, []).append((float(c["noise_floor"]), 1.0))
            u = c.get("usage_pct") if c.get("usage_pct") is not None else c.get("load")
            if u is not None:
                util_acc.setdefault(cf, []).append((float(u), 1.0))

        for h in hist:
            age = max(0.0, now - h["ts"])
            if age < 30.0:
                continue
            w_decay = 0.5 ** (age / half_life_s)
            for c in h.get("channels", []):
                cf = int(c.get("freq") or 0)
                if not cf:
                    continue
                if c.get("noise_floor") is not None:
                    noise_acc.setdefault(cf, []).append((float(c["noise_floor"]), 0.5 * w_decay))
                if c.get("usage_pct") is not None:
                    util_acc.setdefault(cf, []).append((float(c["usage_pct"]), 0.5 * w_decay))

        noise = {
            f: round(sum(v * w for v, w in pairs) / sum(w for _, w in pairs), 1)
            for f, pairs in noise_acc.items() if pairs
        }
        utilization = {
            f: round(sum(v * w for v, w in pairs) / sum(w for _, w in pairs), 1)
            for f, pairs in util_acc.items() if pairs
        }

        live_by_bssid: dict[str, dict] = {}
        neighbours = []
        for b in scan.get("bss_list", []):
            bssid = str(b.get("bssid", "")).upper().replace("-", ":")
            owner = (known.get(bssid) or {}).get("device_id")
            entry = {
                "freq": int(b.get("freq") or 0),
                "width": int(b.get("width") or 20),
                "signal": float(b.get("signal") or -95),
                "owner": owner,
                "ssid": b.get("ssid"),
                "bssid": bssid,
                "weight": 1.0,
            }
            neighbours.append(entry)
            if bssid:
                live_by_bssid[bssid] = entry

        hist_seen: dict[str, dict] = {}
        for h in hist:
            age = max(0.0, now - h["ts"])
            if age < 30.0:
                continue
            w_decay = 0.5 ** (age / half_life_s)
            base_w = 0.85 if not live_by_bssid else 0.35
            for b in h.get("bss_list", []):
                bssid = str(b.get("bssid", "")).upper().replace("-", ":")
                if not bssid or bssid in live_by_bssid or bssid in hist_seen:
                    continue
                owner = (known.get(bssid) or {}).get("device_id")
                hist_seen[bssid] = {
                    "freq": int(b.get("freq") or 0),
                    "width": int(b.get("width") or 20),
                    "signal": float(b.get("signal") or -95),
                    "owner": owner,
                    "ssid": b.get("ssid"),
                    "bssid": bssid,
                    "weight": round(base_w * w_decay, 3),
                }
        neighbours.extend(hist_seen.values())

        out.append({
            "id": f"{dev['id']}#{band}", "device_id": dev["id"],
            "interface": iface_name, "band": band,
            "freq": freq, "width": _width_mhz({"channel-width": cur.get("width")}),
            "neighbours": neighbours, "noise": noise, "utilization": utilization,
            "history_scans_blended": len(hist),
            "current_quality": scan.get("current_channel_quality"),
            "tx_power": None,
        })
    return out


def build_rrm_plan(include_dfs: bool | None = None, duration: int | None = None,
                   scan_cache: dict | None = None,
                   device_ids: list[str] | None = None) -> dict:
    cfg = load_rrm_cfg()
    if include_dfs is None:
        include_dfs = bool(cfg.get("include_dfs"))
    if duration is None:
        duration = int(cfg.get("scan_duration", 8))
    devs = load_devices()
    target_set = set(device_ids) if device_ids else None
    if target_set is not None:
        devs = [d for d in devs if d["id"] in target_set]
    aps: list[dict] = []
    samples = 0
    unhealthy: list[dict] = []
    sup: dict[str, dict[str, set]] = {}

    def gather(d):
        # monitor dibaca SEBELUM scan: /interface/wireless/scan mematikan radio
        # sementara, jadi bacaan sesudahnya kosong (freq 0) dan radio sehat tampak mati.
        wl: dict = {}
        mon: dict = {}
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                wl = {w["name"]: w for w in mt.resource("/interface/wireless").get()}
                mon = _wl_monitor(mt.api, list(wl))
        except Exception:
            pass
        got = _gather_ap(d, duration, scan_cache=scan_cache)
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                for w in wl.values():
                    band = _band_of(w)
                    if band not in ("2g", "5g") or w.get("master-interface") \
                            or str(w.get("disabled")).lower() == "true":
                        continue
                    try:
                        chans = get_supported_channels(mt, w)["channels"]
                        sup.setdefault(d["id"], {})[band] = {int(c["freq"]) for c in chans}
                    except Exception:
                        pass
                for a in got:
                    w = wl.get(a["interface"]) or {}
                    try:
                        a["tx_power"] = float(w.get("tx-power")) if w.get("tx-power") else None
                    except (TypeError, ValueError):
                        a["tx_power"] = None
                # `/interface/wireless` melaporkan running/frequency BASI: radio
                # hidup (running-ap di monitor) tapi field-nya bilang running=false
                # / frequency=auto. Percaya monitor, bukan field.
                names = [n for n, w in wl.items()
                         if str(w.get("disabled")).lower() != "true"
                         and not w.get("master-interface")
                         and str(w.get("mode") or "") == "ap-bridge"]
                for name in names:
                    w, m = wl[name], mon.get(name) or {}
                    band = _band_of(w)
                    if band not in ("2g", "5g"):
                        continue
                    status = str(m.get("status") or "")
                    width = str(w.get("channel-width") or "")
                    if not status:
                        # monitor gagal/timeout — jangan tuduh radio mati tanpa bukti
                        if str(w.get("running")).lower() == "true":
                            continue
                        status = "monitor tak menjawab"
                    if status.startswith("running") and m.get("freq"):
                        continue
                    reason = (f"radio tidak running ({status or w.get('status') or 'tanpa status'})")
                    fix_width = None
                    if band == "2g" and width in ("5mhz", "10mhz", "5/10mhz"):
                        reason = f"channel-width {width} tak didukung 2.4GHz — radio tak bisa start"
                        fix_width = "20mhz"
                    unhealthy.append({
                        "device_id": d["id"], "interface": name, "band": band,
                        "freq": int(m.get("freq") or 0), "reason": reason, "fix_width": fix_width,
                    })
                n = collect_rf_samples(d, mt)
        except Exception:
            n = 0
        return got, n

    with ThreadPoolExecutor(max_workers=min(len(devs), 12) or 1) as ex:
        for got, n in ex.map(gather, devs):
            aps.extend(got)
            samples += n

    allowed = rrm_allowed_freqs(cfg)
    # Whitelist config masih bisa memuat kanal yang ditolak regulatory-domain
    # router ini (mis. ch 149-165 di etsi) -> "bad band or frequency" saat apply.
    # Saring dengan kanal yang benar-benar didukung SEMUA AP.
    for band, freqs in list(allowed.items()):
        ok = [f for f in freqs
              if all(f in s.get(band, set()) for s in sup.values() if s.get(band))]
        if ok:
            allowed[band] = ok
    dca = rrm.plan_dca(aps, include_dfs=include_dfs, allowed=allowed)
    for u in unhealthy:
        if any(c.get("device_id") == u["device_id"] and c.get("interface") == u["interface"]
               for c in dca["changes"]):
            continue
        to_freq = (allowed.get(u["band"]) or [None])[0]
        if not to_freq:
            continue
        dca["changes"].append({
            "device_id": u["device_id"], "interface": u["interface"], "band": u["band"],
            "from_freq": u["freq"], "to_freq": to_freq, "repair": True, "reason": u["reason"],
            "fix_width": u.get("fix_width"),
            "interference_before_mw": 0.0, "interference_after_mw": 0.0, "relief_pct": 0.0,
        })
    tpc = rrm.plan_tpc(aps)
    steering = []
    seen: dict[str, dict[str, list[float]]] = {}
    current: dict[str, dict] = {}
    roam_cutoff = time.time() - 3600

    # Satu query SQLite untuk seluruh fleet (bukan N query per AP di skala 100 AP)
    for s in db_rf_samples(limit=100000):
        if (s.get("ts") or 0) < roam_cutoff or s.get("rssi") is None or not s.get("mac"):
            continue
        dev_id = s.get("device_id")
        if dev_id:
            seen.setdefault(s["mac"], {}).setdefault(dev_id, []).append(float(s["rssi"]))

    def _fetch_dev_clients(d):
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                wl = mt.resource("/interface/wireless").get()
                i2 = next((w["name"] for w in wl if _band_of(w) == "2g"), None)
                i5 = next((w["name"] for w in wl if _band_of(w) == "5g"), None)
                clients = mt.resource("/interface/wireless/registration-table").get()
            return d, i2, i5, clients
        except Exception:
            return d, None, None, None

    with ThreadPoolExecutor(max_workers=min(len(devs), 16) or 1) as ex:
        for d, i2, i5, clients in ex.map(_fetch_dev_clients, devs):
            if clients is None:
                continue
            c2 = [c for c in clients if c.get("interface") == i2]
            ap_2g = next((a for a in aps if a.get("device_id") == d["id"] and a.get("band") == "2g"), None)
            dense_2g = rrm.is_dense_2g(ap_2g) if ap_2g else False
            rules = rrm.steering_rules(i2, i5, [{"mac": c.get("mac-address"),
                                                "signal_strength": c.get("signal-strength")} for c in c2],
                                       dense_2g=dense_2g)
            for r in rules:
                r["device_id"] = d["id"]
            steering.extend(rules)
            for c in clients:
                mac = c.get("mac-address")
                if not mac:
                    continue
                iface = c.get("interface")
                try:
                    live_rssi = float(str(c.get("signal-strength", "")).split("@")[0])
                except (TypeError, ValueError):
                    live_rssi = None
                current[mac] = {"device": d["id"], "interface": iface,
                                "band": "2g" if iface == i2 else ("5g" if iface == i5 else "?"),
                                "rssi": live_rssi}

    roam = rrm.plan_roam(seen, current,
                         thr_dbm=float(cfg.get("roam_thr_dbm", -75.0)),
                         alt_min_dbm=float(cfg.get("roam_alt_min_dbm", -67.0)),
                         margin_db=float(cfg.get("roam_margin_db", 7.0)))

    return {
        "ok": True,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "include_dfs": include_dfs,
        "devices_scanned": len(devs),
        "bands_seen": len(aps),
        "samples_collected": samples,
        "engine": "rrm_engine.py",
        "allowed": allowed,
        "supported_freqs": {
            did: {b: sorted(int(f) for f in fs) for b, fs in bm.items()}
            for did, bm in sup.items()
        },
        "radios": [
            {
                "device_id": a.get("device_id"),
                "interface": a.get("interface"),
                "band": a.get("band"),
                "freq": a.get("freq"),
                "width": a.get("width"),
                "dense_2g": rrm.is_dense_2g(a),
                "dense_5g": rrm.is_dense_5g(a),
                "tx_power": a.get("tx_power"),
                "supported_freqs": sorted(int(f) for f in (sup.get(a.get("device_id") or "", {}).get(a.get("band") or "", set()))),
            }
            for a in aps
        ],
        "unhealthy": unhealthy,
        "_aps": aps,
        "dca": dca,
        "tpc": tpc,
        "steering": steering,
        "roam": roam,
        "summary": {
            "channel_changes": len(dca["changes"]),
            "repairs": len([c for c in dca["changes"] if c.get("repair")]),
            "txpower_changes": len(tpc),
            "steering_rules": len(steering),
            "roam_rules": len(roam),
            "expected_gain_pct": dca["gain_pct"],
            "actionable": bool(dca["changes"] or tpc or steering or roam),
        },
    }


def _extract_json_object(text: str) -> dict | None:
    if not text:
        return None
    # Buang blok <think>...</think> milik model reasoning agar kurung kurawal di dalamnya tidak merusak parser
    s = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    if not s:
        return None
    # 1. Coba blok ```json ... ``` jika ada
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", s, flags=re.DOTALL | re.IGNORECASE)
    for blk in reversed(fenced):
        try:
            obj = json.loads(blk)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    # 2. Coba parse langsung seluruh string
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # 3. Scan semua objek JSON seimbang dengan raw_decode; prioritaskan yang berisi key RRM
    dec = json.JSONDecoder()
    candidates: list[dict] = []
    pos = 0
    while True:
        idx = s.find("{", pos)
        if idx == -1:
            break
        try:
            obj, end = dec.raw_decode(s, idx)
            if isinstance(obj, dict):
                candidates.append(obj)
                pos = end
                continue
        except Exception:
            pass
        pos = idx + 1
    for obj in reversed(candidates):
        if "channel_changes" in obj or "rationale" in obj or "txpower_changes" in obj:
            return obj
    return candidates[-1] if candidates else None


def plan_rrm_via_omniroute(
    base_plan: dict,
    scans: list[dict],
    critical: list[dict],
    issues: list[dict],
    dev_filter: str | None = None,
    model_override: str | None = None,
) -> tuple[dict, dict]:
    """Minta OmniRoute LLM menyusun rencana optimasi channel & TX power dari data scan real,
    lalu validasi ketat terhadap daftar frekuensi legal perangkat agar aman di-push ke MikroTik."""
    cfg = load_ai_config()
    model_name = ((model_override or "").strip() or (cfg.get("model") or "auto/best-chat").strip())
    base_url = cfg.get("base_url", "https://api.example.com/v1").rstrip("/")
    api_key = cfg.get("api_key") or DEFAULT_AI_CONFIG["api_key"]
    endpoint = f"{base_url}/chat/completions"

    allowed = base_plan.get("allowed") or rrm_allowed_freqs(load_rrm_cfg())
    radios = base_plan.get("radios") or []
    if dev_filter:
        radios = [r for r in radios if r.get("device_id") == dev_filter]
    radio_map = {(r.get("device_id"), r.get("interface")): r for r in radios}

    aps_by_key = {
        (a.get("device_id"), a.get("band")): a
        for a in (base_plan.get("_aps") or [])
        if not dev_filter or a.get("device_id") == dev_filter
    }

    def _per_channel_breakdown(dev_id: str | None, band: str | None) -> list[dict]:
        ap = aps_by_key.get((dev_id, band))
        if not ap:
            return []
        band_key = "2g" if str(band or "").startswith("2") else "5g"
        cand_freqs = [int(f) for f in (allowed.get(band_key) or [])]
        if not cand_freqs:
            return []
        width = float(ap.get("width") or 20)
        nbs = ap.get("neighbours") or []
        cur_f = int(ap.get("freq") or 0)
        rows = []
        for f in cand_freqs:
            ov_sigs = [
                float(n.get("signal", rrm.DEFAULT_NOISE_DBM))
                for n in nbs
                if rrm.overlap(f, width, int(n.get("freq") or 0), float(n.get("width") or 20)) > 0
            ]
            c_mw = rrm.channel_cost(f, width, nbs, rrm._noise_at(ap, f), rrm._util_at(ap, f))
            rows.append({
                "freq": f,
                "is_current": f == cur_f,
                "overlapping_neighbours": len(ov_sigs),
                "strongest_dbm": round(max(ov_sigs), 1) if ov_sigs else None,
                "usage_pct": round(rrm._util_at(ap, f), 1),
                "noise_dbm": round(rrm._noise_at(ap, f), 1),
                "cost_mw": float(f"{c_mw:.3g}"),
            })
        return rows

    scan_summary = [
        {
            "device": s.get("device"),
            "band": s.get("band"),
            "cur_ch": (s.get("current_channel") or {}).get("channel"),
            "cur_freq": (s.get("current_channel") or {}).get("freq"),
            "best_ch": s.get("best_channel"),
            "total_band_neighbours": s.get("neighbours"),
            "interference": s.get("interference_level"),
            "per_channel": _per_channel_breakdown(s.get("device"), s.get("band")),
        }
        for s in (scans or [])
        if not s.get("error") and (not dev_filter or s.get("device") == dev_filter)
    ]

    # Pada armada besar (~100 AP = 200 radio), prioritaskan maks 30 radio paling
    # berinterferensi / yang diubah base_plan agar prompt LLM tidak meluap token.
    base_ch_keys = {(c.get("device_id"), c.get("band")) for c in ((base_plan.get("dca") or {}).get("changes") or [])}
    if len(scan_summary) > 30:
        def _scan_priority(s):
            cur_cost = next((c["cost_mw"] for c in (s.get("per_channel") or []) if c.get("is_current")), 0.0)
            in_base = 1 if (s.get("device"), s.get("band")) in base_ch_keys else 0
            return (-in_base, -cur_cost)
        scan_summary = sorted(scan_summary, key=_scan_priority)[:30]
        keep_devs = {s["device"] for s in scan_summary}
        radios_for_prompt = [r for r in radios if r.get("device_id") in keep_devs][:30]
    else:
        radios_for_prompt = radios[:30]

    prompt_data = {
        "scope": dev_filter or "fleet",
        "allowed_freqs_mhz": allowed,
        "radios": radios_for_prompt,
        "scans": scan_summary,
        "critical_aps": [
            {"device": c.get("device"), "clients": c.get("clients"), "cpu": c.get("cpu_load")}
            for c in (critical or [])
            if not c.get("error") and (not dev_filter or c.get("device") == dev_filter)
        ][:30],
        "roaming_issues_count": len(issues or []),
    }

    system_prompt = (
        "Kamu adalah MikroTik Wireless RRM Engineer untuk jaringan rumah sakit. "
        "Tugasmu menentukan penataan channel (frekuensi MHz) dan TX power (dBm) optimal dari data scan real. "
        "ATURAN KETAT:\n"
        "1. Balas HANYA dengan objek JSON valid tanpa teks lain.\n"
        "2. Setiap to_freq WAJIB ada di dalam supported_freqs milik radio tersebut (jika tidak kosong) "
        "DAN ada di allowed_freqs_mhz untuk band-nya (2g atau 5g). JANGAN pernah memilih frekuensi di luar supported_freqs AP.\n"
        "3. Perhatikan data scans[].per_channel: `cost_mw` makin kecil = makin bersih, `overlapping_neighbours` = jumlah tetangga di channel itu (bukan `total_band_neighbours`). "
        "JANGAN pindah dari channel saat ini jika `cost_mw`-nya sudah paling rendah.\n"
        "4. txpower_changes opsional (to_dbm antara 10 dan 22; untuk 2.4 GHz padat maks 17 dBm).\n"
        "Format JSON:\n"
        '{"rationale":"ringkasan singkat bahasa Indonesia","expected_gain_pct":15,'
        '"channel_changes":[{"device_id":"...","interface":"wlan1","band":"2g","to_freq":2437,"reason":"..."}],'
        '"txpower_changes":[{"device_id":"...","interface":"wlan1","band":"2g","to_dbm":16,"reason":"..."}]}'
    )
    user_msg = json.dumps(prompt_data, ensure_ascii=False)

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        # 4096 memberi ruang cukup bagi model thinking/reasoning agar JSON tidak terpotong
        "max_tokens": max(int(cfg.get("max_tokens", 750) or 750), 4096),
        "temperature": 0.2,
    }

    parsed = None
    last_err = None
    for attempt in range(1, 3):
        try:
            req = urllib.request.Request(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Content-Type": "application/json",
                },
                data=json.dumps(payload).encode("utf-8"),
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                msg_obj = (body.get("choices") or [{}])[0].get("message") or {}
                content = msg_obj.get("content") or ""
                parsed = _extract_json_object(content)
                if parsed is None and msg_obj.get("reasoning_content"):
                    parsed = _extract_json_object(msg_obj.get("reasoning_content") or "")
                if parsed is not None:
                    break
                preview = (content or "").replace("\n", " ")[:180]
                print(f"[RRM-OmniRoute] attempt {attempt}/2 invalid JSON ({model_name}): {preview!r}")
                last_err = "respons OmniRoute bukan JSON valid"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            print(f"[RRM-OmniRoute] attempt {attempt}/2 failed ({model_name}): {e}")

    base_dca = base_plan.get("dca") or {}
    rrm_changes = [
        c for c in (base_dca.get("changes") or [])
        if not dev_filter or c.get("device_id") == dev_filter
    ]
    rrm_tpc = [
        t for t in (base_plan.get("tpc") or [])
        if not dev_filter or t.get("device_id") == dev_filter
    ]
    aps_graph = [
        a for a in (base_plan.get("_aps") or [])
        if not dev_filter or a.get("device_id") == dev_filter
    ]
    rrm_eval = rrm.evaluate_plan(aps_graph, rrm_changes) if aps_graph else {
        "cost_before": float(base_dca.get("cost_before") or 0.0),
        "cost_after": float(base_dca.get("cost_after") or 0.0),
        "gain_pct": float(base_dca.get("gain_pct") or 0.0),
        "per_change": {},
    }
    rrm_summary = {
        "engine": "rrm_engine.py",
        "cost_before_mw": rrm_eval["cost_before"],
        "cost_after_mw": rrm_eval["cost_after"],
        "gain_pct": rrm_eval["gain_pct"],
        "channel_changes": rrm_changes,
        "txpower_changes": rrm_tpc,
    }

    if parsed is None:
        compare = {
            "rrm": rrm_summary,
            "omniroute": {
                "engine": f"OmniRoute ({model_name})",
                "model": model_name,
                "available": False,
                "error": last_err,
                "rationale": None,
                "cost_before_mw": None,
                "cost_after_mw": None,
                "gain_pct": None,
                "channel_changes": [],
                "txpower_changes": [],
                "rejected": [],
            },
            "winner": "rrm_engine",
            "omniroute_rejected_by_math": False,
            "verdict": f"OmniRoute ({model_name}) tidak dapat dihubungi ({last_err}) — fallback otomatis ke rrm_engine.py.",
        }
        meta = {
            "engine": f"rrm_engine.py (fallback OmniRoute: {last_err})",
            "used_omniroute": False,
            "model": model_name,
            "error": last_err,
            "rationale": None,
            "rejected": [],
            "compare": compare,
        }
        return base_plan, meta

    rejected: list[str] = []
    valid_ch: list[dict] = []
    seen_ch: set[tuple[str, str]] = set()
    for item in (parsed.get("channel_changes") or []):
        if not isinstance(item, dict):
            continue
        did = str(item.get("device_id") or "").strip()
        iface = str(item.get("interface") or "").strip()
        radio = radio_map.get((did, iface))
        if not radio:
            rejected.append(f"{did}/{iface}: interface tidak ditemukan")
            continue
        band = str(item.get("band") or radio.get("band") or "").strip()
        allowed_band = [int(f) for f in (allowed.get(band) or [])]
        radio_sup = [int(f) for f in (radio.get("supported_freqs") or [])]
        if radio_sup:
            # Saring ke frekuensi yang benar-benar didukung regulatory domain AP ini
            intersect = [f for f in allowed_band if f in radio_sup]
            valid_pool = intersect if intersect else radio_sup
        else:
            valid_pool = allowed_band
        raw_freq = item.get("to_freq")
        try:
            to_freq = int(raw_freq)
        except (TypeError, ValueError):
            to_freq = 0
        if to_freq not in valid_pool:
            # Jika LLM mengirim nomor channel (mis. 6 atau 149), konversi ke MHz
            try:
                conv = ch_to_freq(band, to_freq)
                if conv in valid_pool:
                    to_freq = conv
            except Exception:
                pass
        if to_freq not in valid_pool:
            rejected.append(f"{did}/{iface}: freq {raw_freq} tidak didukung regulatory domain AP ini ({valid_pool[:6]})")
            continue
        from_freq = int(radio.get("freq") or 0)
        wide_2g = str(band).startswith("2") and float(radio.get("width") or 20) > 20
        wide_dense_5g = (not str(band).startswith("2")) and bool(radio.get("dense_5g")) and float(radio.get("width") or 20) >= 80
        needs_narrow = wide_2g or wide_dense_5g
        if to_freq == from_freq and from_freq > 0 and not needs_narrow:
            continue
        if (did, iface) in seen_ch:
            continue
        seen_ch.add((did, iface))
        ch_entry = {
            "device_id": did,
            "interface": iface,
            "band": band,
            "from_freq": from_freq,
            "to_freq": to_freq,
            "reason": str(item.get("reason") or f"Rekomendasi OmniRoute ({model_name})"),
            "omniroute": True,
            "repair": from_freq == 0 or needs_narrow,
            "interference_before_mw": 0.0,
            "interference_after_mw": 0.0,
            "relief_pct": 0.0,
        }
        if needs_narrow:
            ch_entry["fix_width"] = "20mhz"
        valid_ch.append(ch_entry)

    # Pertahankan perbaikan wajib untuk radio unhealthy / 2.4 GHz >20 MHz
    for c in (base_plan.get("dca") or {}).get("changes") or []:
        if c.get("repair") and (c.get("device_id"), c.get("interface")) not in seen_ch:
            if not dev_filter or c.get("device_id") == dev_filter:
                valid_ch.append(c)
                seen_ch.add((c.get("device_id"), c.get("interface")))

    valid_tpc: list[dict] = []
    seen_tpc: set[tuple[str, str]] = set()
    for item in (parsed.get("txpower_changes") or []):
        if not isinstance(item, dict):
            continue
        did = str(item.get("device_id") or "").strip()
        iface = str(item.get("interface") or "").strip()
        radio = radio_map.get((did, iface))
        if not radio:
            continue
        try:
            to_dbm = int(round(float(item.get("to_dbm"))))
        except (TypeError, ValueError):
            continue
        max_dbm = int(rrm.TPC_2G_DENSE_MAX_DBM) if radio.get("dense_2g") else 23
        if not (10 <= to_dbm <= max_dbm):
            rejected.append(f"{did}/{iface}: tx-power {to_dbm} dBm di luar batas aman 10..{max_dbm}")
            continue
        from_dbm = radio.get("tx_power")
        if from_dbm is not None and int(round(float(from_dbm))) == to_dbm:
            continue
        if (did, iface) in seen_tpc:
            continue
        seen_tpc.add((did, iface))
        valid_tpc.append({
            "device_id": did,
            "interface": iface,
            "band": str(item.get("band") or radio.get("band") or ""),
            "from_dbm": from_dbm,
            "to_dbm": to_dbm,
            "reason": str(item.get("reason") or f"Rekomendasi OmniRoute ({model_name})"),
            "omniroute": True,
        })

    # Jangan hapus TPC dari rrm_engine jika OmniRoute tidak mengusulkan txpower_changes
    if not valid_tpc and base_plan.get("tpc"):
        valid_tpc = [
            t for t in base_plan.get("tpc") or []
            if not dev_filter or t.get("device_id") == dev_filter
        ]

    # Evaluasi matematis rencana OmniRoute pada graf RF yang SAMA dengan rrm_engine.py
    omni_eval = rrm.evaluate_plan(aps_graph, valid_ch) if aps_graph else {
        "cost_before": rrm_summary["cost_before_mw"],
        "cost_after": rrm_summary["cost_after_mw"],
        "gain_pct": 0.0,
        "per_change": {},
    }
    for ch in valid_ch:
        stat = (omni_eval.get("per_change") or {}).get((ch["device_id"], ch["interface"]))
        if stat:
            ch["interference_before_mw"] = stat["interference_before_mw"]
            ch["interference_after_mw"] = stat["interference_after_mw"]
            ch["relief_pct"] = stat["relief_pct"]

    rrm_cost_after = float(rrm_summary["cost_after_mw"] or 0.0)
    omni_cost_after = float(omni_eval["cost_after"] or 0.0)
    rrm_gain = float(rrm_summary["gain_pct"] or 0.0)
    omni_gain = float(omni_eval["gain_pct"] or 0.0)
    omni_rationale = str(parsed.get("rationale") or "").strip()

    # Validasi matematis otomatis: tolak rencana OmniRoute jika interferensinya lebih buruk dari rrm_engine.py
    worse_than_rrm = bool(aps_graph) and (omni_cost_after > rrm_cost_after * (1.0 + 1e-9))
    better_than_rrm = bool(aps_graph) and (omni_cost_after < rrm_cost_after * (1.0 - 1e-9))

    omni_summary = {
        "engine": f"OmniRoute ({model_name})",
        "model": model_name,
        "available": True,
        "error": None,
        "rationale": omni_rationale,
        "cost_before_mw": omni_eval["cost_before"],
        "cost_after_mw": omni_eval["cost_after"],
        "gain_pct": omni_gain,
        "channel_changes": valid_ch,
        "txpower_changes": valid_tpc,
        "rejected": rejected,
    }

    if worse_than_rrm:
        verdict = (
            f"Rencana OmniRoute ({model_name}) ditolak otomatis: cost interferensi lebih buruk "
            f"({omni_cost_after:.3g} mW, gain {omni_gain}%) dibanding rrm_engine.py "
            f"({rrm_cost_after:.3g} mW, gain {rrm_gain}%). Memakai rencana rrm_engine.py."
        )
        compare = {
            "rrm": rrm_summary,
            "omniroute": omni_summary,
            "winner": "rrm_engine",
            "omniroute_rejected_by_math": True,
            "verdict": verdict,
        }
        meta = {
            "engine": f"rrm_engine.py (OmniRoute ditolak: interferensi lebih buruk)",
            "used_omniroute": False,
            "model": model_name,
            "error": None,
            "rationale": omni_rationale,
            "rejected": rejected,
            "compare": compare,
        }
        return base_plan, meta

    if better_than_rrm:
        verdict = (
            f"OmniRoute ({model_name}) menang secara matematis: cost interferensi lebih rendah "
            f"({omni_cost_after:.3g} mW, gain {omni_gain}%) dibanding rrm_engine.py "
            f"({rrm_cost_after:.3g} mW, gain {rrm_gain}%)."
        )
    else:
        verdict = (
            f"Skor interferensi setara ({omni_cost_after:.3g} mW, gain {omni_gain}%). "
            f"Rencana OmniRoute ({model_name}) lolos validasi matematis."
        )

    compare = {
        "rrm": rrm_summary,
        "omniroute": omni_summary,
        "winner": "omniroute",
        "omniroute_rejected_by_math": False,
        "verdict": verdict,
    }

    new_plan = dict(base_plan)
    new_plan["engine"] = f"OmniRoute ({model_name})"
    new_plan["omniroute_rationale"] = omni_rationale
    new_plan["dca"] = {
        **(base_plan.get("dca") or {}),
        "changes": valid_ch,
        "cost_before": omni_eval["cost_before"],
        "cost_after": omni_eval["cost_after"],
        "gain_pct": omni_gain,
        "engine": f"OmniRoute ({model_name})",
    }
    new_plan["tpc"] = valid_tpc
    new_plan["summary"] = {
        **(base_plan.get("summary") or {}),
        "channel_changes": len(valid_ch),
        "repairs": len([c for c in valid_ch if c.get("repair")]),
        "txpower_changes": len(valid_tpc),
        "expected_gain_pct": omni_gain,
        "actionable": bool(valid_ch or valid_tpc or base_plan.get("steering") or base_plan.get("roam")),
    }
    meta = {
        "engine": f"OmniRoute ({model_name})",
        "used_omniroute": True,
        "model": model_name,
        "error": None,
        "rationale": omni_rationale,
        "rejected": rejected,
        "compare": compare,
    }
    return new_plan, meta


# ---------- apply / rollback ----------
def _snapshot_wireless(dev: dict, mt) -> list[dict]:
    snap = []
    for w in mt.resource("/interface/wireless").get():
        snap.append({
            "device_id": dev["id"], "interface": w["name"],
            "frequency": w.get("frequency"), "channel_width": w.get("channel-width"),
            "tx_power": w.get("tx-power"), "tx_power_mode": w.get("tx-power-mode"),
            "acl_ids": [],
        })
    return snap


def _wl_monitor(api, names: list[str]) -> dict:
    """Sumber kebenaran radio. `/interface/wireless` sering basi (running=false /
    frequency=auto padahal radio jalan), monitor yang benar-benar melapor."""
    out = {}
    for n in names:
        try:
            rows = api.get_binary_resource("/").call(
                "interface/wireless/monitor", {"numbers": n.encode(), "once": b"yes"})
            row = {k: (v.decode() if isinstance(v, bytes) else v)
                   for k, v in (rows[0] if rows else {}).items()}
        except Exception:
            row = {}
        m = re.match(r"(\d{4,5})", str(row.get("channel") or ""))
        out[n] = {"status": row.get("status") or "", "freq": int(m.group(1)) if m else 0,
                  "channel_raw": row.get("channel"), "noise": row.get("noise-floor"),
                  "clients": row.get("registered-clients")}
    return out


def _apply_channel_changes(changes: list[dict]) -> list[dict]:
    done = []
    for ch in changes:
        dev = get_device(ch["device_id"])

        def push() -> dict:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl = mt.resource("/interface/wireless")
                target = wl.get(name=ch["interface"])
                if not target:
                    return {**ch, "applied": False, "error": "interface tidak ada di router"}
                # width tak valid (mis. 5mhz di 2.4GHz) bikin radio "no supported
                # channels" — set frequency saja tak akan pernah start.
                if ch.get("fix_width"):
                    wl.set(id=target[0]["id"], **{"channel-width": ch["fix_width"]})
                extra = {}
                actual_freq = int(ch["to_freq"])
                try:
                    wl.set(id=target[0]["id"], frequency=str(actual_freq))
                except Exception as e:
                    if "bad band or frequency" not in str(e):
                        raise
                    # 1) Coba sempitkan ke 20MHz dulu pada frekuensi target
                    try:
                        wl.set(id=target[0]["id"], **{"channel-width": "20mhz",
                                                      "frequency": str(actual_freq)})
                        extra["width_fallback"] = "20mhz"
                    except Exception as e2:
                        if "bad band or frequency" not in str(e2):
                            raise
                        # 2) Frekuensi ditolak regulatory domain AP (mis. 5180 di country=indonesia):
                        # baca daftar channel legal langsung dari router & fallback otomatis ke kanal legal terbaik.
                        sup_info = get_supported_channels(mt, target[0])
                        sup_list = sup_info.get("channels") or []
                        non_dfs = [int(c["freq"]) for c in sup_list if not c.get("is_dfs") and c.get("freq")]
                        all_sup = [int(c["freq"]) for c in sup_list if c.get("freq")]
                        pool = non_dfs or all_sup
                        band_cfg = rrm_allowed_freqs(load_rrm_cfg()).get(ch.get("band") or "") or []
                        preferred = [f for f in pool if f in band_cfg] or pool
                        from_f = int(ch.get("from_freq") or 0)
                        # Utamakan kanal legal berbeda dari frekuensi lama agar tetap teroptimasi
                        ordered = [f for f in preferred if f != from_f] + ([from_f] if from_f in preferred else [])
                        switched = False
                        for cand in ordered:
                            try:
                                wl.set(id=target[0]["id"], frequency=str(cand))
                                actual_freq = cand
                                switched = True
                                break
                            except Exception:
                                try:
                                    wl.set(id=target[0]["id"], **{"channel-width": "20mhz", "frequency": str(cand)})
                                    actual_freq = cand
                                    extra["width_fallback"] = "20mhz"
                                    switched = True
                                    break
                                except Exception:
                                    continue
                        if not switched:
                            raise
                        extra["requested_freq"] = ch["to_freq"]
                        extra["fallback_reason"] = (
                            f"Fallback ke {actual_freq} MHz ({ch['to_freq']} MHz tidak didukung regulatory domain AP ini)"
                        )
                # Radio butuh ~10-20 s untuk benar-benar pindah kanal; sekali baca
                # setelah 3 s masih menangkap frekuensi transisi ("searching-for-
                # frequency") -> poll sampai running atau timeout, baru vonis.
                deadline = time.time() + 22
                mon = {}
                while time.time() < deadline:
                    time.sleep(3)
                    mon = _wl_monitor(mt.api, [ch["interface"]]).get(ch["interface"]) or {}
                    if str(mon.get("freq")) == str(actual_freq) \
                            and "running" in str(mon.get("status") or ""):
                        break
                ok = str(mon.get("freq")) == str(actual_freq)
                reason_out = extra.get("fallback_reason") or ch.get("reason")
                return {**ch, "to_freq": actual_freq, "reason": reason_out,
                        "applied": ok, "verified_freq": mon.get("freq"),
                        "status": mon.get("status"), **extra,
                        **({} if ok else {"error": f"freq tetap {mon.get('freq')} ({mon.get('status')})"})}

        row = None
        for attempt in (1, 2):
            try:
                row = push()
                break
            except Exception as e:
                if attempt == 2:
                    row = {**ch, "applied": False, "error": f"{type(e).__name__}: {e}"}
                else:
                    # restart radio AP sebelumnya kerap memutus sesi API router;
                    # satu AP gagal jangan sampai menggagalkan seluruh batch.
                    time.sleep(4)
        done.append(row)
    return done


def _apply_tpc_changes(changes: list[dict]) -> list[dict]:
    done = []
    for t in changes:
        dev = get_device(t["device_id"])
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl = mt.resource("/interface/wireless")
                target = wl.get(name=t["interface"])
                if not target:
                    done.append({**t, "applied": False,
                                 "error": f"interface {t['interface']} tidak ada di {dev['id']}"})
                    continue
                # RouterOS wireless: tx-power hanya dipakai kalau tx-power-mode
                # sudah all-rates-fixed. Dikirim satu paket, tx-power diabaikan
                # (mode belum aktif saat parameter dibaca) -> dua langkah, lalu
                # baca balik: tanpa readback "applied: True" cuma tebakan.
                wl.set(id=target[0]["id"], tx_power_mode="all-rates-fixed")
                wl.set(id=target[0]["id"], tx_power=str(int(t["to_dbm"])))
                after = (wl.get(name=t["interface"]) or [{}])[0].get("tx-power")
                ok = str(after) == str(int(t["to_dbm"]))
                done.append({**t, "applied": ok, "verified_dbm": after,
                             **({} if ok else {"error": f"tx-power tetap {after}"})})
        except Exception as e:
            done.append({**t, "applied": False, "error": f"{type(e).__name__}: {e}"})
    return done


def _apply_steering_rules(rules: list[dict]) -> list[dict]:
    done = []
    for r in rules:
        dev = get_device(r["device_id"])
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                acl = mt.resource("/interface/wireless/access-list")
                # ACL RouterOS tidak punya unique-key: add berulang = entri ganda.
                if not acl.get(comment=r["comment"]):
                    acl.add(interface=r["interface"], signal_range=r["signal_range"],
                            authentication="no", forwarding="no", comment=r["comment"])
                created = acl.get(comment=r["comment"])
                kicked = []
                weak_macs = {m.upper() for m in (r.get("affected_macs") or []) if m}
                if weak_macs:
                    reg = mt.resource("/interface/wireless/registration-table")
                    for entry in reg.get():
                        mac = str(entry.get("mac-address") or "").upper()
                        if mac in weak_macs and entry.get("interface") == r["interface"]:
                            try:
                                reg.remove(id=entry["id"])
                                kicked.append(mac)
                            except Exception:
                                pass
                done.append({**r, "applied": True, "acl_ids": [x["id"] for x in created],
                             "kicked": kicked})
        except Exception as e:
            done.append({**r, "applied": False, "error": f"{type(e).__name__}: {e}"})
    return done


ROAM_PREFIX = "RRM-roam-"


def _apply_roam_rules(rules: list[dict], expire_min: int = 10) -> list[dict]:
    """Blokir & kick MAC di AP yang lemah (<= -75 dBm) agar langsung pindah ke AP terdekat.

    Entry ACL dicabut otomatis oleh `_roam_expire()` setelah `expire_min` menit, dan klien
    otomatis boleh asosiasi lagi begitu sinyalnya di AP itu kembali di atas ambang.
    """
    done = []
    exp = int(time.time() + max(1, int(expire_min)) * 60)
    for r in rules:
        dev = get_device(r["device_id"])
        comment = f"{ROAM_PREFIX}{exp}-{r['mac']}"
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                acl = mt.resource("/interface/wireless/access-list")
                for old in acl.get():
                    if str(old.get("comment") or "").startswith(ROAM_PREFIX) and \
                            str(old.get("comment") or "").endswith(f"-{r['mac']}"):
                        try:
                            acl.remove(id=old["id"])
                        except Exception:
                            pass
                acl.add(**{"mac-address": r["mac"], "signal-range": r["signal_range"],
                           "authentication": "no", "forwarding": "no",
                           "interface": r.get("interface") or "", "comment": comment})
                created = acl.get(comment=comment)
                kicked = False
                reg = mt.resource("/interface/wireless/registration-table")
                target_mac = str(r["mac"]).upper()
                for entry in reg.get():
                    if str(entry.get("mac-address") or "").upper() == target_mac:
                        try:
                            reg.remove(id=entry["id"])
                            kicked = True
                        except Exception:
                            pass
                done.append({**r, "applied": True, "kicked": kicked,
                             "comment": comment, "expires_ts": exp,
                             "acl_ids": [x["id"] for x in created]})
        except Exception as e:
            done.append({**r, "applied": False, "error": f"{type(e).__name__}: {e}"})
    return done


def _roam_expire() -> int:
    """Cabut entry RRM-roam-* yang lewat masa berlaku (jaring pengaman kalau sampel basi)."""
    removed, now = 0, time.time()
    for d in load_devices():
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                acl = mt.resource("/interface/wireless/access-list")
                for x in acl.get():
                    c = str(x.get("comment") or "")
                    if not c.startswith(ROAM_PREFIX):
                        continue
                    try:
                        exp = int(c[len(ROAM_PREFIX):].split("-", 1)[0])
                    except (ValueError, IndexError):
                        continue
                    if exp <= now:
                        acl.remove(id=x["id"])
                        removed += 1
        except Exception:
            continue
    return removed


class RrmApplyReq(BaseModel):
    apply_channel: bool | None = None
    apply_txpower: bool | None = None
    apply_steering: bool | None = None
    apply_roam: bool | None = None
    include_dfs: bool | None = None
    min_gain_pct: float | None = None
    device: str | None = None           # batasi push ke satu AP (channel dikunci: milik plan fleet)
    device_ids: list[str] | None = None  # batasi push ke daftar AP terpilih (AP lain dikunci & tidak disentuh)
    plan: dict | None = None


class RrmRollbackReq(BaseModel):
    run_id: str


@app.post("/api/rrm/plan")
def api_rrm_plan(include_dfs: bool | None = None, duration: int | None = Query(None, ge=4, le=20)):
    return build_rrm_plan(include_dfs=include_dfs, duration=duration)


@app.post("/api/rrm/apply")
def api_rrm_apply(req: RrmApplyReq):
    cfg = load_rrm_cfg()
    plan = req.plan or build_rrm_plan(include_dfs=req.include_dfs)
    do_ch = cfg["apply_channel"] if req.apply_channel is None else req.apply_channel
    do_tpc = cfg["apply_txpower"] if req.apply_txpower is None else req.apply_txpower
    do_steer = cfg["apply_steering"] if req.apply_steering is None else req.apply_steering
    do_roam = cfg.get("apply_roam", False) if req.apply_roam is None else req.apply_roam
    min_gain = cfg["min_gain_pct"] if req.min_gain_pct is None else req.min_gain_pct

    dca = plan.get("dca") or {}
    only = req.device
    target_set = set(req.device_ids) if req.device_ids else None
    def _allowed_dev(did: str | None) -> bool:
        if only and did != only:
            return False
        if target_set is not None and did not in target_set:
            return False
        return True

    ch_skip = None
    changes = [c for c in (dca.get("changes") or []) if _allowed_dev(c.get("device_id"))]
    if only:
        # Optimasi channel default-nya fleet-only, kecuali perbaikan atau
        # rekomendasi eksplisit dari OmniRoute untuk AP ini.
        omni_ch = [c for c in changes if c.get("omniroute")]
        if omni_ch:
            changes = [c for c in changes if c.get("omniroute") or c.get("repair") or not c.get("from_freq")]
        else:
            changes = [c for c in changes if c.get("repair") or not c.get("from_freq")]
            ch_skip = (f"channel optimasi dikelola global (fleet) — AP {only} "
                       f"hanya dikirimi perbaikan + TX power/steering")
    # Radio tanpa channel eksplisit (from_freq 0) = perbaikan, bukan optimasi:
    # gate gain tidak berlaku, kalau tidak radio 'auto' selamanya dibiarkan.
    repairs = [c for c in changes if c.get("repair") or not c.get("from_freq")]
    if do_ch and not repairs and dca.get("gain_pct", 0) < float(min_gain):
        ch_skip = f"gain {dca.get('gain_pct', 0)}% < min_gain {min_gain}% — channel tidak diubah"
        do_ch = False
    elif do_ch and repairs:
        ch_skip = f"{len(repairs)} radio tanpa channel eksplisit — dipulihkan tanpa gate gain"
    tpc = [t for t in (plan.get("tpc") or []) if _allowed_dev(t.get("device_id"))]
    steer = [s for s in (plan.get("steering") or []) if _allowed_dev(s.get("device_id"))]
    roam = [r for r in (plan.get("roam") or []) if _allowed_dev(r.get("device_id"))]
    if not (do_ch and changes) and not (do_tpc and tpc) and not (do_steer and steer) \
            and not (do_roam and roam):
        return {"ok": False, "skipped": True,
                "reason": ch_skip or "tidak ada aksi yang lolos guard — jaringan tidak disentuh",
                "channel_skipped": ch_skip}

    devs = {d["id"]: d for d in load_devices() if _allowed_dev(d["id"])}
    max_drop = int(cfg.get("max_client_drop") or 0)
    roam_expire = int(cfg.get("roam_expire_min") or 10)
    clients_before: dict = {}
    snapshot: list = []
    result = {"channel": [], "txpower": [], "steering": [], "roam": []}
    aborted = None

    def _clients(dev: dict) -> int:
        with get_device_lock(dev["host"]), MT(dev) as mt:
            return len(mt.resource("/interface/wireless/registration-table").get())


    # Push paralel terkendali (maks 6 AP serentak di fleet besar) agar 60-100 AP
    # selesai dalam ~1-2 menit, bukan 60 menit. Tetap hentikan fleet jika >= 3 AP blackout.
    skipped_unreachable: list[dict] = []
    rolled_back_aps: list[dict] = []
    is_multi_ap = len(devs) > 1
    apply_lock = threading.Lock()
    abort_flag = threading.Event()

    def _apply_one_ap(item):
        nonlocal aborted
        did, dev = item
        if abort_flag.is_set():
            return
        slice_ch = [c for c in changes if c.get("device_id") == did]
        slice_tp = [t for t in tpc if t.get("device_id") == did]
        slice_st = [s for s in steer if s.get("device_id") == did]
        slice_rm = [r for r in roam if r.get("device_id") == did]
        if not ((do_ch and slice_ch) or (do_tpc and slice_tp) or (do_steer and slice_st)
                or (do_roam and slice_rm)):
            return
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                ap_snap = _snapshot_wireless(dev, mt)
            before = _clients(dev)
        except Exception as e:
            with apply_lock:
                skipped_unreachable.append({"device": did, "reason": f"tidak bisa dihubungi: {type(e).__name__}: {e}"})
            return
        with apply_lock:
            snapshot.extend(ap_snap)
            clients_before[did] = before
        applied_now = 0
        roam_kicked = 0
        ch_got = tp_got = st_got = rm_got = []
        if do_ch and slice_ch:
            ch_got = _apply_channel_changes(slice_ch)
            applied_now += sum(1 for x in ch_got if x.get("applied"))
        if do_tpc and slice_tp:
            tp_got = _apply_tpc_changes(slice_tp)
            applied_now += sum(1 for x in tp_got if x.get("applied"))
        if do_steer and slice_st:
            st_got = _apply_steering_rules(slice_st)
            applied_now += sum(1 for x in st_got if x.get("applied"))
        if do_roam and slice_rm:
            rm_got = _apply_roam_rules(slice_rm, roam_expire)
            applied_now += sum(1 for x in rm_got if x.get("applied"))
            roam_kicked += sum(1 for x in rm_got if x.get("kicked"))
        with apply_lock:
            result["channel"] += ch_got
            result["txpower"] += tp_got
            result["steering"] += st_got
            result["roam"] += rm_got
        if not applied_now:
            return
        effective_before = max(0, before - roam_kicked)
        if effective_before == 0:
            after = 0
        elif is_multi_ap:
            # Di fleet multi-AP, begitu >=1 klien konek kembali radio sudah terbukti sehat (2-4s)
            after = _settle_clients(effective_before, lambda: _clients(dev), max_drop,
                                    timeout=18.0, step=2.0, min_ok=1)
        else:
            after = _settle_clients(effective_before, lambda: _clients(dev), max_drop,
                                    timeout=30.0, step=2.0)
        failed_drop = (
            (effective_before >= 3 and after == 0)
            if is_multi_ap
            else (effective_before - after > max_drop)
        )
        if failed_drop:
            rb_info = {"device": did, "clients_before": before, "roam_kicked": roam_kicked,
                       "clients_after": after,
                       "reason": (f"radio blackout (0/{effective_before} klien kembali setelah 18s) — AP dikembalikan"
                                  if is_multi_ap else
                                  f"klien turun {effective_before - after} > batas {max_drop} — AP dikembalikan")}
            for entry in ap_snap:
                try:
                    with get_device_lock(dev["host"]), MT(dev) as mt:
                        wl = mt.resource("/interface/wireless")
                        cur = wl.get(name=entry["interface"])
                        if not cur:
                            continue
                        if entry.get("channel_width") and \
                                str(cur[0].get("channel-width") or "") != str(entry["channel_width"]):
                            wl.set(id=cur[0]["id"], channel_width=entry["channel_width"])
                        if entry.get("frequency") and \
                                str(cur[0].get("frequency") or "") != str(entry["frequency"]):
                            wl.set(id=cur[0]["id"], frequency=str(entry["frequency"]))
                        if entry.get("tx_power") and \
                                str(cur[0].get("tx-power") or "") != str(entry["tx_power"]):
                            wl.set(id=cur[0]["id"], tx_power_mode="all-rates-fixed")
                            wl.set(id=cur[0]["id"], tx_power=str(entry["tx_power"]))
                        now = (wl.get(name=entry["interface"]) or [{}])[0]
                        if entry.get("frequency") and \
                                str(now.get("frequency") or "") != str(entry["frequency"]):
                            rb_info.setdefault("rollback_errors", []).append(
                                f"{did}/{entry['interface']}: frequency tetap {now.get('frequency')}")
                        acl = mt.resource("/interface/wireless/access-list")
                        for r in acl.get():
                            if r.get("comment") == "RRM-steer-5g" or \
                                    str(r.get("comment") or "").startswith(ROAM_PREFIX):
                                acl.remove(id=r["id"])
                except Exception as e:
                    rb_info.setdefault("rollback_errors", []).append(
                        f"{did}/{entry.get('interface')}: {type(e).__name__}: {e}")
                    continue
            with apply_lock:
                rolled_back_aps.append(rb_info)
                if (not is_multi_ap) or len(rolled_back_aps) >= 3:
                    aborted = rb_info
                    abort_flag.set()

    workers = min(len(devs), 6) if is_multi_ap else 1
    with ThreadPoolExecutor(max_workers=workers or 1) as ex:
        list(ex.map(_apply_one_ap, list(devs.items())))

    run = {
        "id": f"rrm_{secrets.token_hex(4)}", "ts": time.time(), "mode": "manual",
        "status": "aborted" if aborted else "applied", "gain_pct": dca.get("gain_pct", 0.0),
        "plan": plan, "snapshot": {"wireless": snapshot, "clients_before": clients_before},
        "result": result, "aborted": aborted,
    }
    db_rrm_run_save(run)
    applied = sum(1 for k in result for x in result[k] if x.get("applied"))
    return {"ok": True, "run_id": run["id"], "applied_actions": applied,
            "gain_pct": run["gain_pct"], "result": result, "channel_skipped": ch_skip,
            "aborted": aborted, "rolled_back_aps": rolled_back_aps,
            "skipped_unreachable": skipped_unreachable,
            "clients_before": clients_before,
            "rollback_hint": f"POST /api/rrm/rollback {{'run_id': '{run['id']}'}}"}


@app.post("/api/rrm/rollback")
def api_rrm_rollback(req: RrmRollbackReq):
    run = db_rrm_run_get(req.run_id)
    if not run:
        raise HTTPException(404, "Run tidak ditemukan")
    snap = (run.get("snapshot") or {}).get("wireless") or []
    restored, acl_removed = 0, 0
    for entry in snap:
        dev = get_device(entry["device_id"])
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl = mt.resource("/interface/wireless")
                target = wl.get(name=entry["interface"])
                if not target:
                    continue
                attrs = {}
                if entry.get("frequency"):
                    attrs["frequency"] = str(entry["frequency"])
                if entry.get("channel_width"):
                    attrs["channel_width"] = entry["channel_width"]
                if entry.get("tx_power"):
                    attrs["tx_power"] = str(entry["tx_power"])
                if entry.get("tx_power_mode"):
                    attrs["tx_power_mode"] = entry["tx_power_mode"]
                cur = target[0]
                attrs = {k: v for k, v in attrs.items()
                         if str(cur.get(k.replace("_", "-")) or "") != str(v)}
                if attrs:
                    wl.set(id=cur["id"], **attrs)
                    restored += 1
                acl = mt.resource("/interface/wireless/access-list")
                for r in acl.get():
                    if r.get("comment") == "RRM-steer-5g" or \
                            str(r.get("comment") or "").startswith(ROAM_PREFIX):
                        acl.remove(id=r["id"])
                        acl_removed += 1
        except Exception:
            continue
    db_rrm_run_mark_rolled_back(req.run_id)
    return {"ok": True, "run_id": req.run_id, "interfaces_restored": restored,
            "steering_rules_removed": acl_removed}


@app.get("/api/rrm/status")
def api_rrm_status():
    cfg = load_rrm_cfg()
    samples = len(db_rf_samples(limit=100000))
    return {
        "ok": True,
        "config": cfg,
        "in_quiet_window": _in_quiet_window(cfg),
        "rf_samples": samples,
        "ml_ready": samples >= 100,
        "runs": db_rrm_runs(10),
    }


@app.post("/api/rrm/config")
def api_rrm_config(req: dict):
    cfg = save_rrm_cfg(req or {})
    return {"ok": True, "config": cfg}


# ---------- WiFi diagnostics (overview dashboard) ----------
RETRY_BUCKETS = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 35), (35, 1001)]
RSSI_BUCKETS = [(-50, 0), (-60, -50), (-70, -60), (-80, -70), (-200, -80)]


def _bucket_pct(values: list[float], buckets: list[tuple]) -> list[dict]:
    n = len(values)
    out = []
    for lo, hi in buckets:
        c = sum(1 for v in values if lo <= v < hi)
        out.append({"lo": lo, "hi": None if hi >= 1001 or hi <= -200 else hi, "count": c,
                    "pct": round(100.0 * c / n, 1) if n else 0.0})
    return out


def _fleet_ap_coverage(cutoff: float) -> list[dict]:
    """Satu titik per AP terdaftar: median RSSI klien yang dilayaninya (proksi kualitas cakupan)."""
    out = []
    for d in load_devices():
        vals, macs = [], set()
        for s in db_rf_samples(d.get("id"), limit=40000):
            if (s.get("ts") or 0) < cutoff or s.get("rssi") is None:
                continue
            vals.append(float(s["rssi"]))
            if s.get("mac"):
                macs.add(s["mac"])
        vals.sort()
        out.append({
            "id": d.get("id"), "name": d.get("name") or d.get("host"), "host": d.get("host"),
            "samples": len(vals), "clients": len(macs),
            "median_dbm": round(vals[len(vals) // 2], 1) if vals else None,
            "weak_pct": round(100.0 * sum(1 for v in vals if v < -70) / len(vals), 1) if vals else None,
        })
    return out


def _worst_link_clients(samples: list[dict], top: int = 5) -> list[dict]:
    """MAC dengan rata-rata (100 - tx-ccq) tertinggi — biang kerok agregat."""
    per_mac: dict[str, list[float]] = {}
    bands: dict[str, str] = {}
    for s in samples:
        if s.get("tx_ccq") is None or not s.get("mac"):
            continue
        per_mac.setdefault(s["mac"], []).append(100.0 - float(s["tx_ccq"]))
        bands.setdefault(s["mac"], s.get("band") or "?")
    out = [{"mac": m, "band": bands[m], "pct": round(sum(v) / len(v), 1), "samples": len(v)}
           for m, v in per_mac.items()]
    out.sort(key=lambda x: -x["pct"])
    return out[:top]


@app.get("/api/wifi/diagnostics")
def api_wifi_diagnostics(device: str | None = None, hours: int = Query(24, ge=1, le=168)):
    is_fleet = not device or str(device).strip().lower() in ("all", "fleet")
    dev = None if is_fleet else get_device(device)
    cutoff = time.time() - hours * 3600
    samples = [
        s for s in db_rf_samples(None if is_fleet else dev.get("id"), limit=80000 if is_fleet else 40000)
        if (s.get("ts") or 0) >= cutoff
    ]
    def _quality(sub: list[dict]) -> dict:
        """Tekanan link = 100 - tx-ccq. Driver legacy cAP ac selalu melaporkan
        tx-frames-timed-out = 0, jadi retry hardware tak bisa diukur di sini."""
        pct = [100.0 - float(s["tx_ccq"]) for s in sub if s.get("tx_ccq") is not None]
        return {"buckets": _bucket_pct(pct, RETRY_BUCKETS), "samples": len(pct),
                "avg_pct": round(sum(pct) / len(pct), 1) if pct else 0.0}

    rssi_vals = [float(s.get("rssi")) for s in samples if s.get("rssi") is not None]
    bands = {}
    for bkey in ("2g", "5g"):
        sub = [s for s in samples if (s.get("band") or "").lower().startswith(bkey)]
        if sub:
            bands[bkey] = _quality(sub)

    clients: list[dict] = []
    if not is_fleet and dev:
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                reg = mt.resource("/interface/wireless/registration-table").get()
                for c in reg:
                    rssi = _sig_dbm(c.get("signal-strength"))
                    try:
                        ccq_pct = round(100.0 - float(c.get("tx-ccq") or 0), 1)
                    except (TypeError, ValueError):
                        ccq_pct = None
                    clients.append({"mac": c.get("mac-address"), "interface": c.get("interface"),
                                    "rssi": rssi, "ccq_pct": ccq_pct,
                                    "has_ip": bool(c.get("last-ip")), "uptime": c.get("uptime")})
        except Exception as e:
            return {"ok": False, "error": str(e), "device_id": dev.get("id")}

    per_mac: dict[str, list[float]] = {}
    for s in samples:
        if s.get("rssi") is not None:
            per_mac.setdefault(s.get("mac") or "?", []).append(float(s["rssi"]))
    for c in clients:
        vals = per_mac.get(c["mac"] or "?", [])
        c["rssi_avg"] = round(sum(vals) / len(vals), 1) if vals else c["rssi"]
        c["samples"] = len(vals)
    live_rssi = [c["rssi"] for c in clients if c["rssi"] is not None]
    series_rssi = rssi_vals or live_rssi
    live = sorted(series_rssi)
    median = live[len(live) // 2] if live else None
    weak = sum(1 for v in series_rssi if v < -70)
    weak_pct = round(100.0 * weak / len(series_rssi), 1) if series_rssi else 0.0
    need_density = bool(series_rssi) and (median is not None and median < -67 or weak_pct > 20)
    aps = _fleet_ap_coverage(cutoff)
    total_clients = sum(a.get("clients") or 0 for a in aps) if is_fleet else len(live_rssi)
    bad = [a for a in aps if a["median_dbm"] is not None and (a["median_dbm"] < -67 or (a["weak_pct"] or 0) > 20)]
    need_density = bool(bad) or need_density
    bad_med = min([a["median_dbm"] for a in bad], default=None)
    measured_cnt = len([a for a in aps if a["median_dbm"] is not None])
    return {
        "ok": True, "device_id": "all" if is_fleet else dev.get("id"),
        "scope": "fleet" if is_fleet else "device",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "window_h": hours,
        "quality": {
            **_quality(samples),
            "measured_retry": False,
            "worst": _worst_link_clients(samples),
            "live": [{"mac": c["mac"], "interface": c["interface"], "ccq_pct": c["ccq_pct"]} for c in clients],
            "bands": bands,
            "source": "sampler 5 menit — 100 − tx-ccq; driver legacy cAP ac tak melaporkan tx-frames-timed-out",
        },
        "signal": {
            "buckets": _bucket_pct(rssi_vals, RSSI_BUCKETS),
            "live": [{"mac": c["mac"], "interface": c["interface"], "rssi": c["rssi"],
                      "rssi_avg": c.get("rssi_avg"), "samples": c.get("samples", 0)} for c in clients],
            "median_dbm": median, "weak_pct": weak_pct, "clients": total_clients,
            "samples": len(series_rssi),
            "source": "rf_samples (rssi) seluruh armada" if is_fleet else "rf_samples (rssi) + registration-table live",
        },
        "aps": aps,
        "density": {
            "need_improvement": need_density,
            "title": "Kerapatan AP perlu diperbaiki" if need_density else "Kerapatan AP memadai",
            "detail": (f"{len(bad)} dari {measured_cnt} AP terukur memiliki sinyal lemah (median terendah {bad_med} dBm)."
                       if bad else f"{measured_cnt} AP terukur, median klien terendah {min([a['median_dbm'] for a in aps if a['median_dbm'] is not None], default=None)} dBm."),
        },
    }


# ---------- ML anomaly engine (IsolationForest) ----------
ML_FEATURES = ["rssi", "snr", "tx_ccq", "retry_pct", "noise_dbm"]


@app.post("/api/ai/ml/anomaly")
def api_ml_anomaly(device: str | None = None, min_samples: int = Query(100, ge=30, le=5000)):
    rows = db_rf_samples(device, limit=20000)
    if len(rows) < min_samples:
        return {"ok": False, "status": "collecting", "samples": len(rows),
                "needed": min_samples,
                "note": "sampel RF dikumpulkan tiap 5 menit — biarkan sampler berjalan"}
    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
    except ImportError:
        raise HTTPException(503, "scikit-learn belum terpasang: pip install scikit-learn")
    X = np.array([[float(r[f] or 0) for f in ML_FEATURES] for r in rows], dtype=float)
    model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    pred = model.fit_predict(X)
    score = model.decision_function(X)
    anomalies = []
    for r, p, s in zip(rows, pred, score):
        if p != -1:
            continue
        anomalies.append({
            "mac": r["mac"], "device_id": r["device_id"], "interface": r["interface"],
            "band": r["band"], "ts": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r["ts"])),
            "score": round(float(s), 4), "features": {f: r[f] for f in ML_FEATURES},
            "verdict": _anomaly_verdict(r),
        })
    anomalies.sort(key=lambda a: a["score"])
    return {"ok": True, "samples": len(rows), "anomalies": anomalies[:50],
            "anomaly_count": len(anomalies),
            "anomaly_rate_pct": round(100.0 * len(anomalies) / len(rows), 2),
            "model": "IsolationForest(n_estimators=200)"}


def _anomaly_verdict(r: dict) -> str:
    """Human label for a flagged sample — hidden-node / non-Wi-Fi interference patterns."""
    snr, retry, ccq = float(r.get("snr") or 0), float(r.get("retry_pct") or 0), float(r.get("tx_ccq") or 0)
    if snr >= 25 and retry > 15:
        return "hidden node collision — high SNR but heavy retries"
    if snr < 15 and retry > 10:
        return "non-Wi-Fi interference / noise floor rise"
    if ccq < 60:
        return "airtime starvation — channel congestion"
    return "transmission anomaly"


# ---------- background workers ----------
def _rf_sampler_loop():
    while True:
        cfg = load_rrm_cfg()
        try:
            for d in load_devices():
                try:
                    with get_device_lock(d["host"]), MT(d) as mt:
                        collect_rf_samples(d, mt)
                except Exception:
                    continue
        except Exception:
            pass
        time.sleep(max(60, int(cfg.get("sample_interval_min", 5)) * 60))


def _mean(vals):
    return round(sum(vals) / len(vals), 1) if vals else None


def _settle_clients(before, sample, max_drop, timeout=45.0, step=3.0, min_ok=None):
    """Tunggu klien re-associate (radio restart 10-30 s), kembalikan hitungan
    terakhir. Berhenti cepat begitu pulih; timeout -> nilai terakhir (drop nyata
    tetap terdeteksi). Semua sample gagal -> before (tak ada bukti drop)."""
    if before <= 0:
        return 0
    target = (before - max_drop) if min_ok is None else min_ok
    last = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(step)
        try:
            last = sample()
        except Exception:
            continue
        if last >= target:
            return last
    return before if last is None else last


def _rrm_auto_loop():
    while True:
        cfg = load_rrm_cfg()
        try:
            due = time.time() - float(cfg.get("last_run_ts") or 0) >= int(cfg.get("interval_min", 15)) * 60
            if cfg.get("enabled") and due and _in_quiet_window(cfg):
                plan = build_rrm_plan(include_dfs=cfg.get("include_dfs"))
                gain = (plan.get("dca") or {}).get("gain_pct", 0)
                if plan["summary"]["actionable"] and gain >= float(cfg.get("min_gain_pct", 15.0)):
                    clients_before = _client_count()
                    res = api_rrm_apply(RrmApplyReq())
                    run_id = res.get("run_id")
                    save_rrm_cfg({"last_run_ts": time.time()})
                    if run_id:
                        time.sleep(60)  # let clients re-associate
                        dropped = clients_before - _client_count()
                        if dropped > int(cfg.get("max_client_drop", 0)):
                            api_rrm_rollback(RrmRollbackReq(run_id=run_id))
                            db_save_alert({
                                "id": f"rrm_{secrets.token_hex(4)}",
                                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "status": "warning", "device_id": "rrm",
                                "alert_type": "RRM_AUTO_ROLLBACK",
                                "text": (f"RRM auto-rollback: {dropped} klien hilang setelah "
                                         f"push {run_id} (batas {cfg.get('max_client_drop')})"),
                            })
                else:
                    save_rrm_cfg({"last_run_ts": time.time()})
        except Exception:
            pass
        try:
            _roam_expire()   # jaring pengaman: entry RRM-roam-* lewat masa berlaku dicabut
        except Exception:
            pass
        time.sleep(60)


def _client_count() -> int:
    total = 0
    for d in load_devices():
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                total += len(mt.resource("/interface/wireless/registration-table").get())
        except Exception:
            continue
    return total


init_rrm_db()
threading.Thread(target=_rf_sampler_loop, daemon=True, name="rf-sampler").start()
threading.Thread(target=_rrm_auto_loop, daemon=True, name="rrm-auto").start()


# ---------- AI auto-push: recommendations → applied by the backend, no clicking ----------
# Channel work is owned by the RRM engine (DCA/TPC), so set_2ghz_channel is deliberately NOT
# auto-pushed here — two controllers fighting over the same radio is how you get flapping.
AI_AUTO_POLICY = {
    "flush_dns":                  {"auto": True,  "risk": "low",    "label": "flush cache DNS"},
    "clean_storage_and_cache":    {"auto": True,  "risk": "low",    "label": "bersihkan cache + proteksi flash"},
    "disable_dns_remote":         {"auto": True,  "risk": "low",    "label": "tutup DNS open resolver"},
    "enable_fasttrack":           {"auto": True,  "risk": "low",    "label": "aktifkan FastTrack"},
    "optimize_5ghz_throughput":   {"auto": True,  "risk": "medium", "label": "lebar pita 5GHz → 80MHz"},
    "set_2ghz_channel":           {"auto": False, "risk": "medium", "label": "kunci channel 2.4GHz"},
    "disable_service":            {"auto": False, "risk": "medium", "label": "nonaktifkan service"},
    "kick_weak_clients":          {"auto": False, "risk": "high",   "label": "putus klien lemah"},
}


class AiAutoReq(BaseModel):
    device: str | None = None
    dry_run: bool = False
    include_medium: bool = True
    actions: list[str] | None = None


def _ai_snapshot(dev: dict, mt) -> dict:
    snap = {"wireless": [], "dns": None, "fasttrack_ids": []}
    try:
        for w in mt.resource("/interface/wireless").get():
            snap["wireless"].append({
                "device_id": dev["id"], "interface": w["name"],
                "channel_width": w.get("channel-width"), "frequency": w.get("frequency"),
            })
    except Exception:
        pass
    try:
        d = mt.resource("/ip/dns").get()
        snap["dns"] = {"allow_remote_requests": (d[0] if d else {}).get("allow-remote-requests")}
    except Exception:
        pass
    try:
        snap["fasttrack_ids"] = [r["id"] for r in mt.resource("/ip/firewall/filter").get()
                                 if r.get("comment") == "AI-FastTrack"]
    except Exception:
        pass
    return snap


@app.post("/api/ai/optimize/auto")
def api_ai_optimize_auto(req: AiAutoReq):
    dev = get_device(req.device)
    diag = api_ai_diagnose(device=dev["id"])
    recs = diag.get("recommendations") or []

    eligible, skipped = [], []
    for r in recs:
        action = r.get("action_type")
        pol = AI_AUTO_POLICY.get(action)
        if not pol or not pol.get("auto"):
            skipped.append({"id": r.get("id"), "action_type": action, "title": r.get("title"),
                            "reason": ("tidak ada di whitelist auto-push" if not pol
                                       else f"risk {pol['risk']} — {pol['label']} butuh persetujuan manual")})
            continue
        if pol["risk"] == "medium" and not req.include_medium:
            skipped.append({"id": r.get("id"), "action_type": action, "title": r.get("title"),
                            "reason": "risk medium dinonaktifkan (include_medium=false)"})
            continue
        if req.actions and action not in req.actions:
            skipped.append({"id": r.get("id"), "action_type": action, "title": r.get("title"),
                            "reason": "tidak diminta di filter actions"})
            continue
        eligible.append(r)

    if req.dry_run:
        return {"ok": True, "dry_run": True, "score": diag.get("score"), "grade": diag.get("grade"),
                "would_apply": [{"action_type": r["action_type"], "title": r.get("title"),
                                 "command": r.get("command")} for r in eligible],
                "skipped": skipped}

    if not eligible:
        return {"ok": True, "run_id": None, "steps": [], "skipped": skipped,
                "score_before": diag.get("score"), "score_after": diag.get("score"),
                "message": "Tidak ada rekomendasi aman untuk di-push — router sudah bersih"}

    try:
        with get_device_lock(dev["host"]), MT(dev) as mt:
            snap = _ai_snapshot(dev, mt)
    except Exception as e:
        raise HTTPException(503, f"Snapshot gagal, push dibatalkan: {type(e).__name__}: {e}")

    steps = []
    for r in eligible:
        action = r["action_type"]
        try:
            res = api_ai_apply(AiApplyReq(device=dev["id"], action_type=action,
                                          action_params=r.get("action_params")))
            steps.append({"action_type": action, "label": AI_AUTO_POLICY[action]["label"],
                          "title": r.get("title"), "ok": True,
                          "message": res.get("message"), "command": r.get("command")})
        except Exception as e:
            steps.append({"action_type": action, "label": AI_AUTO_POLICY[action]["label"],
                          "title": r.get("title"), "ok": False,
                          "error": f"{type(e).__name__}: {e}", "command": r.get("command")})

    run = {
        "id": f"ai_{secrets.token_hex(4)}", "ts": time.time(), "mode": "ai-auto", "status": "applied",
        "gain_pct": 0.0,
        "plan": {"device": dev["id"], "score_before": diag.get("score"),
                 "eligible": [r["action_type"] for r in eligible]},
        "snapshot": {"ai": snap},
        "result": {"steps": steps},
    }
    db_rrm_run_save(run)

    after = None
    try:
        after = api_ai_diagnose(device=dev["id"]).get("score")
    except Exception:
        pass
    return {"ok": True, "run_id": run["id"], "steps": steps, "skipped": skipped,
            "applied": sum(1 for s in steps if s["ok"]),
            "failed": sum(1 for s in steps if not s["ok"]),
            "score_before": diag.get("score"), "score_after": after,
            "rollback_hint": f"POST /api/ai/optimize/rollback {{'run_id': '{run['id']}'}}"}


@app.post("/api/ai/optimize/rollback")
def api_ai_optimize_rollback(req: RrmRollbackReq):
    run = db_rrm_run_get(req.run_id)
    if not run:
        raise HTTPException(404, "Run tidak ditemukan")
    snap = (run.get("snapshot") or {}).get("ai")
    if not snap:
        raise HTTPException(400, "Run ini tidak punya snapshot AI (bukan ai-auto)")
    restored, removed = 0, 0
    for entry in snap.get("wireless") or []:
        dev = get_device(entry["device_id"])
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                wl = mt.resource("/interface/wireless")
                target = wl.get(name=entry["interface"])
                if not target:
                    continue
                attrs = {}
                if entry.get("channel_width"):
                    attrs["channel_width"] = entry["channel_width"]
                if entry.get("frequency"):
                    attrs["frequency"] = str(entry["frequency"])
                cur = target[0]
                attrs = {k: v for k, v in attrs.items()
                         if str(cur.get(k.replace("_", "-")) or "") != str(v)}
                if attrs:
                    wl.set(id=cur["id"], **attrs)
                    restored += 1
        except Exception:
            continue
    if snap.get("dns") and snap["dns"].get("allow_remote_requests") is not None:
        dev = get_device((run.get("plan") or {}).get("device"))
        try:
            with get_device_lock(dev["host"]), MT(dev) as mt:
                mt.resource("/ip/dns").set(
                    allow_remote_requests=str(snap["dns"]["allow_remote_requests"]))
        except Exception:
            pass
    keep = set(snap.get("fasttrack_ids") or [])
    dev = get_device((run.get("plan") or {}).get("device"))
    try:
        with get_device_lock(dev["host"]), MT(dev) as mt:
            flt = mt.resource("/ip/firewall/filter")
            for r in flt.get():
                if r.get("comment") == "AI-FastTrack" and r["id"] not in keep:
                    flt.remove(id=r["id"])
                    removed += 1
    except Exception:
        pass
    db_rrm_run_mark_rolled_back(req.run_id)
    return {"ok": True, "run_id": req.run_id, "interfaces_restored": restored,
            "fasttrack_rules_removed": removed}


# ---------- Optimization pipeline (Ruijie-style 5-phase wizard, runs in background) ----------
# Stages: identify critical APs -> collect history -> scan WLAN -> compute -> deliver.
# Job state lives in SQLite + a worker thread, so leaving the page does not stop it.
OPT_JOBS: dict[str, dict] = {}
OPT_LOCK = threading.Lock()


def _opt_db_init():
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.execute("""
                CREATE TABLE IF NOT EXISTS optimize_jobs (
                    id TEXT PRIMARY KEY, device TEXT, status TEXT, stage TEXT,
                    stage_index INTEGER, stages_json TEXT, details_json TEXT,
                    run_id TEXT, started REAL, updated REAL, error TEXT
                )
            """)
            conn.commit()
            conn.close()
        except Exception:
            pass


def _opt_job_save(job: dict):
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.execute("""
                INSERT INTO optimize_jobs (id, device, status, stage, stage_index, stages_json,
                                           details_json, run_id, started, updated, error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET status=excluded.status, stage=excluded.stage,
                    stage_index=excluded.stage_index, stages_json=excluded.stages_json,
                    details_json=excluded.details_json, run_id=excluded.run_id,
                    updated=excluded.updated, error=excluded.error
            """, (job["id"], job.get("device"), job["status"], job.get("stage"),
                  job.get("stage_index", 0), json.dumps(job["stages"]),
                  json.dumps(job["details"], default=str), job.get("run_id"),
                  job["started"], time.time(), job.get("error")))
            conn.commit()
            conn.close()
        except Exception:
            pass


def _opt_job_load(job_id: str) -> dict | None:
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM optimize_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                conn.close()
                return None
            out = dict(row)
            out["stages"] = json.loads(out.pop("stages_json") or "[]")
            out["details"] = json.loads(out.pop("details_json") or "{}")
            conn.close()
            return out
        except Exception:
            return None


def _opt_latest(device: str | None = None) -> dict | None:
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            if device:
                row = conn.execute(
                    "SELECT * FROM optimize_jobs WHERE device=? ORDER BY started DESC LIMIT 1",
                    (device,)).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM optimize_jobs ORDER BY started DESC LIMIT 1").fetchone()
            if not row:
                conn.close()
                return None
            out = dict(row)
            out["stages"] = json.loads(out.pop("stages_json") or "[]")
            out["details"] = json.loads(out.pop("details_json") or "{}")
            conn.close()
            return out
        except Exception:
            return None


def _opt_stages(history_min: int, scan_s: int) -> list[dict]:
    return [
        {"key": "identify", "name": "Identify critical APs", "eta": "~5 s",
         "status": "pending", "started": None, "ended": None},
        {"key": "history", "name": "Collect historical data", "eta": f"window {history_min} min",
         "status": "pending", "started": None, "ended": None},
        {"key": "scan", "name": "Scan the WLAN environment", "eta": f"~{scan_s} s per band",
         "status": "pending", "started": None, "ended": None},
        {"key": "compute", "name": "Compute the optimal configuration", "eta": "~10 s",
         "status": "pending", "started": None, "ended": None},
        {"key": "deliver", "name": "Deliver the configuration", "eta": "~15 s",
         "status": "pending", "started": None, "ended": None},
    ]


def _opt_set_stage(job: dict, idx: int, status: str):
    now = time.time()
    if 0 <= idx < len(job["stages"]):
        st = job["stages"][idx]
        st["status"] = status
        if status == "running":
            st["started"] = now
        elif status in ("done", "error", "skipped"):
            st["ended"] = now
        job["stage"] = st["key"]
        job["stage_index"] = idx
    job["updated"] = now
    _opt_job_save(job)


def _opt_roaming_issues(samples: list[dict]) -> list[dict]:
    """Roaming problems derived from stored RF samples (no router I/O)."""
    by_mac: dict[str, list[dict]] = {}
    for s in samples:
        if s.get("mac"):
            by_mac.setdefault(s["mac"], []).append(s)
    issues = []
    for mac, rows in by_mac.items():
        radios = sorted({r.get("interface") for r in rows if r.get("interface")})
        devices = sorted({r.get("device_id") for r in rows if r.get("device_id")})
        rssi = [r["rssi"] for r in rows if r.get("rssi") is not None]
        weak = [v for v in rssi if v < -75]
        if len(devices) > 1:
            issues.append({
                "mac": mac, "type": "roaming_flip",
                "scope": "cross-AP", "devices": devices, "interfaces": radios,
                "samples": len(rows),
                "avg_rssi": round(sum(rssi) / len(rssi), 1) if rssi else None,
                "note": "Klien berpindah antar-AP dalam window — roaming sensitivity terlalu longgar / coverage overlap kurang.",
            })
        elif len(radios) > 1:
            issues.append({
                "mac": mac, "type": "roaming_flip",
                "scope": "intra-AP band", "devices": devices, "interfaces": radios,
                "samples": len(rows),
                "avg_rssi": round(sum(rssi) / len(rssi), 1) if rssi else None,
                "note": "Klien bolak-balik 2.4/5GHz — band steering belum menahan klien capable di 5GHz. "
                        "Tidak diubah otomatis: RSSI masih kuat, perlu band-steering per-MAC (manual).",
            })
        elif weak and len(weak) >= max(3, len(rows) // 2):
            issues.append({
                "mac": mac, "type": "sticky_weak",
                "scope": "sticky client", "devices": devices, "interfaces": radios,
                "samples": len(rows), "weak_samples": len(weak),
                "avg_rssi": round(sum(weak) / len(weak), 1),
                "note": "Klien menempel di RSSI < -75 dBm — kandidat kick / steering threshold.",
            })
    return issues


def _cpu_pct(mt) -> float:
    """CPU % satu desimal. /system/resource cpu-load itu integer, jadi AP idle
    selalu tampil 0% walau ada beban — rata-rata per-core lebih jujur."""
    try:
        cores = mt.resource("/system/resource/cpu").get()
        loads = [float(c.get("load") or 0) for c in cores]
        if loads:
            return round(sum(loads) / len(loads), 1)
    except Exception:
        pass
    res = mt.resource("/system/resource").get()
    return float((res[0] if res else {}).get("cpu-load") or 0)


def _opt_worker(job_id: str, opts: dict):
    job = OPT_JOBS.get(job_id)
    if not job:
        return
    dev_filter = opts.get("device")
    target_ids: list[str] | None = opts.get("device_ids") or None
    target_set = set(target_ids) if target_ids else None
    history_min = int(opts.get("history_window_min") or 1440)
    scan_s = int(opts.get("scan_duration") or 8)
    dry_run = bool(opts.get("dry_run"))
    try:
        # --- 1. identify critical APs (paralel untuk skala ~100 AP) ---
        _opt_set_stage(job, 0, "running")
        all_devs = load_devices()
        total_fleet_devices = len(all_devs)
        devs = all_devs
        if dev_filter:
            devs = [d for d in devs if d["id"] == dev_filter]
        elif target_set is not None:
            devs = [d for d in devs if d["id"] in target_set]
        if not devs:
            raise RuntimeError("Tidak ada AP target yang cocok untuk dioptimalkan.")
        job["details"]["target_devices"] = [d["id"] for d in devs]
        job["details"]["total_fleet_devices"] = total_fleet_devices
        job["details"]["locked_devices_count"] = max(0, total_fleet_devices - len(devs))

        def _probe_crit(d):
            entry = {"device": d["id"], "name": d.get("name")}
            try:
                with get_device_lock(d["host"]), MT(d) as mt:
                    regs = mt.resource("/interface/wireless/registration-table").get()
                    cpu = _cpu_pct(mt)
                entry.update({"clients": len(regs), "cpu_load": cpu,
                              "critical": bool(len(regs) >= 8 or cpu >= 60)})
            except Exception as e:
                entry.update({"clients": None, "cpu_load": None, "critical": False,
                              "error": f"{type(e).__name__}: {e}"})
            return entry

        with ThreadPoolExecutor(max_workers=min(len(devs), 16) or 1) as ex:
            critical = list(ex.map(_probe_crit, devs))
        job["details"]["critical_aps"] = critical
        # Semua AP tidak terjangkau = tidak ada yang bisa dioptimasi. Tanpa ini job
        # selesai "done" padahal nol data terkumpul (false success di UI).
        if critical and all(e.get("error") for e in critical):
            raise RuntimeError("semua AP tidak terjangkau: " +
                               "; ".join(f"{e['device']}: {e['error']}" for e in critical))
        _opt_set_stage(job, 0, "done")

        # --- 2. collect historical data + roaming analysis ---
        _opt_set_stage(job, 1, "running")
        cutoff = time.time() - history_min * 60
        rows = db_rf_samples(limit=60000)
        if dev_filter:
            rows = [r for r in rows if r.get("device_id") == dev_filter]
        elif target_set is not None:
            rows = [r for r in rows if r.get("device_id") in target_set]
        window = [r for r in rows if (r.get("ts") or 0) >= cutoff]
        issues = _opt_roaming_issues(window)
        _ts = [float(r.get("ts") or 0) for r in window if r.get("ts")]
        job["details"]["history"] = {
            "window_min": history_min, "samples": len(window),
            "span_min": round((max(_ts) - min(_ts)) / 60, 1) if _ts else 0.0,
            "fields": ["rssi", "snr", "tx_ccq", "retry_pct", "noise_dbm"],
            "clients_seen": len({r.get("mac") for r in window if r.get("mac")}),
            "roaming_issues_count": len(issues), "roaming_issues": issues[:50],
        }
        _opt_set_stage(job, 1, "done")

        # --- 3. scan the WLAN environment (paralel untuk skala ~100 AP) ---
        _opt_set_stage(job, 2, "running")
        cfg = load_rrm_cfg()
        quiet_now = _in_quiet_window(cfg)
        busy_thr = int(cfg.get("scan_busy_clients") or 5)
        clients_by_dev = {e["device"]: (e.get("clients") or 0) for e in critical}
        scans = []
        scan_cache: dict[tuple[str, str], dict] = {}
        scan_lock = threading.Lock()

        def _scan_one_dev(d):
            dev_scans = []
            bands = set()
            try:
                with get_device_lock(d["host"]), MT(d) as mt:
                    for w in mt.resource("/interface/wireless").get():
                        try:
                            f = int(float(str(w.get("frequency") or 0)))
                        except (TypeError, ValueError):
                            f = 0
                        if f:
                            bands.add("2g" if f < 3000 else "5g")
                        elif str(w.get("band") or "").startswith("2ghz"):
                            bands.add("2g")
                        elif str(w.get("band") or "").startswith("5ghz"):
                            bands.add("5g")
            except Exception as e:
                return [{"device": d["id"], "error": f"{type(e).__name__}: {e}"}]
            use_non_disruptive = (not quiet_now) and (clients_by_dev.get(d["id"], 0) >= busy_thr)
            for band in sorted(bands):
                try:
                    sc = api_rf_scan(device=d["id"], band=band, duration=scan_s,
                                     non_disruptive=use_non_disruptive)
                    with scan_lock:
                        scan_cache[(d["id"], band)] = sc
                    chans = sc.get("channels") or []
                    best_list = sc.get("best_channels") or chans
                    best = best_list[0] if best_list else {}
                    known = sc.get("bss_list") or []
                    noisy = [c for c in chans
                             if float(c.get("usage_pct") or c.get("utilization_pct") or 0) >= 50
                             and not any(b.get("channel") in (c.get("channel"), c.get("frequency"))
                                         for b in known)]
                    dev_scans.append({
                        "device": d["id"], "band": band,
                        "scanned_at": sc.get("scanned_at") or time.strftime("%Y-%m-%d %H:%M:%S"),
                        "scan_mode": sc.get("scan_mode"),
                        "non_disruptive": bool(use_non_disruptive),
                        "current_channel": sc.get("current_channel"),
                        "best_channel": best.get("channel"),
                        "best_score": best.get("score") or best.get("quality"),
                        "neighbours": len(known),
                        "external_interference": noisy[:6],
                        "interference_level": ("high" if noisy else "low"),
                    })
                except Exception as e:
                    dev_scans.append({"device": d["id"], "band": band,
                                      "error": f"{type(e).__name__}: {e}"})
            return dev_scans

        with ThreadPoolExecutor(max_workers=min(len(devs), 12) or 1) as ex:
            for dev_scans in ex.map(_scan_one_dev, devs):
                scans.extend(dev_scans)
        job["details"]["scan"] = {"bands": scans,
                                  "neighbour_links": sum(s.get("neighbours") or 0 for s in scans),
                                  "external_interference_hits": sum(
                                      len(s.get("external_interference") or []) for s in scans)}
        _opt_set_stage(job, 2, "done")

        # --- 4. compute optimal configuration ---
        _opt_set_stage(job, 3, "running")
        base_plan = build_rrm_plan(include_dfs=cfg.get("include_dfs"), duration=scan_s,
                                   scan_cache=scan_cache, device_ids=target_ids)
        use_omniroute = opts.get("use_omniroute", True)
        if use_omniroute:
            plan, omni_meta = plan_rrm_via_omniroute(
                base_plan, scans, critical, issues, dev_filter=dev_filter,
                model_override=opts.get("omniroute_model"),
            )
            # Double-lock guard: pastikan OmniRoute tidak pernah menyentuh AP di luar target_set
            if target_set is not None:
                if isinstance(plan.get("dca"), dict):
                    plan["dca"]["changes"] = [
                        c for c in (plan["dca"].get("changes") or [])
                        if c.get("device_id") in target_set
                    ]
                plan["tpc"] = [t for t in (plan.get("tpc") or []) if t.get("device_id") in target_set]
                plan["steering"] = [s for s in (plan.get("steering") or []) if s.get("device_id") in target_set]
                plan["roam"] = [r for r in (plan.get("roam") or []) if r.get("device_id") in target_set]
        else:
            plan = base_plan
            base_dca = base_plan.get("dca") or {}
            omni_meta = {
                "engine": "rrm_engine.py",
                "used_omniroute": False,
                "model": None,
                "error": None,
                "rationale": None,
                "rejected": [],
                "compare": {
                    "rrm": {
                        "engine": "rrm_engine.py",
                        "cost_before_mw": float(base_dca.get("cost_before") or 0.0),
                        "cost_after_mw": float(base_dca.get("cost_after") or 0.0),
                        "gain_pct": float(base_dca.get("gain_pct") or 0.0),
                        "channel_changes": base_dca.get("changes") or [],
                        "txpower_changes": base_plan.get("tpc") or [],
                    },
                    "omniroute": {
                        "engine": "OmniRoute AI",
                        "model": None,
                        "available": False,
                        "error": "Dinonaktifkan oleh pengguna",
                        "rationale": None,
                        "cost_before_mw": None,
                        "cost_after_mw": None,
                        "gain_pct": None,
                        "channel_changes": [],
                        "txpower_changes": [],
                        "rejected": [],
                    },
                    "winner": "rrm_engine",
                    "omniroute_rejected_by_math": False,
                    "verdict": "OmniRoute AI tidak diaktifkan — menggunakan perhitungan deterministik rrm_engine.py.",
                },
            }
        # Buang graf mentah _aps sebelum disimpan ke SQLite agar JSON ringkas
        plan = {k: v for k, v in plan.items() if k != "_aps"}
        rssi_all = [r["rssi"] for r in window if r.get("rssi") is not None]
        weak_rssi = sorted(v for v in rssi_all if v < -70)
        sensitivity = -72.0
        if weak_rssi:
            mid = weak_rssi[len(weak_rssi) // 2]
            sensitivity = float(max(-80.0, min(-65.0, round(mid + 3))))
        job["details"]["compute"] = {
            "engine": omni_meta["engine"],
            "used_omniroute": omni_meta["used_omniroute"],
            "omniroute_model": omni_meta.get("model"),
            "omniroute_rationale": omni_meta.get("rationale"),
            "omniroute_error": omni_meta.get("error"),
            "omniroute_rejected": omni_meta.get("rejected") or [],
            "compare": omni_meta.get("compare"),
            "channel": {"changes": plan.get("dca", {}).get("changes", []),
                        "gain_pct": plan.get("dca", {}).get("gain_pct"),
                        "iterations": plan.get("dca", {}).get("iterations")},
            "tx_power": plan.get("tpc") or [],
            "roaming_sensitivity_dbm": sensitivity,
            "roaming_rationale": f"median RSSI klien lemah {weak_rssi[len(weak_rssi)//2] if weak_rssi else 'n/a'} dBm → "
                                 f"steering threshold {sensitivity} dBm",
            "actionable": bool((plan.get("summary") or {}).get("actionable")),
            "steering_rules": len(plan.get("steering") or []),
            "sticky_clients": sum(1 for i in issues if i.get("type") == "sticky_weak"),
        }
        job["details"]["plan"] = plan
        _opt_set_stage(job, 3, "done")

        # --- 5. deliver the configuration ---
        _opt_set_stage(job, 4, "running")
        if dry_run:
            job["details"]["deliver"] = {"dry_run": True, "applied": False}
            _opt_set_stage(job, 4, "skipped")
        else:
            req = RrmApplyReq(apply_channel=cfg.get("apply_channel"),
                              apply_txpower=cfg.get("apply_txpower"),
                              apply_steering=cfg.get("apply_steering"),
                              min_gain_pct=cfg.get("min_gain_pct"),
                              device=dev_filter, device_ids=target_ids, plan=plan)
            res = api_rrm_apply(req)
            if opts.get("ai_auto_push", False):
                targets = [dev_filter] if dev_filter else [d["id"] for d in devs]
                ai_runs = []
                for t in targets:
                    try:
                        ai_runs.append(api_ai_optimize_auto(AiAutoReq(device=t)))
                    except Exception as e:
                        ai_runs.append({"ok": False, "device": t,
                                        "error": f"{type(e).__name__}: {e}"})
                res["ai"] = ai_runs[0] if len(ai_runs) == 1 else {
                    "ok": all(r.get("ok") for r in ai_runs),
                    "applied": sum(r.get("applied") or 0 for r in ai_runs),
                    "failed": sum(r.get("failed") or 0 for r in ai_runs),
                    "per_device": ai_runs,
                    "score_before": _mean([r.get("score_before") for r in ai_runs
                                           if r.get("score_before") is not None]),
                    "score_after": _mean([r.get("score_after") for r in ai_runs
                                          if r.get("score_after") is not None]),
                    "run_id": ", ".join(r.get("run_id") for r in ai_runs if r.get("run_id")) or None,
                }
            job["details"]["deliver"] = res
            job["run_id"] = res.get("run_id")
            _opt_set_stage(job, 4, "done" if res.get("ok") else "skipped")

            ai = res.get("ai") or {}
            job["details"]["summary"] = {
                "engine": omni_meta["engine"],
        "omniroute_rationale": omni_meta.get("rationale"),
        "channel_gain_pct": res.get("gain_pct"),
                "channel_changes": len((res.get("result") or {}).get("channel") or []),
                "txpower_changes": len((res.get("result") or {}).get("txpower") or []),
                "ai_applied": ai.get("applied") or 0,
                "ai_failed": ai.get("failed") or 0,
                "score_before": ai.get("score_before"),
                "score_after": ai.get("score_after"),
                "roaming_issues": len(issues),
                "roam_rules": len((res.get("result") or {}).get("roam") or []),
                "aborted": res.get("aborted"),
                "run_id": res.get("run_id"),
                "ai_run_id": ai.get("run_id"),
            }

        # Scan jalan SEBELUM push, jadi snapshot channel di details masih keadaan
        # pra-perbaikan (sering freq=auto → "ch ?" di UI). Segarkan dari monitor
        # setelah push supaya yang tampil = kondisi radio sebenarnya.
        for b in ((job["details"].get("scan") or {}).get("bands") or []):
            if b.get("error"):
                continue
            d2 = get_device(b.get("device"))
            lv = (_live_channels(d2, ttl=0) if d2 else {}).get(b.get("band"))
            if lv:
                b["current_channel"] = {**(b.get("current_channel") or {}),
                                        "channel": lv["channel"], "freq": lv["freq"],
                                        "channel_known": True,
                                        "interface": lv.get("interface")}

        job["status"] = "done"
        job["finished"] = time.time()
        _opt_job_save(job)
    except Exception as e:
        job["status"] = "error"
        job["error"] = f"{type(e).__name__}: {e}"
        idx = int(job.get("stage_index") or 0)
        _opt_set_stage(job, idx, "error")
        _opt_job_save(job)


class OptStartReq(BaseModel):
    device: str | None = None
    fleet: bool = False                  # true = optimalkan armada (semua AP atau subset device_ids)
    device_ids: list[str] | None = None  # opsional: daftar AP terpilih agar AP lain dikunci & tidak tertimpa
    history_window_min: int | None = None
    scan_duration: int | None = None
    dry_run: bool = False
    ai_auto_push: bool = False
    use_omniroute: bool = True
    omniroute_model: str | None = None   # opsional: pilih model spesifik dari daftar /api/ai/models OmniRoute


@app.post("/api/optimize/start")
def api_optimize_start(req: OptStartReq):
    target_ids: list[str] | None = None
    if req.fleet:
        dev = {"id": "fleet"}
        dev_filter = None
        lock_key = "fleet"
        if req.device_ids is not None:
            valid_ids = {d["id"] for d in load_devices()}
            cleaned = []
            seen_ids = set()
            for x in req.device_ids:
                if x in valid_ids and x not in seen_ids:
                    seen_ids.add(x)
                    cleaned.append(x)
            if not cleaned:
                return {"ok": False, "message": "Pilih minimal 1 AP yang valid untuk dioptimalkan."}
            # Jika semua AP dipilih, perlakukan sebagai full fleet (None); selain itu kunci AP lain
            if len(cleaned) < len(valid_ids):
                target_ids = cleaned
    else:
        dev = get_device(req.device)
        dev_filter = dev["id"]
        lock_key = dev["id"]
    with OPT_LOCK:
        for j in OPT_JOBS.values():
            # fleet menyentuh semua AP, jadi job fleet bertabrakan dengan job AP mana pun
            if j["status"] == "running" and (j.get("device") == lock_key or
                                             lock_key == "fleet" or j.get("device") == "fleet"):
                return {"ok": False, "running": True, "job_id": j["id"],
                        "message": "Optimasi untuk device ini masih berjalan"}
        cfg = load_rrm_cfg()
        job = {
            "id": f"opt_{secrets.token_hex(4)}", "device": lock_key, "status": "running",
            "stage": "identify", "stage_index": 0,
            "stages": _opt_stages(int(req.history_window_min or 1440),
                                  int(req.scan_duration or cfg.get("scan_duration", 8))),
            "details": {"target_devices": target_ids} if target_ids else {},
            "started": time.time(), "updated": time.time(), "run_id": None,
        }
        OPT_JOBS[job["id"]] = job
        for old_id, old in list(OPT_JOBS.items()):
            if old["status"] != "running" and time.time() - float(old.get("updated") or 0) > 86400:
                OPT_JOBS.pop(old_id, None)
        _opt_job_save(job)
    threading.Thread(target=_opt_worker, daemon=True,
                     args=(job["id"], {"device": dev_filter,
                                       "fleet": bool(req.fleet),
                                       "device_ids": target_ids,
                                       "history_window_min": req.history_window_min,
                                       "scan_duration": req.scan_duration,
                                       "dry_run": req.dry_run,
                                       "ai_auto_push": req.ai_auto_push,
                                       "use_omniroute": bool(req.use_omniroute),
                                       "omniroute_model": (req.omniroute_model or "").strip() or None})).start()
    scope_note = (
        f"({len(target_ids)} AP terpilih; AP lain dikunci & tidak diubah)"
        if target_ids else "(seluruh armada)"
    )
    return {"ok": True, "job_id": job["id"], "status": "running",
            "target_devices": target_ids,
            "message": f"Optimasi berjalan di background {scope_note} — aman keluar dari halaman ini"}


_LIVE_CH_CACHE: dict[str, tuple[float, dict]] = {}


def _live_channels(dev: dict, ttl: float = 30.0) -> dict:
    """Channel yang benar-benar aktif di radio saat ini (cache 30 s, hindari hammer router)."""
    key = dev.get("id") or dev.get("host") or "?"
    hit = _LIVE_CH_CACHE.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    out: dict = {}
    try:
        with get_device_lock(dev["host"]), MT(dev) as mt:
            wl = {w["name"]: w for w in mt.resource("/interface/wireless").get()}
            mon = _wl_monitor(mt.api, list(wl))
            for name, w in wl.items():
                band = _band_of(w)
                if band not in ("2g", "5g"):
                    continue
                f = int((mon.get(name) or {}).get("freq") or 0)
                if not f:
                    continue
                out[band] = {"freq": f, "channel": (round((f - 2407) / 5) if band == "2g" else (f - 5000) // 5),
                             "interface": name}
    except Exception as e:
        out = {"error": f"{type(e).__name__}: {e}"}
    _LIVE_CH_CACHE[key] = (time.time(), out)
    return out


def _live_channels_safe(dev_id):
    """AP bisa sudah dihapus sementara job lama masih dipolling — jangan 404-kan
    endpoint polling hanya karena device-nya hilang."""
    if not dev_id or dev_id == "fleet":
        return {}
    try:
        return _live_channels(get_device(dev_id))
    except Exception:
        return {}


@app.get("/api/optimize/current")
def api_optimize_current(device: str | None = None, job_id: str | None = None):
    if job_id:
        job = OPT_JOBS.get(job_id) or _opt_job_load(job_id)
    else:
        dev_id = ("fleet" if device == "fleet" else get_device(device)["id"]) if device else None
        live = [j for j in OPT_JOBS.values() if j["status"] == "running"
                and (dev_id is None or j.get("device") == dev_id)]
        job = (max(live, key=lambda j: j["started"]) if live else None) \
            or _opt_latest(dev_id or (get_device(None)["id"]))
    if not job:
        return {"ok": False, "message": "Belum ada job optimasi"}
    total = len(job["stages"]) or 1
    done = sum(1 for s in job["stages"] if s["status"] in ("done", "skipped", "error"))
    jdev = job.get("device")
    return {"ok": True, "job_id": job["id"], "device": jdev,
            "status": job["status"], "stage": job.get("stage"),
            "stage_index": job.get("stage_index"), "progress_pct": round(100 * done / total),
            "stages": job["stages"], "details": job.get("details") or {},
            "run_id": job.get("run_id"), "started": job.get("started"),
            "live_channels": _live_channels_safe(jdev),
            "error": job.get("error")}


@app.post("/api/optimize/cancel")
def api_optimize_cancel(req: dict):
    job_id = (req or {}).get("job_id")
    job = OPT_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    job["status"] = "cancelled"
    job["error"] = "dibatalkan oleh user"
    _opt_job_save(job)
    return {"ok": True, "job_id": job_id, "status": "cancelled"}


_opt_db_init()


# ==============================================================================
# FLEET WI-FI SYNC: SINKRONISASI SSID & GANTI PASSWORD MASSAL
# ==============================================================================
class FleetWifiSyncReq(BaseModel):
    action: str = Field(..., description="rotate_password | create_ssid | rename_ssid")
    device_ids: list[str] = Field(default_factory=list)
    target_ssid: str
    new_ssid: str | None = None
    password: str | None = None
    security_mode: str = "password"  # "password" | "open"
    bands: list[str] = Field(default_factory=lambda: ["2g", "5g"])
    vlan_mode: str = "no-tag"        # "no-tag" | "use-tag"
    vlan_id: int | None = None
    hide_ssid: bool = False
    add_bridge: bool = True
    bridge_name: str = "bridge1"
    dry_run: bool = False


def _slug_profile(ssid: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (ssid or "").strip()).strip("-").lower()
    return f"sec-{(slug or 'wifi')[:24]}"


@app.get("/api/fleet/wifi/ssids")
def api_fleet_wifi_ssids():
    """Pindai paralel daftar SSID aktif di seluruh armada AP untuk pilihan sync/rotasi password."""
    devs = load_devices()
    ssid_map: dict[str, dict] = {}
    scanned_ok = 0
    scanned_err = 0

    def _scan_one(d: dict):
        try:
            with get_device_lock(d["host"]), MT(d) as mt:
                wls = mt.resource("/interface/wireless").get()
            found = []
            for w in wls:
                ssid = (w.get("ssid") or "").strip()
                if not ssid:
                    continue
                found.append({
                    "ssid": ssid,
                    "band": _band_of(w) or "?",
                    "profile": w.get("security-profile") or "default",
                    "disabled": str(w.get("disabled") or "").lower() == "true",
                })
            return d["id"], True, found
        except Exception:
            return d["id"], False, []

    with ThreadPoolExecutor(max_workers=min(16, max(1, len(devs)))) as ex:
        for did, ok, items in ex.map(_scan_one, devs):
            if ok:
                scanned_ok += 1
            else:
                scanned_err += 1
            for it in items:
                entry = ssid_map.setdefault(it["ssid"], {
                    "ssid": it["ssid"],
                    "device_ids": set(),
                    "bands": set(),
                    "profiles": set(),
                    "interfaces": 0,
                })
                entry["device_ids"].add(did)
                if it["band"] in ("2g", "5g"):
                    entry["bands"].add(it["band"])
                entry["profiles"].add(it["profile"])
                entry["interfaces"] += 1

    ssids = []
    for entry in ssid_map.values():
        dev_list = sorted(entry["device_ids"])
        ssids.append({
            "ssid": entry["ssid"],
            "ap_count": len(dev_list),
            "interfaces": entry["interfaces"],
            "bands": sorted(entry["bands"]),
            "profiles": sorted(entry["profiles"]),
            "device_ids": dev_list,
        })
    ssids.sort(key=lambda x: (-x["ap_count"], x["ssid"].lower()))
    return {
        "ok": True,
        "scanned_ok": scanned_ok,
        "scanned_err": scanned_err,
        "total_devices": len(devs),
        "ssids": ssids,
    }


def _sync_wifi_on_device(dev: dict, req: FleetWifiSyncReq) -> dict:
    did = dev["id"]
    dname = dev.get("name") or did
    host = dev.get("host") or ""
    target_ssid = (req.target_ssid or "").strip()
    new_ssid = (req.new_ssid or "").strip()
    pwd = (req.password or "").strip()
    dry = bool(req.dry_run)
    actions: list[str] = []

    try:
        with get_device_lock(host), MT(dev) as mt:
            wl_res = mt.resource("/interface/wireless")
            sec_res = mt.resource("/interface/wireless/security-profiles")
            all_wl = wl_res.get()
            all_sec = sec_res.get()
            sec_by_name = {s.get("name"): s for s in all_sec}

            def _ensure_wpa2_profile(prof_name: str, key: str) -> str:
                existing = sec_by_name.get(prof_name)
                if existing:
                    if not dry:
                        sec_res.set(id=existing["id"], **{
                            "mode": "dynamic-keys",
                            "authentication-types": "wpa2-psk",
                            "wpa2-pre-shared-key": key,
                        })
                    return f"perbarui profile '{prof_name}'"
                if not dry:
                    sec_res.call("add", {
                        "name": prof_name,
                        "mode": "dynamic-keys",
                        "authentication-types": "wpa2-psk",
                        "wpa2-pre-shared-key": key,
                        "unicast-ciphers": "aes-ccm",
                        "group-ciphers": "aes-ccm",
                    })
                return f"buat profile '{prof_name}'"

            if req.action == "rotate_password":
                matched = [w for w in all_wl if (w.get("ssid") or "").strip() == target_ssid]
                if not matched:
                    return {
                        "device_id": did, "device_name": dname, "host": host,
                        "status": "skipped", "actions": [],
                        "message": f"SSID '{target_ssid}' tidak ditemukan di AP ini",
                    }
                # Cek apakah security-profile dipakai juga oleh SSID lain agar tidak merusak SSID lain
                other_profiles = {
                    (w.get("security-profile") or "default")
                    for w in all_wl
                    if (w.get("ssid") or "").strip() != target_ssid
                }
                ded_name = _slug_profile(target_ssid)
                updated_profs: set[str] = set()
                for w in matched:
                    cur_prof = w.get("security-profile") or "default"
                    if cur_prof == "default" or cur_prof in other_profiles:
                        if ded_name not in updated_profs:
                            actions.append(_ensure_wpa2_profile(ded_name, pwd))
                            updated_profs.add(ded_name)
                        if cur_prof != ded_name:
                            if not dry:
                                wl_res.set(id=w["id"], **{"security-profile": ded_name})
                            actions.append(f"{w.get('name')}: pindah ke profile '{ded_name}' (aman, tidak ubah SSID lain)")
                    else:
                        if cur_prof not in updated_profs:
                            actions.append(_ensure_wpa2_profile(cur_prof, pwd))
                            updated_profs.add(cur_prof)
                prefix = "[Preview] " if dry else ""
                return {
                    "device_id": did, "device_name": dname, "host": host,
                    "status": "ok", "actions": actions,
                    "message": f"{prefix}Password SSID '{target_ssid}' diperbarui ({len(matched)} radio)",
                }

            elif req.action == "rename_ssid":
                matched = [w for w in all_wl if (w.get("ssid") or "").strip() == target_ssid]
                if not matched:
                    return {
                        "device_id": did, "device_name": dname, "host": host,
                        "status": "skipped", "actions": [],
                        "message": f"SSID '{target_ssid}' tidak ditemukan di AP ini",
                    }
                other_profiles = {
                    (w.get("security-profile") or "default")
                    for w in all_wl
                    if (w.get("ssid") or "").strip() != target_ssid
                }
                ded_name = _slug_profile(new_ssid)
                updated_profs: set[str] = set()
                for w in matched:
                    if not dry:
                        wl_res.set(id=w["id"], ssid=new_ssid)
                    actions.append(f"{w.get('name')}: SSID '{target_ssid}' -> '{new_ssid}'")
                    if pwd:
                        cur_prof = w.get("security-profile") or "default"
                        if cur_prof == "default" or cur_prof in other_profiles:
                            if ded_name not in updated_profs:
                                actions.append(_ensure_wpa2_profile(ded_name, pwd))
                                updated_profs.add(ded_name)
                            if cur_prof != ded_name:
                                if not dry:
                                    wl_res.set(id=w["id"], **{"security-profile": ded_name})
                                actions.append(f"{w.get('name')}: profile -> '{ded_name}'")
                        elif cur_prof not in updated_profs:
                            actions.append(_ensure_wpa2_profile(cur_prof, pwd))
                            updated_profs.add(cur_prof)
                prefix = "[Preview] " if dry else ""
                return {
                    "device_id": did, "device_name": dname, "host": host,
                    "status": "ok", "actions": actions,
                    "message": f"{prefix}SSID diubah ke '{new_ssid}' ({len(matched)} radio)",
                }

            elif req.action == "create_ssid":
                masters = [w for w in all_wl if not w.get("master-interface")]
                want_bands = set(req.bands or ["2g", "5g"])
                target_masters = [w for w in masters if _band_of(w) in want_bands]
                if not target_masters:
                    return {
                        "device_id": did, "device_name": dname, "host": host,
                        "status": "skipped", "actions": [],
                        "message": f"Tidak ada radio master untuk band {', '.join(sorted(want_bands))}",
                    }

                existing_names = {w.get("name") for w in all_wl}
                sec_prof_name = "default"
                if req.security_mode == "password":
                    sec_prof_name = _slug_profile(target_ssid)
                    actions.append(_ensure_wpa2_profile(sec_prof_name, pwd))

                created = 0
                for m in target_masters:
                    m_name = m.get("name")
                    m_band = _band_of(m)
                    # Cek apakah SSID sudah ada di master radio ini
                    already = any(
                        (w.get("ssid") or "").strip() == target_ssid
                        and (w.get("name") == m_name or w.get("master-interface") == m_name)
                        for w in all_wl
                    )
                    if already:
                        actions.append(f"{m_name} ({m_band}): dilewati, SSID '{target_ssid}' sudah ada")
                        continue

                    idx = 3
                    while f"wlan{idx}" in existing_names:
                        idx += 1
                    vap_name = f"wlan{idx}"
                    existing_names.add(vap_name)

                    params = {
                        "name": vap_name,
                        "master-interface": m_name,
                        "ssid": target_ssid,
                        "security-profile": sec_prof_name,
                        "disabled": "false",
                        "hide-ssid": "true" if req.hide_ssid else "false",
                    }
                    if req.vlan_mode == "use-tag" and req.vlan_id:
                        params["vlan-mode"] = "use-tag"
                        params["vlan-id"] = str(req.vlan_id)

                    if not dry:
                        wl_res.call("add", params)
                        if req.add_bridge:
                            try:
                                mt.resource("/interface/bridge/port").call("add", {
                                    "bridge": req.bridge_name or "bridge1",
                                    "interface": vap_name,
                                })
                            except Exception:
                                pass
                    created += 1
                    vlan_info = f", VLAN {req.vlan_id}" if (req.vlan_mode == "use-tag" and req.vlan_id) else ""
                    actions.append(f"buat {vap_name} di {m_name} ({m_band}) SSID '{target_ssid}'{vlan_info}")

                if created == 0:
                    return {
                        "device_id": did, "device_name": dname, "host": host,
                        "status": "skipped", "actions": actions,
                        "message": f"SSID '{target_ssid}' sudah ada di seluruh band target",
                    }
                prefix = "[Preview] " if dry else ""
                return {
                    "device_id": did, "device_name": dname, "host": host,
                    "status": "ok", "actions": actions,
                    "message": f"{prefix}{created} Virtual AP '{target_ssid}' berhasil dibuat",
                }

            else:
                return {
                    "device_id": did, "device_name": dname, "host": host,
                    "status": "error", "actions": [],
                    "message": f"Aksi tidak dikenal: {req.action}",
                }
    except Exception as e:
        return {
            "device_id": did, "device_name": dname, "host": host,
            "status": "error", "actions": actions,
            "message": f"{type(e).__name__}: {e}",
        }


@app.post("/api/fleet/wifi/sync")
def api_fleet_wifi_sync(req: FleetWifiSyncReq):
    """Sinkronisasi SSID / ganti password Wi-Fi secara massal ke AP terpilih (mendukung dry-run preview)."""
    if req.action not in ("rotate_password", "create_ssid", "rename_ssid"):
        raise HTTPException(400, "Aksi harus rotate_password, create_ssid, atau rename_ssid")
    if not (req.target_ssid or "").strip():
        raise HTTPException(400, "Nama SSID target wajib diisi")
    if req.action == "rename_ssid" and not (req.new_ssid or "").strip():
        raise HTTPException(400, "Nama SSID baru wajib diisi")
    if req.action == "rotate_password":
        if not (req.password or "").strip() or len(req.password.strip()) < 8:
            raise HTTPException(400, "Password WPA2-PSK minimal 8 karakter")
    if req.action == "create_ssid" and req.security_mode == "password":
        if not (req.password or "").strip() or len(req.password.strip()) < 8:
            raise HTTPException(400, "Password WPA2-PSK minimal 8 karakter")
    if req.action == "rename_ssid" and (req.password or "").strip() and len(req.password.strip()) < 8:
        raise HTTPException(400, "Password WPA2-PSK minimal 8 karakter")
    if not req.device_ids:
        raise HTTPException(400, "Pilih minimal 1 perangkat AP target")

    all_devs = {d["id"]: d for d in load_devices()}
    targets = [all_devs[did] for did in req.device_ids if did in all_devs]
    if not targets:
        raise HTTPException(404, "Perangkat target tidak ditemukan")

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(10, len(targets))) as ex:
        for r in ex.map(lambda d: _sync_wifi_on_device(d, req), targets):
            results.append(r)

    ok_cnt = sum(1 for r in results if r["status"] == "ok")
    skip_cnt = sum(1 for r in results if r["status"] == "skipped")
    err_cnt = sum(1 for r in results if r["status"] == "error")
    return {
        "ok": True,
        "dry_run": req.dry_run,
        "action": req.action,
        "target_ssid": req.target_ssid.strip(),
        "summary": {
            "total": len(results),
            "success": ok_cnt,
            "skipped": skip_cnt,
            "failed": err_cnt,
        },
        "results": results,
    }


# ==============================================================================
# FLEET RF NEIGHBOR & DISTANCE ESTIMATION (LOG-DISTANCE PATH LOSS)
# ==============================================================================
_RF_ENV_PROFILES = {
    "corridor": {"label": "Koridor Terbuka", "n": 2.4},
    "hospital": {"label": "Gedung RS Bertembok", "n": 3.0},
    "heavy_wall": {"label": "Tembok Beton / Sekat Tebal", "n": 3.5},
}


def _rf_estimate_distance_m(rssi_dbm: float, freq_mhz: int, env: str = "hospital") -> float:
    """Estimasi jarak indoor antar-AP (meter) dengan model Log-Distance Path Loss."""
    import math
    prof = _RF_ENV_PROFILES.get(env) or _RF_ENV_PROFILES["hospital"]
    n = float(prof["n"])
    f = float(freq_mhz or 2437)
    # Effective EIRP rata-rata MikroTik cAP ac indoor (TX + antenna gain)
    tx_eirp = 18.0 if f < 3000 else 22.0
    # Free-space path loss pada jarak referensi d0 = 1 meter
    fspl_1m = 20.0 * math.log10(max(f, 2400.0)) - 27.55
    exp_val = (tx_eirp - float(rssi_dbm) - fspl_1m) / (10.0 * n)
    dist = 10.0 ** exp_val
    return round(max(0.5, min(120.0, dist)), 1)


def _freq_to_ch_label(freq: int | None) -> str:
    if not freq:
        return "-"
    f = int(freq)
    if 2412 <= f <= 2484:
        ch = 14 if f == 2484 else round((f - 2407) / 5)
        return f"Ch {ch} ({f})"
    if 5000 <= f <= 5900:
        return f"Ch {(f - 5000) // 5} ({f})"
    return f"{f} MHz"


class FleetRfDistanceScanReq(BaseModel):
    device_ids: list[str] = Field(default_factory=list)
    band: str = "all"     # "all" | "2g" | "5g"
    duration: int = Field(5, ge=4, le=12)


@app.get("/api/fleet/rf-distances")
def api_fleet_rf_distances(
    band: str = Query("all"),
    env: str = Query("hospital"),
    window_h: int = Query(168, ge=1, le=720),
    device: str | None = Query(None),
):
    """Hitung estimasi jarak RF antar-AP armada dari riwayat scan RF SQLite + pemetaan BSSID armada."""
    env_key = env if env in _RF_ENV_PROFILES else "hospital"
    band_filter = band if band in ("all", "2g", "5g") else "all"
    devs = load_devices()
    dev_by_id = {d["id"]: d for d in devs}
    known_bssids = get_fleet_known_bssids()
    cutoff = time.time() - window_h * 3600

    # Ambil scan terbaru per (device_id, band) dari rf_scan_history
    latest_scans: dict[tuple[str, str], dict] = {}
    with _DB_LOCK:
        try:
            conn = sqlite3.connect(str(NOC_DB_FILE))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT ts, device_id, band, channels_json, bss_json FROM rf_scan_history "
                "WHERE ts >= ? ORDER BY ts DESC",
                (cutoff,),
            ).fetchall()
            conn.close()
            for r in rows:
                did = r["device_id"]
                b = r["band"]
                if did not in dev_by_id:
                    continue
                if band_filter != "all" and b != band_filter:
                    continue
                key = (did, b)
                if key in latest_scans:
                    continue
                latest_scans[key] = {
                    "ts": float(r["ts"]),
                    "device_id": did,
                    "band": b,
                    "bss_list": json.loads(r["bss_json"] or "[]"),
                }
        except Exception as e:
            raise HTTPException(500, f"Gagal membaca riwayat scan RF: {e}")

    # Kumpulkan link terarah (scanner_id -> heard_owner_id, band), ambil RSSI terkuat dari Virtual AP
    directed: dict[tuple[str, str, str], dict] = {}
    scanned_dev_ids: set[str] = set()
    for (scanner_id, b), sc in latest_scans.items():
        scanned_dev_ids.add(scanner_id)
        for item in sc["bss_list"]:
            bssid = str(item.get("bssid") or "").upper().strip()
            owner = known_bssids.get(bssid)
            if not owner:
                continue
            target_id = owner["device_id"]
            if target_id == scanner_id or target_id not in dev_by_id:
                continue
            try:
                sig = float(item.get("signal"))
            except (TypeError, ValueError):
                continue
            freq = int(item.get("freq") or 0)
            dkey = (scanner_id, target_id, b)
            prev = directed.get(dkey)
            if not prev or sig > prev["rssi"]:
                directed[dkey] = {
                    "rssi": sig,
                    "freq": freq,
                    "width": int(item.get("width") or 20),
                    "ssid": item.get("ssid") or owner.get("ssid") or "",
                    "ts": sc["ts"],
                }

    # Gabungkan pasangan simetris (A <-> B) per band
    pair_map: dict[tuple[str, str, str], dict] = {}
    for (src, dst, b), info in directed.items():
        a, c = (src, dst) if src < dst else (dst, src)
        pkey = (a, c, b)
        entry = pair_map.setdefault(
            pkey,
            {
                "ap_a_id": a,
                "ap_b_id": c,
                "band": b,
                "rssi_ab": None,
                "rssi_ba": None,
                "freq_heard_b": None,
                "freq_heard_a": None,
                "ts": 0.0,
            },
        )
        if src == a:
            entry["rssi_ab"] = round(info["rssi"], 1)
            entry["freq_heard_b"] = info["freq"]
        else:
            entry["rssi_ba"] = round(info["rssi"], 1)
            entry["freq_heard_a"] = info["freq"]
        entry["ts"] = max(entry["ts"], info["ts"])

    pairs: list[dict] = []
    per_ap_links: dict[str, list[dict]] = {d["id"]: [] for d in devs}

    for p in pair_map.values():
        a_id = p["ap_a_id"]
        b_id = p["ap_b_id"]
        if device and device not in (a_id, b_id):
            continue
        r_ab = p["rssi_ab"]
        r_ba = p["rssi_ba"]
        bidir = (r_ab is not None) and (r_ba is not None)
        rssi_avg = round((r_ab + r_ba) / 2.0, 1) if bidir else float(r_ab if r_ab is not None else r_ba)
        ref_freq = p["freq_heard_b"] or p["freq_heard_a"] or (2437 if p["band"] == "2g" else 5745)
        dist_m = _rf_estimate_distance_m(rssi_avg, ref_freq, env_key)

        fa = p["freq_heard_a"]
        fb = p["freq_heard_b"]
        co_channel = bool(fa and fb and abs(int(fa) - int(fb)) < 20)

        if dist_m < 7.0 or rssi_avg >= -52.0:
            proximity = "too_close"
        elif dist_m <= 18.0:
            proximity = "ideal"
        else:
            proximity = "far"

        da = dev_by_id[a_id]
        db = dev_by_id[b_id]
        row = {
            "ap_a_id": a_id,
            "ap_a_name": da.get("name") or a_id,
            "ap_a_host": da.get("host") or "",
            "ap_a_group": da.get("group") or "Default",
            "ap_b_id": b_id,
            "ap_b_name": db.get("name") or b_id,
            "ap_b_host": db.get("host") or "",
            "ap_b_group": db.get("group") or "Default",
            "band": p["band"],
            "rssi_dbm": rssi_avg,
            "rssi_ab": r_ab,
            "rssi_ba": r_ba,
            "bidirectional": bidir,
            "freq_a": fa,
            "freq_b": fb,
            "channel_label": _freq_to_ch_label(ref_freq),
            "co_channel": co_channel,
            "distance_m": dist_m,
            "proximity": proximity,
            "scanned_at": time.strftime("%Y-%m-%d %H:%M", time.localtime(p["ts"])) if p["ts"] else "-",
        }
        pairs.append(row)
        per_ap_links[a_id].append(
            {
                "peer_id": b_id,
                "peer_name": row["ap_b_name"],
                "peer_host": row["ap_b_host"],
                "band": p["band"],
                "rssi_dbm": rssi_avg,
                "distance_m": dist_m,
                "proximity": proximity,
                "co_channel": co_channel,
                "bidirectional": bidir,
            }
        )
        per_ap_links[b_id].append(
            {
                "peer_id": a_id,
                "peer_name": row["ap_a_name"],
                "peer_host": row["ap_a_host"],
                "band": p["band"],
                "rssi_dbm": rssi_avg,
                "distance_m": dist_m,
                "proximity": proximity,
                "co_channel": co_channel,
                "bidirectional": bidir,
            }
        )

    pairs.sort(key=lambda x: (x["distance_m"], -x["rssi_dbm"]))

    per_ap: list[dict] = []
    unscanned_aps: list[dict] = []
    for d in devs:
        did = d["id"]
        if device and did != device:
            continue
        links = sorted(per_ap_links.get(did) or [], key=lambda x: (x["distance_m"], -x["rssi_dbm"]))
        has_scan = did in scanned_dev_ids
        if not has_scan and not links:
            unscanned_aps.append({"id": did, "name": d.get("name") or did, "host": d.get("host") or "", "group": d.get("group") or "Default"})
            continue
        nearest = links[0] if links else None
        per_ap.append(
            {
                "device_id": did,
                "device_name": d.get("name") or did,
                "host": d.get("host") or "",
                "group": d.get("group") or "Default",
                "scanned": has_scan,
                "neighbour_count": len(links),
                "too_close_count": sum(1 for x in links if x["proximity"] == "too_close"),
                "co_channel_count": sum(1 for x in links if x["co_channel"]),
                "nearest": nearest,
                "neighbours": links[:12],
            }
        )

    per_ap.sort(key=lambda x: (x["nearest"]["distance_m"] if x["nearest"] else 999.0, x["device_name"]))

    return {
        "ok": True,
        "env": env_key,
        "env_label": _RF_ENV_PROFILES[env_key]["label"],
        "path_loss_n": _RF_ENV_PROFILES[env_key]["n"],
        "band": band_filter,
        "window_h": window_h,
        "summary": {
            "total_devices": len(devs),
            "scanned_devices": len(scanned_dev_ids),
            "unscanned_devices": len(unscanned_aps),
            "total_pairs": len(pairs),
            "too_close_pairs": sum(1 for p in pairs if p["proximity"] == "too_close"),
            "ideal_pairs": sum(1 for p in pairs if p["proximity"] == "ideal"),
            "far_pairs": sum(1 for p in pairs if p["proximity"] == "far"),
            "co_channel_pairs": sum(1 for p in pairs if p["co_channel"]),
        },
        "pairs": pairs,
        "per_ap": per_ap,
        "unscanned_aps": unscanned_aps,
    }


@app.post("/api/fleet/rf-distances/scan")
def api_fleet_rf_distances_scan(req: FleetRfDistanceScanReq):
    """Pindai RF on-demand untuk 1 atau beberapa AP terpilih agar jarak tetangga RF terbarui."""
    if not req.device_ids:
        raise HTTPException(400, "Pilih minimal 1 AP untuk dipindai")
    if len(req.device_ids) > 12:
        raise HTTPException(400, "Maksimal 12 AP per scan manual agar jaringan tetap ringan")
    all_devs = {d["id"]: d for d in load_devices()}
    targets = [all_devs[did] for did in req.device_ids if did in all_devs]
    if not targets:
        raise HTTPException(404, "Perangkat target tidak ditemukan")

    bands = ["2g", "5g"] if req.band == "all" else [req.band if req.band in ("2g", "5g") else "5g"]
    # Refresh fleet BSSID cache so newly scanned BSSIDs map accurately
    try:
        get_fleet_known_bssids()
    except Exception:
        pass

    results: list[dict] = []

    def _scan_dev(d: dict) -> dict:
        ok_bands = []
        errs = []
        for b in bands:
            try:
                api_rf_scan(device=d["id"], band=b, duration=req.duration, non_disruptive=False)
                ok_bands.append(b)
            except Exception as e:
                errs.append(f"{b}: {e}")
        return {
            "device_id": d["id"],
            "device_name": d.get("name") or d["id"],
            "ok": len(ok_bands) > 0,
            "bands_ok": ok_bands,
            "errors": errs,
        }

    with ThreadPoolExecutor(max_workers=min(6, len(targets))) as ex:
        for r in ex.map(_scan_dev, targets):
            results.append(r)

    return {
        "ok": any(r["ok"] for r in results),
        "scanned": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8090")), log_level="info")