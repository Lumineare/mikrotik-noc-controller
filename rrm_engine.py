"""RRM engine — DCA (weighted graph coloring / min-conflict), TPC, steering rules.

Pure functions only: no router I/O, no globals, no side effects. Feed scan data in,
get a plan out. Everything is deterministic so a plan can be replayed and reviewed.

Model
-----
Each radio is a vertex in a weighted interference graph. Cost of putting radio i on
frequency f is the sum of co/adjacent-channel power it would receive from every other
radio (weighted by spectral overlap) plus the measured noise floor at f:

    cost_i(f) = P_noise(f) + SUM_j  overlap(f, w_i, f_j, w_j) * P_j
    P = 10 ** (dBm / 10)                      # mW, linear power

DCA minimises SUM_i cost_i(f_i) by min-conflict local search over orthogonal channels
(2.4 GHz: 1/6/11; 5 GHz: non-DFS by default, DFS opt-in), keeping the best assignment
seen. TPC walks tx-power in 3 dB steps toward a -70 dBm neighbour target with a dead
band so radios do not oscillate.
"""
from __future__ import annotations

TARGET_NEIGHBOR_DBM = -70.0
TPC_DEADBAND_DB = 3.0
TPC_STEP_DB = 3.0
TPC_MIN_DBM = 10.0
TPC_MAX_DBM = 23.0
DEFAULT_NOISE_DBM = -95.0

CH_2G = [2412, 2437, 2462]  # channels 1, 6, 11 — the only non-overlapping 2.4 GHz set
CH_5G_NON_DFS = [5180, 5200, 5220, 5240, 5745, 5765, 5785, 5805, 5825]
CH_5G_DFS = [5260, 5280, 5300, 5320,
             5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640, 5660, 5680, 5700, 5720]


def candidates(band: str, include_dfs: bool = False) -> list[int]:
    if (band or "").lower().startswith("2"):
        return list(CH_2G)
    return list(CH_5G_NON_DFS) + (list(CH_5G_DFS) if include_dfs else [])


def dbm_to_mw(dbm: float) -> float:
    return 10.0 ** (float(dbm) / 10.0)


def overlap(f1: int, w1: float, f2: int, w2: float) -> float:
    """Fraction of spectrum shared by two channels: 0.0 clean, 1.0 identical."""
    if not f1 or not f2:
        return 0.0
    sep = abs(f1 - f2)
    half = (float(w1) + float(w2)) / 2.0
    if half <= 0:
        return 0.0
    return max(0.0, 1.0 - sep / half)


def channel_cost(freq: int, width: float, neighbours: list[dict], noise_dbm: float) -> float:
    cost = dbm_to_mw(noise_dbm)
    for n in neighbours:
        ov = overlap(freq, width, n.get("freq", 0), n.get("width", 20))
        if ov > 0:
            cost += ov * dbm_to_mw(n.get("signal", DEFAULT_NOISE_DBM))
    return cost


def _noise_at(ap: dict, freq: int) -> float:
    table = ap.get("noise") or {}
    if freq in table:
        return float(table[freq])
    # nearest measured noise floor
    if table:
        return float(table[min(table, key=lambda f: abs(int(f) - freq))])
    return DEFAULT_NOISE_DBM


def _owner_index(aps: list[dict]) -> dict:
    """(device_id, band) -> radio id, so a neighbour BSS can be mapped to a fleet radio."""
    idx = {}
    for ap in aps:
        idx[(ap.get("device_id") or ap["id"], ap.get("band", "2g"))] = ap["id"]
    return idx


def _neighbours_for(ap: dict, assign: dict, ap_by_id: dict, owner_idx: dict) -> list[dict]:
    """Neighbours as seen by `ap`, with fleet members moved to their assigned channel."""
    out = []
    for n in ap.get("neighbours") or []:
        n = dict(n)
        owner = n.get("owner")
        if owner:
            band = "2g" if int(n.get("freq") or 0) < 2500 else "5g"
            key = owner_idx.get((owner, band))
            if key and key in assign:
                n["freq"] = assign[key]
                n["width"] = ap_by_id[key].get("width", 20)
        out.append(n)
    return out


def total_cost(aps: list[dict], assign: dict) -> float:
    ap_by_id = {a["id"]: a for a in aps}
    owner_idx = _owner_index(aps)
    total = 0.0
    for ap in aps:
        f = assign.get(ap["id"], ap.get("freq"))
        total += channel_cost(f, ap.get("width", 20),
                              _neighbours_for(ap, assign, ap_by_id, owner_idx),
                              _noise_at(ap, f))
    return total


def plan_dca(aps: list[dict], include_dfs: bool = False, max_passes: int = 40) -> dict:
    """Weighted-graph-colouring channel plan. `aps` entries:
        {id, band, freq, width, neighbours:[{freq,width,signal,owner?}], noise:{freq: dBm}}
    Returns {changes:[...], cost_before, cost_after, gain_pct, iterations}.
    """
    if not aps:
        return {"changes": [], "cost_before": 0.0, "cost_after": 0.0,
                "gain_pct": 0.0, "iterations": 0}

    assign = {a["id"]: int(a.get("freq") or candidates(a.get("band", "2g"))[0]) for a in aps}
    ap_by_id = {a["id"]: a for a in aps}
    owner_idx = _owner_index(aps)
    cost_before = total_cost(aps, assign)
    best_assign, best_cost = dict(assign), cost_before
    iterations = 0

    for _ in range(max_passes):
        iterations += 1
        improved = False
        for ap in aps:
            opts = candidates(ap.get("band", "2g"), include_dfs)
            if not opts:
                continue
            width = ap.get("width", 20)
            nb = _neighbours_for(ap, assign, ap_by_id, owner_idx)
            cur_f = assign[ap["id"]]
            best_f, best_c = cur_f, None
            for f in opts:
                c = channel_cost(f, width, nb, _noise_at(ap, f))
                if best_c is None or c < best_c * (1 - 1e-9):
                    best_f, best_c = f, c
                elif abs(c - best_c) <= best_c * 1e-9 and f == cur_f:
                    best_f = f  # tie: keep the channel the radio already uses
            if best_f != cur_f:
                assign[ap["id"]] = best_f
                improved = True
        cur = total_cost(aps, assign)
        if cur < best_cost * (1 - 1e-9):
            best_cost, best_assign = cur, dict(assign)
        if not improved:
            break

    changes = []
    for ap in aps:
        old, new = int(ap.get("freq") or 0), best_assign[ap["id"]]
        if old == new:
            continue
        nb = _neighbours_for(ap, best_assign, ap_by_id, owner_idx)
        old_cost = channel_cost(old, ap.get("width", 20), nb, _noise_at(ap, old)) if old else cost_before
        new_cost = channel_cost(new, ap.get("width", 20), nb, _noise_at(ap, new))
        changes.append({
            "device_id": ap.get("device_id") or ap["id"], "interface": ap.get("interface"),
            "band": ap.get("band"), "from_freq": old, "to_freq": new,
            "interference_before_mw": float(f"{old_cost:.6g}"),
            "interference_after_mw": float(f"{new_cost:.6g}"),
            "relief_pct": round(100.0 * (1 - new_cost / old_cost), 1) if old_cost > 0 else 0.0,
        })

    gain = 0.0
    if cost_before > 0:
        gain = round(100.0 * (1 - best_cost / cost_before), 1)
    return {"changes": changes, "cost_before": float(f"{cost_before:.6g}"),
            "cost_after": float(f"{best_cost:.6g}"), "gain_pct": gain, "iterations": iterations}


def plan_tpc(aps: list[dict]) -> list[dict]:
    """Step tx-power toward TARGET_NEIGHBOR_DBM. `aps` entries:
        {id, interface, band, tx_power, neighbours:[{signal}]}
    Symmetric-path assumption: the strongest neighbour we hear is the strongest
    neighbour that hears us. Returns list of {device_id, interface, from_dbm, to_dbm, reason}.
    """
    out = []
    for ap in aps:
        nb = [float(n.get("signal", DEFAULT_NOISE_DBM)) for n in (ap.get("neighbours") or [])
              if n.get("signal") is not None]
        if not nb:
            continue
        try:
            cur = float(ap.get("tx_power"))
            was_default = False
        except (TypeError, ValueError):
            cur = TPC_MAX_DBM      # radio still on board default; first apply pins it explicitly
            was_default = True
        strongest = max(nb)
        delta = TARGET_NEIGHBOR_DBM - strongest
        if abs(delta) <= TPC_DEADBAND_DB:
            continue
        step = TPC_STEP_DB if delta > 0 else -TPC_STEP_DB
        new = max(TPC_MIN_DBM, min(TPC_MAX_DBM, cur + step))
        new = round(new)
        if new == round(cur):
            continue
        out.append({
            "device_id": ap.get("device_id") or ap["id"],
            "interface": ap.get("interface"), "band": ap.get("band"),
            "from_dbm": round(cur), "to_dbm": new, "strongest_neighbour_dbm": strongest,
            "was_default": was_default,
            "reason": ("neighbour too loud — reduce coverage overlap"
                       if step < 0 else "coverage hole — raise power"),
        })
    return out


def steering_rules(iface_2g: str | None, iface_5g: str | None,
                   clients_2g: list[dict], weak_dbm: float = -75.0) -> list[dict]:
    """Access-list rules: reject weak clients on 2.4 GHz so they land on 5 GHz."""
    if not iface_2g or not clients_5g_capable(iface_5g):
        return []
    weak = []
    for c in clients_2g:
        try:
            sig = int(str(c.get("signal_strength", "-70")).split("@")[0])
        except (TypeError, ValueError):
            continue
        if sig < weak_dbm:
            weak.append(c.get("mac"))
    if not weak:
        return []
    return [{
        "interface": iface_2g,
        "signal_range": f"-120..{int(weak_dbm)}",
        "authentication": "no",
        "forwarding": "no",
        "comment": "RRM-steer-5g",
        "affected_macs": weak,
        "rationale": f"{len(weak)} client(s) below {int(weak_dbm)} dBm on 2.4 GHz — "
                     "rejected there so they associate on the cleaner 5 GHz radio",
    }]


def clients_5g_capable(iface_5g: str | None) -> bool:
    return bool(iface_5g)


if __name__ == "__main__":
    # self-check: two APs co-channel on 1 → planner must split them 1/6/11
    aps = [
        {"id": "a", "band": "2g", "freq": 2412, "width": 20, "interface": "wlan1",
         "neighbours": [{"freq": 2412, "width": 20, "signal": -45, "owner": "b"}],
         "noise": {2412: -88, 2437: -92, 2462: -90}},
        {"id": "b", "band": "2g", "freq": 2412, "width": 20, "interface": "wlan1",
         "neighbours": [{"freq": 2412, "width": 20, "signal": -45, "owner": "a"}],
         "noise": {2412: -88, 2437: -92, 2462: -90}},
    ]
    plan = plan_dca(aps)
    assert plan["gain_pct"] > 0, plan
    freqs = {c["device_id"]: c["to_freq"] for c in plan["changes"]}
    assert len(set(freqs.values())) == 2, f"APs not separated: {freqs}"

    # single AP already on a clean channel → no churn
    solo = [{"id": "a", "band": "5g", "freq": 5180, "width": 20,
             "neighbours": [], "noise": {5180: -96}}]
    assert plan_dca(solo)["changes"] == []

    # DFS excluded by default, included on request
    assert 5260 not in candidates("5g")
    assert 5260 in candidates("5g", include_dfs=True)

    # TPC: loud neighbour → power down 3 dB, dead band respected
    tpc = plan_tpc([{"id": "a", "interface": "wlan1", "band": "2g", "tx_power": 20,
                     "neighbours": [{"signal": -58}]}])
    assert tpc and tpc[0]["to_dbm"] == 17, tpc
    assert plan_tpc([{"id": "a", "interface": "wlan1", "band": "2g", "tx_power": 20,
                      "neighbours": [{"signal": -71}]}]) == []
    assert plan_tpc([{"id": "a", "interface": "wlan1", "band": "2g", "tx_power": 23,
                      "neighbours": [{"signal": -85}]}]) == []  # clamped at ceiling

    # steering only when weak clients exist
    assert steering_rules("wlan1", "wlan2", [{"mac": "AA", "signal_strength": "-80@6Mbps"}])
    assert steering_rules("wlan1", "wlan2", [{"mac": "AA", "signal_strength": "-60@6Mbps"}]) == []
    # regression: one device, two radios → 2.4 GHz radio must never get a 5 GHz channel
    dual = [
        {"id": "d#2g", "device_id": "d", "band": "2g", "interface": "wlan1", "freq": 2437, "width": 20,
         "neighbours": [{"freq": 2437, "width": 20, "signal": -50, "owner": "x"}],
         "noise": {2412: -80, 2437: -88, 2462: -92}},
        {"id": "d#5g", "device_id": "d", "band": "5g", "interface": "wlan2", "freq": 5180, "width": 80,
         "neighbours": [], "noise": {5180: -96, 5200: -96, 5220: -96, 5240: -96}},
    ]
    dual_plan = plan_dca(dual)
    for ch in dual_plan["changes"]:
        if ch["band"] == "2g":
            assert ch["to_freq"] in CH_2G, f"2.4 GHz radio got {ch['to_freq']} MHz"
        assert ch["device_id"] == "d", ch
    assert dual_plan["iterations"] <= 5, f"did not converge: {dual_plan['iterations']} passes"

    print("rrm_engine self-check OK")
