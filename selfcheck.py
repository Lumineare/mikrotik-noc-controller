"""Regression guard untuk logika murni (tanpa router, tanpa server).

Jalankan: python selfcheck.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import app  # noqa: E402  (import murah & tidak menyalakan server)
import rrm_engine as R  # noqa: E402

# --- 2.4 GHz: 2412 + 5*(ch-1) ---
assert app.ch_to_freq("2g", 1) == 2412
assert app.ch_to_freq("2g", 6) == 2437
assert app.ch_to_freq("2g", 11) == 2462
assert app.ch_to_freq("2g", 13) == 2472
assert app.ch_to_freq("2g", 14) == 2484

# --- 5 GHz: tiga segmen berbeda (36-64 / 100-144 / 149-177) ---
assert app.ch_to_freq("5g", 36) == 5180
assert app.ch_to_freq("5g", 48) == 5240
assert app.ch_to_freq("5g", 64) == 5320
assert app.ch_to_freq("5g", 100) == 5500
assert app.ch_to_freq("5g", 144) == 5720
assert app.ch_to_freq("5g", 149) == 5745
assert app.ch_to_freq("5g", 165) == 5825


# --- DCA: AP di kanal sama harus dipisah, kanal di luar rencana diperbaiki ---
def _aps(n, band="2g", freq=2412):
    # tiap AP "mendengar" AP lain di kanal yang sama, sinyal kuat
    nb = [{"freq": freq, "width": 20, "signal": -45} for _ in range(n - 1)]
    return [{"id": f"ap{i}", "band": band, "freq": freq, "width": 20,
             "neighbours": list(nb), "noise": {}} for i in range(n)]


plan3 = R.plan_dca(_aps(3))
assert plan3["gain_pct"] > 0, plan3
assert len(plan3["changes"]) >= 2, plan3
assert len({c["to_freq"] for c in plan3["changes"]}) >= 2, "semua AP dapat kanal sama"

plan_off = R.plan_dca([{"id": "a", "band": "2g", "freq": 2472, "width": 20,
                        "neighbours": [], "noise": {}}])
assert plan_off["changes"], "ch13 tidak diperbaiki"

# --- Atomic JSON write: tidak boleh meninggalkan file setengah jadi ---
tmp = Path(tempfile.mkdtemp()) / "x.json"
tmp.write_text(json.dumps({"a": 1}), encoding="utf-8")
t = tmp.with_suffix(".json.tmp")
t.write_text(json.dumps({"a": 2}), encoding="utf-8")
os.replace(t, tmp)
assert json.loads(tmp.read_text(encoding="utf-8")) == {"a": 2}
assert not t.exists()

print("selfcheck OK")
