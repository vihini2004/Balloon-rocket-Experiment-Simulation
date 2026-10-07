"""
Python reference results for the JavaScript engine test (tests/test_js_engine.js).

    python tests/make_js_reference.py   ->   tests/js_reference.json
"""
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
import balloon_v3 as v3  # noqa: E402


def summ(r, p):
    # the JS engine's momentum budget integrates the thrust ALONG THE WIRE, T cos(alpha);
    # balloon_v3's impulse_thrust integrates the total thrust T. alpha is constant, so:
    axial = float(r["impulse_thrust"]) * float(np.cos(np.radians(p.misalign_deg)))
    return dict(x_end=float(r["x_end"]), v_max=float(r["v_max"]), t_end=float(r["t_end"]),
                t_burn=float(r.get("t_burn", float("nan"))), x_burn=float(r.get("x_burn", float("nan"))),
                T_peak=float(r["thrust"].max()), I_thrust=float(r["impulse_thrust"]), I_thrust_axial=axial,
                ended=r["ended_by"])


B = v3.Params()
cases = {
    "A_default": B,
    "B_adiabatic": replace(B, thermal="adiabatic"),
    "C_slope_misalign_friction": replace(B, theta_deg=5, misalign_deg=10, mu_k=0.3, mu_s=0.4),
    "D_wire4": replace(B, L_wire=4.0),
    "E_nozzle10_noAM": replace(B, D_nozzle=0.010, use_added_mass=False),
    "F_prolate_nofloor_nobuoy": replace(B, C_add=0.21, CdA_min=0.0, use_buoyancy=False),
    "I_no_recovery": replace(B, use_added_mass_rate=False),
}
out = {k: summ(v3.simulate(p), p) for k, p in cases.items()}
# the Mooney-Rivlin curve fed back in as a "measured" deflation curve (same 6000-point grid in JS)
tab = v3.build_tables(B)
out["G_measured_MR"] = summ(v3.simulate(replace(B, pv_data=(tuple(tab["V"]), tuple(tab["dP"])))), B)
# a Gent-law curve given as measured data (JS evaluates the Gent law directly)
mu, Jm = 2.6e5, 100.0
lam = np.linspace(1, 6, 6000)
dPg = 2 * mu * (B.w0 / B.R0) * (1 / lam - lam ** -7) / (1 - (2 * lam ** 2 + lam ** -4 - 3) / Jm)
Vg = 4 / 3 * np.pi * (lam * B.R0) ** 3
out["H_gent_as_pv"] = summ(v3.simulate(replace(B, pv_data=(tuple(Vg), tuple(dPg)))), B)
path = ROOT / "tests" / "js_reference.json"
json.dump(out, open(path, "w"), indent=1)
for k, v in out.items():
    print(f"{k:28s} x_end {v['x_end']:.4f}  v_max {v['v_max']:.4f}  ended {v['ended']}")
print("wrote", path.relative_to(ROOT))
