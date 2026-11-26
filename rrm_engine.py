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
TARGET_2G_DENSE_DBM = -72.0
TPC_DEADBAND_DB = 3.0
TPC_STEP_DB = 3.0
TPC_MIN_DBM = 10.0
TPC_MAX_DBM = 23.0
TPC_2G_DENSE_MAX_DBM = 17.0
DEFAULT_NOISE_DBM = -95.0

CH_2G = [2412, 2437, 2462]  # channels 1, 6, 11 — the only non-overlapping 2.4 GHz set
CH_5G_NON_DFS = [5180, 5200, 5220, 5240, 5745, 5765, 5785, 5805, 5825]
CH_5G_DFS = [5260, 5280, 5300, 5320,
             5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640, 5660, 5680, 5700, 5720]


def _block_primary(freq: int, width: float) -> int:
    """5 GHz channels wider than 20 MHz only exist as blocks; return the block anchor."""
    if not freq:
        return freq
    span = 20 * max(1, int(width or 20) // 20)
    if span <= 20:
        return freq
    if freq >= 5745:
        return 5745 + ((freq - 5745) // span) * span
    if freq >= 5180:
        return 5180 + ((freq - 5180) // span) * span
    return freq


def candidates(band: str, include_dfs: bool = False, width: float = 20) -> list[int]:
    if (band or "").lower().startswith("2"):
        return list(CH_2G)
    pool = list(CH_5G_NON_DFS) + (list(CH_5G_DFS) if include_dfs else [])
    if int(width or 20) <= 20:
        return pool
    out: list[int] = []
    span = 20 * max(1, int(width or 20) // 20)
    for f in pool:
        a = _block_primary(f, width)
        if a in out or (a + span - 20) not in pool:
            continue  # anchor whose last 20 MHz sub-channel is outside the band is not a real block
        out.append(a)
    return out


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


def channel_cost(freq: int, width: float, neighbours: list[dict], noise_dbm: float,
                 util_pct: float = 0.0) -> float:
    cost = dbm_to_mw(noise_dbm)
    for n in neighbours:
        ov = overlap(freq, width, n.get("freq", 0), n.get("width", 20))
        if ov > 0:
            weight = float(n.get("weight", 1.0))
            cost += ov * weight * dbm_to_mw(n.get("signal", DEFAULT_NOISE_DBM))
    # Airtime utilization multiplier: 0% -> 1.0x, 50% -> 2.0x, 100% -> 3.0x
    util = max(0.0, min(100.0, float(util_pct or 0.0)))
    if util > 0:
        cost *= (1.0 + util / 50.0)
    return cost


def _util_at(ap: dict, freq: int) -> float:
    table = ap.get("utilization") or {}
    if freq in table:
        return float(table[freq])
    if table:
        nearest = min(table, key=lambda f: abs(int(f) - freq))
        if abs(int(nearest) - freq) <= 20:
            return float(table[nearest])
    return 0.0


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
                              _noise_at(ap, f), _util_at(ap, f))
    return total


def evaluate_plan(aps: list[dict], changes: list[dict]) -> dict:
    """Evaluate any proposed channel plan (e.g. from an LLM) on the exact same RF graph.

    Returns {cost_before, cost_after, gain_pct, per_change: {(device_id, interface): {...}}}
    so plans from different engines can be compared objectively in mW and % gain.
    """
    if not aps:
        return {"cost_before": 0.0, "cost_after": 0.0, "gain_pct": 0.0, "per_change": {}}
    assign_before = {a["id"]: int(a.get("freq") or 0) for a in aps}
    assign_after = dict(assign_before)
    by_dev_iface = {(a.get("device_id") or a["id"], a.get("interface")): a["id"] for a in aps}
    for ch in (changes or []):
        key = by_dev_iface.get((ch.get("device_id"), ch.get("interface")))
        if key and ch.get("to_freq"):
            try:
                assign_after[key] = int(ch["to_freq"])
            except (TypeError, ValueError):
                pass
    cost_before = total_cost(aps, assign_before)
    cost_after = total_cost(aps, assign_after)
    gain_pct = round(100.0 * (1.0 - cost_after / cost_before), 1) if cost_before > 0 else 0.0

    ap_by_id = {a["id"]: a for a in aps}
    owner_idx = _owner_index(aps)
    per_change: dict[tuple, dict] = {}
    for ch in (changes or []):
        dev_if = (ch.get("device_id"), ch.get("interface"))
        ap_id = by_dev_iface.get(dev_if)
        if not ap_id:
            continue
        ap = ap_by_id[ap_id]
        old_f = int(ap.get("freq") or 0)
        new_f = assign_after[ap_id]
        w_old = float(ap.get("width") or 20)
        w_new = 20.0 if ch.get("fix_width") == "20mhz" else w_old
        nb_after = _neighbours_for(ap, assign_after, ap_by_id, owner_idx)
        old_c = channel_cost(old_f, w_old, nb_after, _noise_at(ap, old_f), _util_at(ap, old_f)) if old_f else cost_before
        new_c = channel_cost(new_f, w_new, nb_after, _noise_at(ap, new_f), _util_at(ap, new_f))
        per_change[dev_if] = {
            "interference_before_mw": float(f"{old_c:.6g}"),
            "interference_after_mw": float(f"{new_c:.6g}"),
            "relief_pct": round(100.0 * (1.0 - new_c / old_c), 1) if old_c > 0 else 0.0,
        }
    return {
        "cost_before": float(f"{cost_before:.6g}"),
        "cost_after": float(f"{cost_after:.6g}"),
        "gain_pct": gain_pct,
        "per_change": per_change,
    }


def plan_dca(aps: list[dict], include_dfs: bool = False, max_passes: int = 40,
             allowed: dict | None = None) -> dict:
    """Weighted-graph-colouring channel plan. `aps` entries:
        {id, band, freq, width, neighbours:[{freq,width,signal,owner?}], noise:{freq: dBm}}
    Returns {changes:[...], cost_before, cost_after, gain_pct, iterations}.
    """
    if not aps:
        return {"changes": [], "cost_before": 0.0, "cost_after": 0.0,
                "gain_pct": 0.0, "iterations": 0}

    def _opts_for(ap):
        band = ap.get("band", "2g")
        width = ap.get("width", 20)
        opts = candidates(band, include_dfs, width)
        if allowed:
            keep = allowed.get("2g" if str(band).startswith("2") else "5g")
            if keep:
                opts = [f for f in opts if f in keep]
        return opts

    # Channel di luar rencana (ch13, DFS, sisa utak-atik Winbox) = tidak valid,
    # bukan "sudah optimal". Tanpa ini cost model melihat semua channel sama
    # murah (0 tetangga) lalu mempertahankan nilai yang salah.
    off_plan = {}
    assign = {}
    for a in aps:
        opts = _opts_for(a)
        cur = int(a.get("freq") or 0)
        if opts and cur and cur not in opts:
            off_plan[a["id"]] = cur
            assign[a["id"]] = opts[0]
        else:
            assign[a["id"]] = cur or (opts[0] if opts else 0)
    ap_by_id = {a["id"]: a for a in aps}
    owner_idx = _owner_index(aps)
    cost_before = total_cost(aps, assign)
    best_assign, best_cost = dict(assign), cost_before
    iterations = 0

    for _ in range(max_passes):
        iterations += 1
        improved = False
        # Highest-conflict-first (deterministik): AP paling berinterferensi memilih dulu
        order = sorted(
            aps,
            key=lambda a: (
                -channel_cost(assign[a["id"]], a.get("width", 20),
                              _neighbours_for(a, assign, ap_by_id, owner_idx),
                              _noise_at(a, assign[a["id"]]), _util_at(a, assign[a["id"]])),
                a["id"],
            ),
        )
        for ap in order:
            band = ap.get("band", "2g")
            width = ap.get("width", 20)
            opts = _opts_for(ap)
            if not opts:
                continue
            nb = _neighbours_for(ap, assign, ap_by_id, owner_idx)
            cur_f = assign[ap["id"]]
            cur_block = cur_f if str(band).startswith("2") else _block_primary(cur_f, width)
            cur_c = channel_cost(cur_f, width, nb, _noise_at(ap, cur_f), _util_at(ap, cur_f))
            best_f, best_c = cur_f, cur_c
            for f in opts:
                c = channel_cost(f, width, nb, _noise_at(ap, f), _util_at(ap, f))
                if c < best_c * (1 - 1e-9):
                    best_f, best_c = f, c
            # Anti-churn histeresis: di armada padat 100 AP, jangan restart radio jika
            # perbaikan interferensi lokal < 5% (kecuali kanal memang off-plan).
            if best_f != cur_f and ap["id"] not in off_plan and cur_c > 0:
                if best_c > cur_c * 0.95:
                    best_f = cur_f
            if not str(band).startswith("2") and _block_primary(best_f, width) == cur_block:
                best_f = cur_f  # same 40/80 MHz block: moving the primary buys nothing, costs a restart
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
        is_2g = str(ap.get("band", "")).startswith("2")
        cur_width = float(ap.get("width") or 20)
        wide_2g = is_2g and cur_width > 20
        if old == new and not wide_2g:
            continue
        if not is_2g and old and \
                _block_primary(old, cur_width) == _block_primary(new, cur_width):
            continue  # same 40/80 MHz block, only the primary label moved
        nb = _neighbours_for(ap, best_assign, ap_by_id, owner_idx)
        old_cost = channel_cost(old, cur_width, nb, _noise_at(ap, old), _util_at(ap, old)) if old else cost_before
        new_cost = channel_cost(new, 20 if wide_2g else cur_width, nb, _noise_at(ap, new), _util_at(ap, new))
        ch = {
            "device_id": ap.get("device_id") or ap["id"], "interface": ap.get("interface"),
            "band": ap.get("band"), "from_freq": old, "to_freq": new,
            "interference_before_mw": float(f"{old_cost:.6g}"),
            "interference_after_mw": float(f"{new_cost:.6g}"),
            "relief_pct": round(100.0 * (1 - new_cost / old_cost), 1) if old_cost > 0 else 0.0,
        }
        if wide_2g:
            ch["fix_width"] = "20mhz"
            ch["repair"] = True
            ch["reason"] = f"2.4 GHz memakai {int(cur_width)} MHz (overlap channel) — dipersempit ke 20 MHz"
        if ap["id"] in off_plan:
            ch["repair"] = True
            ch["reason"] = f"channel {old} di luar rencana — dikembalikan ke {new}"
        changes.append(ch)

    gain = 0.0
    if cost_before > 0:
        gain = round(100.0 * (1 - best_cost / cost_before), 1)
    return {"changes": changes, "cost_before": float(f"{cost_before:.6g}"),
            "cost_after": float(f"{best_cost:.6g}"), "gain_pct": gain, "iterations": iterations}


def _fleet_neighbours(ap: dict) -> list[dict]:
    """Return neighbours belonging to our own fleet (excluding self).

    If neighbour entries do not carry an 'owner' key (legacy callers/tests),
    treat all entries as fleet neighbours for backward compatibility.
    """
    raw = ap.get("neighbours") or []
    own_id = ap.get("device_id") or ap["id"]
    has_owner_field = any("owner" in n for n in raw)
    if not has_owner_field:
        return [n for n in raw if n.get("signal") is not None]
    return [
        n for n in raw
        if n.get("signal") is not None and n.get("owner") and n.get("owner") != own_id
    ]


def is_dense_2g(ap: dict) -> bool:
    """True when a 2.4 GHz radio hears >= 3 distinct fleet APs (physical 3-channel limit)."""
    if not str(ap.get("band", "")).startswith("2"):
        return False
    fleet = _fleet_neighbours(ap)
    owners = {n.get("owner") or idx for idx, n in enumerate(fleet)}
    return len(owners) >= 3


def plan_tpc(aps: list[dict]) -> list[dict]:
    """Step tx-power toward TARGET_NEIGHBOR_DBM based ONLY on fleet neighbours.

    External (non-fleet) Wi-Fi neighbours are ignored for power reduction so a loud
    external router never forces our AP down to minimum power. In dense 2.4 GHz
    deployments (>= 3 fleet neighbours), a tighter target (-72 dBm) and ceiling
    (17 dBm) are used to shrink cell overlap.
    """
    out = []
    for ap in aps:
        fleet_nb = _fleet_neighbours(ap)
        nb = [float(n["signal"]) for n in fleet_nb]
        if not nb:
            continue
        try:
            cur = float(ap.get("tx_power"))
            was_default = False
        except (TypeError, ValueError):
            cur = TPC_MAX_DBM      # radio still on board default; first apply pins it explicitly
            was_default = True
        dense = is_dense_2g(ap)
        target_dbm = TARGET_2G_DENSE_DBM if dense else TARGET_NEIGHBOR_DBM
        max_dbm = TPC_2G_DENSE_MAX_DBM if dense else TPC_MAX_DBM
        strongest = max(nb)
        delta = target_dbm - strongest
        if abs(delta) <= TPC_DEADBAND_DB and cur <= max_dbm:
            continue
        if cur > max_dbm:
            step = -TPC_STEP_DB
            reason = f"2.4 GHz padat ({len(nb)} AP armada) — batasi tx-power <= {int(max_dbm)} dBm"
        else:
            step = TPC_STEP_DB if delta > 0 else -TPC_STEP_DB
            reason = ("fleet neighbour too loud — reduce coverage overlap"
                      if step < 0 else "coverage hole — raise power")
        new = max(TPC_MIN_DBM, min(max_dbm, cur + step))
        new = round(new)
        if new == round(cur):
            continue
        out.append({
            "device_id": ap.get("device_id") or ap["id"],
            "interface": ap.get("interface"), "band": ap.get("band"),
            "from_dbm": round(cur), "to_dbm": new, "strongest_neighbour_dbm": strongest,
            "fleet_neighbours_count": len(nb),
            "dense_2g": dense,
            "was_default": was_default,
            "reason": reason,
        })
    return out


def steering_rules(iface_2g: str | None, iface_5g: str | None,
                   clients_2g: list[dict], weak_dbm: float = -75.0,
                   dense_2g: bool = False) -> list[dict]:
    """Access-list rules: reject weak clients on 2.4 GHz so they land on 5 GHz.

    When 2.4 GHz is congested (dense_2g=True), tighten threshold to -70 dBm so
    dual-band clients migrate to 5 GHz earlier.
    """
    if not iface_2g or not clients_5g_capable(iface_5g):
        return []
    thr = max(weak_dbm, -70.0) if dense_2g else weak_dbm
    weak = []
    for c in clients_2g:
        try:
            sig = int(str(c.get("signal_strength", "-70")).split("@")[0])
        except (TypeError, ValueError):
            continue
        if sig < thr:
            weak.append(c.get("mac"))
    if not weak:
        return []
    return [{
        "interface": iface_2g,
        "signal_range": f"-120..{int(thr)}",
        "authentication": "no",
        "forwarding": "no",
        "comment": "RRM-steer-5g",
        "affected_macs": weak,
        "rationale": f"{len(weak)} client(s) below {int(thr)} dBm on 2.4 GHz"
                     f"{' (dense 2.4 GHz mode)' if dense_2g else ''} — "
                     "rejected there so they associate on the cleaner 5 GHz radio",
    }]


def clients_5g_capable(iface_5g: str | None) -> bool:
    return bool(iface_5g)


def plan_roam(seen: dict[str, dict[str, list[float]]],
              current: dict[str, dict],
              thr_dbm: float = -75.0, alt_min_dbm: float = -67.0,
              margin_db: float = 7.0, min_samples: int = 3,
              max_rules: int = 50, max_per_ap: int = 3) -> list[dict]:
    """Roaming paksa tanpa 802.11k/v: blokir & kick MAC di AP yang lemah (<= thr_dbm)
    agar langsung pindah ke AP terdekat yang lebih kuat.

    `seen`    = {mac: {device_id: [rssi, ...]}}  sampel RF dari riwayat
    `current` = {mac: {"device": id, "interface": name, "band": "2g"|"5g", "rssi"?: float}}

    Blokir memakai `mac-address` + `signal-range=-120..thr`, lalu klien di-kick dari
    registration-table agar langsung reconnect ke AP terdekat. Begitu sinyalnya di AP
    lama kembali kuat (di atas ambang), klien otomatis boleh asosiasi lagi.
    Guard: AP alternatif harus >= alt_min_dbm (kalau tidak, klien jadi yatim) dan
    selisihnya harus >= margin_db (histeresis, cegah osilasi).
    """
    out = []
    for mac, cur in current.items():
        if not cur:
            continue
        cur_dev = cur.get("device")
        per_dev = seen.get(mac) or {}
        med = {}
        for dev, vals in per_dev.items():
            v = sorted(float(x) for x in vals if x is not None)
            if len(v) >= min_samples:
                med[dev] = v[len(v) // 2]
        # Jika sampel histori di AP sekarang belum cukup, gunakan live RSSI saat ini
        live_rssi = cur.get("rssi")
        if cur_dev in med:
            cur_rssi = med[cur_dev]
            if live_rssi is not None:
                cur_rssi = min(cur_rssi, float(live_rssi))
        elif live_rssi is not None:
            cur_rssi = float(live_rssi)
        else:
            continue

        if cur_rssi > thr_dbm:
            continue

        # Cari AP alternatif terkuat (dari histori >= min_samples, fallback >= 1 jika live <= thr_dbm)
        alts = [(d, r) for d, r in med.items() if d != cur_dev]
        if not alts and live_rssi is not None:
            for dev, vals in per_dev.items():
                if dev == cur_dev:
                    continue
                v = sorted(float(x) for x in vals if x is not None)
                if v:
                    alts.append((dev, v[len(v) // 2]))
        if not alts:
            continue

        best_dev, best_rssi = max(alts, key=lambda kv: kv[1])
        if best_rssi < alt_min_dbm or (best_rssi - cur_rssi) < margin_db:
            continue
        out.append({
            "device_id": cur_dev,
            "interface": cur.get("interface"),
            "mac": mac,
            "band": cur.get("band"),
            "signal_range": f"-120..{int(thr_dbm)}",
            "current_dbm": round(cur_rssi, 1),
            "best_device": best_dev,
            "best_dbm": round(best_rssi, 1),
            "gain_db": round(best_rssi - cur_rssi, 1),
            "samples": len(per_dev.get(cur_dev) or []),
            "kick": True,
            "rationale": (f"{round(cur_rssi)} dBm di {cur_dev} (<= {int(thr_dbm)} dBm) vs "
                          f"{round(best_rssi)} dBm di {best_dev} — kick & tolak di {cur_dev} "
                          f"agar pindah ke {best_dev}"),
        })
    out.sort(key=lambda r: -r["gain_db"])
    # Batasi max_per_ap agar tidak pernah meng-kick terlalu banyak klien sekaligus dari 1 AP
    capped = []
    per_ap: dict[str, int] = {}
    for r in out:
        did = r["device_id"]
        if per_ap.get(did, 0) >= max_per_ap:
            continue
        per_ap[did] = per_ap.get(did, 0) + 1
        capped.append(r)
        if len(capped) >= max_rules:
            break
    return capped


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

    # roam: client weak on A (-78) but strong on B (-58) → kick & block on A only while <= -75 dBm
    seen = {"AA": {"a": [-78, -79, -77], "b": [-58, -57, -59]}}
    cur = {"AA": {"device": "a", "interface": "wlan1", "band": "2g"}}
    roam = plan_roam(seen, cur)
    assert len(roam) == 1 and roam[0]["device_id"] == "a" and roam[0]["kick"], roam
    assert roam[0]["signal_range"] == "-120..-75", roam
    assert roam[0]["best_device"] == "b" and roam[0]["gain_db"] == 20.0, roam
    # live -75 dBm triggers kick immediately even without 3 history samples on current AP
    live_roam = plan_roam({"BB": {"b": [-60]}},
                          {"BB": {"device": "a", "interface": "wlan1", "band": "2g", "rssi": -75.0}})
    assert len(live_roam) == 1 and live_roam[0]["best_device"] == "b", live_roam
    # no alternative AP heard → must not strand the client
    assert plan_roam({"AA": {"a": [-78, -79, -77]}}, cur) == []
    # alternative too weak (-70) → still stranded, refuse
    assert plan_roam({"AA": {"a": [-78, -79, -77], "b": [-70, -71, -70]}}, cur) == []
    # hysteresis: 4 dB better is not worth a forced roam
    assert plan_roam({"AA": {"a": [-75, -75, -75], "b": [-71, -71, -71]}}, cur) == []
    # client already strong on its AP → nothing to do
    assert plan_roam({"AA": {"a": [-55, -56, -54], "b": [-50, -50, -51]}}, cur) == []

    # Fix 1: utilization weighting — busy channel (70% util) loses to quiet channel with same noise
    util_ap = [{"id": "u", "band": "2g", "freq": 2412, "width": 20, "interface": "wlan1",
                "neighbours": [],
                "noise": {2412: -92, 2437: -92, 2462: -92},
                "utilization": {2412: 75.0, 2437: 5.0, 2462: 40.0}}]
    util_plan = plan_dca(util_ap)
    assert util_plan["changes"] and util_plan["changes"][0]["to_freq"] == 2437, util_plan

    # Fix 3: TPC ignores loud external neighbour (owner=None), only reacts to fleet neighbours
    ext_only = [{"id": "a", "device_id": "a", "interface": "wlan1", "band": "2g", "tx_power": 20,
                 "neighbours": [{"signal": -45, "owner": None}, {"signal": -40, "owner": "a"}]}]
    assert plan_tpc(ext_only) == [], "TPC must ignore external & self neighbours"
    fleet_loud = [{"id": "a", "device_id": "a", "interface": "wlan1", "band": "2g", "tx_power": 20,
                   "neighbours": [{"signal": -45, "owner": None}, {"signal": -58, "owner": "b"}]}]
    tpc_fl = plan_tpc(fleet_loud)
    assert tpc_fl and tpc_fl[0]["to_dbm"] == 17, tpc_fl

    # Fix 4: 2.4 GHz 40 MHz width enforced back to 20 MHz, and dense 2.4 GHz caps power & tightens steering
    wide_ap = [{"id": "w", "band": "2g", "freq": 2412, "width": 40, "interface": "wlan1",
                "neighbours": [], "noise": {2412: -95}}]
    wide_plan = plan_dca(wide_ap)
    assert wide_plan["changes"] and wide_plan["changes"][0].get("fix_width") == "20mhz", wide_plan
    dense_ap = [{"id": "d", "device_id": "d", "interface": "wlan1", "band": "2g", "tx_power": 21,
                 "neighbours": [{"signal": -71, "owner": "b"}, {"signal": -72, "owner": "c"}, {"signal": -73, "owner": "e"}]}]
    dense_tpc = plan_tpc(dense_ap)
    assert dense_tpc and dense_tpc[0]["to_dbm"] == 17 and dense_tpc[0]["dense_2g"], dense_tpc
    assert steering_rules("wlan1", "wlan2", [{"mac": "BB", "signal_strength": "-72@6Mbps"}], dense_2g=True)
    assert steering_rules("wlan1", "wlan2", [{"mac": "BB", "signal_strength": "-72@6Mbps"}], dense_2g=False) == []

    # evaluate_plan: objectively scores external (e.g. LLM) plans on the same RF graph
    ev_good = evaluate_plan(aps, [{"device_id": "b", "interface": "wlan1", "to_freq": 2437}])
    ev_bad = evaluate_plan(aps, [{"device_id": "b", "interface": "wlan1", "to_freq": 2412}])
    assert ev_good["cost_after"] < ev_bad["cost_after"] and ev_good["gain_pct"] > 0, (ev_good, ev_bad)

    print("rrm_engine self-check OK")
