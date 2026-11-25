"""
MikroTik controller client — native RouterOS API (port 8728) via routeros-api.

Tested against: cAP ac (RBcAPGi-5acD2nD), RouterOS 7.13.3
Requires: pip install routeros-api
"""
import os
from pathlib import Path
import routeros_api
from routeros_api.exceptions import RouterOsApiConnectionError, RouterOsApiCommunicationError


def _load_env(path=None):
    """Minimal .env loader (no dependency) — looks next to this file."""
    p = Path(path or Path(__file__).with_name(".env"))
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


class MikroTik:
    def __init__(self, host=None, username=None, password=None, port=8728,
                 use_ssl=False, ssl_verify=False, timeout=None):
        self.timeout = float(timeout or os.getenv("MT_TIMEOUT", "5"))
        self.host = host or os.getenv("MT_HOST", "192.168.88.1")
        self.username = username or os.getenv("MT_USER", "API")
        self.password = password or os.getenv("MT_PASS", "")
        self.port = int(port)
        self.use_ssl = use_ssl
        self.ssl_verify = ssl_verify
        self._pool = None

    # ---------- connection ----------
    def connect(self):
        if self._pool:
            return self
        self._pool = routeros_api.RouterOsApiPool(
            self.host,
            username=self.username,
            password=self.password,
            port=self.port,
            use_ssl=self.use_ssl,
            ssl_verify=self.ssl_verify,
            plaintext_login=True,
        )
        # get_api() performs the login handshake
        self._pool.set_timeout(self.timeout)
        self.api = self._pool.get_api()
        return self

    def disconnect(self):
        if self._pool:
            try:
                self._pool.disconnect()
            finally:
                self._pool = None
                self.api = None

    def __enter__(self):
        return self.connect()

    def __exit__(self, *exc):
        self.disconnect()

    # ---------- generic primitives ----------
    def call(self, path, command="print", **kwargs):
        """Raw command on any menu path. command: print/add/set/remove/..."""
        res = self.api.get_resource(path)
        return getattr(res, command)(**kwargs)

    def get(self, path, **filters):
        return self.api.get_resource(path).get(**filters)

    def add(self, path, **attrs):
        return self.api.get_resource(path).add(**attrs)

    def set(self, path, id, **attrs):
        return self.api.get_resource(path).set(id=id, **attrs)

    def remove(self, path, id):
        return self.api.get_resource(path).remove(id=id)

    # ---------- read helpers ----------
    def identity(self):
        return self.get("/system/identity")[0].get("name")

    def resource(self):
        return self.get("/system/resource")[0]

    def routerboard(self):
        return self.get("/system/routerboard")[0]

    def interfaces(self):
        return self.get("/interface")

    def ip_addresses(self):
        return self.get("/ip/address")

    def routes(self):
        return self.get("/ip/route")

    def dhcp_leases(self):
        return self.get("/ip/dhcp-server/lease")

    def wireless_clients(self):
        return self.get("/interface/wireless/registration-table")

    def firewall_filter(self):
        return self.get("/ip/firewall/filter")

    def logs(self, limit=None):
        rows = self.get("/log")
        return rows[-limit:] if limit else rows

    # ---------- write helpers (examples) ----------
    def block_ip(self, ip, comment="blocked by controller", list_name="blocked"):
        """Add IP to /ip/firewall/address-list and drop it in filter."""
        self.call("/ip/firewall/address-list", "add",
                  list=list_name, address=ip, comment=comment)
        return self.call("/ip/firewall/filter", "add",
                         chain="forward", action="drop", **{"src-address": ip},
                         comment=comment)

    def run_script(self, source):
        """/system/script/run equivalent — inline execution."""
        return self.call("/system/script", "add",
                         name="_ctl_tmp", source=source)

    def reboot(self):
        return self.call("/system", "reboot")

    def backup(self, name="ctl-backup"):
        return self.call("/system/backup", "save", name=name)


if __name__ == "__main__":
    with MikroTik() as mt:
        r = mt.resource()
        print(f"identity     : {mt.identity()}")
        print(f"board / ros  : {r['board-name']} / {r['version']}")
        print(f"uptime       : {r['uptime']}   cpu-load: {r['cpu-load']}%")
        free = int(r["free-memory"]) / int(r["total-memory"]) * 100
        print(f"free memory  : {free:.1f}% of {int(r['total-memory'])/1048576:.0f} MB")
        print(f"interfaces   : {len(mt.interfaces())}")
        print(f"wireless cli : {len(mt.wireless_clients())}")
        print(f"fw rules     : {len(mt.firewall_filter())}")
        print(f"dhcp leases  : {len(mt.dhcp_leases())}")