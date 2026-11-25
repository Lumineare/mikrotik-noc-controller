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
    # Bentuk data seperti scan nyata: tiap neighbour diberi `owner` supaya
    # engine tahu BSS itu milik AP fleet (dan ikut dipindah saat dievaluasi).
    return [{"id": f"ap{i}", "device_id": f"ap{i}", "band": band, "freq": freq, "width": 20,
             "neighbours": [{"freq": freq, "width": 20, "signal": -45, "owner": f"ap{j}"}
                            for j in range(n) if j != i],
             "noise": {}} for i in range(n)]


plan3 = R.plan_dca(_aps(3))
assert plan3["gain_pct"] > 0, plan3
assert len(plan3["changes"]) >= 2, plan3
final3 = {a["id"]: a["freq"] for a in _aps(3)}
final3.update({c["device_id"]: c["to_freq"] for c in plan3["changes"]})
assert len(set(final3.values())) == 3, f"AP masih co-channel: {final3}"

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

# --- settle klien: dip transien saat radio restart TIDAK boleh dihitung klien hilang ---
seq = iter([0, 3, 7, 12, 12, 12])   # 12 klien -> 0 saat restart -> pulih 12
got = app._settle_clients(12, lambda: next(seq, 12), max_drop=2, timeout=30, step=0.01)
assert got == 12, got

# klien benar-benar hilang -> drop nyata tetap terdeteksi
seq2 = iter([5, 5, 5, 5])
got2 = app._settle_clients(12, lambda: next(seq2, 5), max_drop=2, timeout=0.06, step=0.01)
assert got2 == 5, got2
assert 12 - got2 > 2

# AP tak terjangkau (semua sample raise) -> tidak crash, kembalikan before
def boom():
    raise OSError("timeout")
assert app._settle_clients(9, boom, 2, timeout=0.05, step=0.01) == 9
