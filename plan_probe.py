"""Dump input yang dilihat planner: freq/band/width/neighbours per radio."""
import json
import app
import rrm_engine

_orig = rrm_engine.plan_dca
seen = {}


def spy(aps, **kw):
    seen["aps"] = aps
    seen["kw"] = {k: v for k, v in kw.items() if k != "aps"}
    return _orig(aps, **kw)


rrm_engine.plan_dca = spy
if getattr(app, "plan_dca", None) is not None:
    app.plan_dca = spy

plan = app.build_rrm_plan(include_dfs=None, duration=None)
for a in seen.get("aps", []):
    print(json.dumps({k: a.get(k) for k in
                      ("id", "device_id", "interface", "band", "freq", "width", "tx_power")}
                     | {"neighbours": len(a.get("neighbours") or [])}))
print("kw", {k: v for k, v in seen.get("kw", {}).items()})
print("dca", json.dumps(plan["dca"])[:400])
print("tpc", json.dumps(plan["tpc"])[:300])
