"""Uji skala planner: 1 AP vs 2 AP vs 89 AP (sintetis, tanpa menyentuh router)."""
import math, random, time
import rrm_engine as rrm

ALLOWED = {"2g": [2412, 2437, 2462], "5g": [5180, 5200, 5220, 5240, 5745, 5765, 5785, 5805]}
CH2 = {2412: 1, 2437: 6, 2462: 11}
CH5 = {f: (f - 5000) // 5 for f in ALLOWED["5g"]}


def make_fleet(n: int, seed: int = 7) -> list[dict]:
    random.seed(seed)
    # grid 10 m spacing -> tetangga dekat benar-benar bertumpuk
    pos = [(i % 10, i // 10) for i in range(n)]
    aps = []
    for i, (x, y) in enumerate(pos):
        near = sorted(
            ((math.dist((x, y), p), j) for j, p in enumerate(pos) if j != i)
        )[:6]
        for band, cands in ALLOWED.items():
            nb = []
            for dist, j in near:
                sig = -50 - 18 * math.log10(max(dist, 1.0))
                if sig < -85:
                    continue
                nb.append({"freq": cands[(j + (0 if band == "2g" else 1)) % len(cands)],
                           "width": 20, "signal": round(sig, 1), "owner": f"ap{j}"})
            aps.append({"id": f"ap{i}-{band}", "device_id": f"ap{i}", "interface": band,
                        "band": band,
                        "freq": cands[i % len(cands)], "width": 20,
                        "neighbours": nb,
                        "noise": {f: -95.0 + (i * 3 + k) % 12 for k, f in enumerate(cands)}})
    return aps


def collisions(aps, assign):
    """Pasangan AP yang channel-nya sama DAN saling dengar (co-channel overlap)."""
    by_id = {a["id"]: a for a in aps}
    n = 0
    for a in aps:
        for nb in a["neighbours"]:
            o = nb.get("owner")
            if o in by_id and nb["freq"] == assign.get(o) and assign[a["id"]] == nb["freq"]:
                if a["id"] < o:
                    n += 1
    return n


def run(n_ap: int):
    aps = make_fleet(n_ap)
    t = time.time()
    out = rrm.plan_dca(aps, include_dfs=False, allowed=ALLOWED)
    dt = time.time() - t
    before = {a["id"]: a["freq"] for a in aps}
    after = dict(before)
    for c in out["changes"]:
        after[f'{c["device_id"]}-{c["band"]}'] = c["to_freq"]
    print(f"AP={n_ap:3d} radios={len(aps):3d}  plan {dt*1000:7.1f} ms  "
          f"changes={len(out['changes']):3d}  gain={out['gain_pct']:5.1f}%  "
          f"cost {out['cost_before']:.3e}->{out['cost_after']:.3e}  "
          f"collisions {collisions(aps, before)}->{collisions(aps, after)}  "
          f"iters={out['iterations']}")
    return out


if __name__ == "__main__":
    for n in (1, 2, 10, 89):
        run(n)
    # determinisme: dua run harus identik
    a = run(89)["changes"]
    b = run(89)["changes"]
    assert a == b, "plan_dca tidak deterministik"
    print("self-check OK: deterministik")
