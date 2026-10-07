"""
Step 5 - Two independent measurements of the thrust.

  (a) From the MOTION (Newton's second law, rearranged):
        T_needed = m_eff a + F_drag + F_friction - F_added_mass_recovery
      with a and v from the video (step 2) and an assumed moving mass and drag coefficient.
  (b) From the DEFLATION: the jet's momentum flux T = m_dot * v_jet that the model computes
      from the measured emptying rate (step 3).

If the model's thrust physics were right, (a) and (b) would agree for sensible values of
mass and drag. The ratio (a)/(b) says what fraction of the expected thrust actually
showed up in the motion.

Writes results/force_balance.json and docs/figures/fig08_force_balance.png.
"""
import json

import numpy as np

from common import (A_WINDOW, COL, DT, LP_ORDER, RESULTS, R0, SCENARIOS, T_RELEASE, V_WINDOW, bv3,
                    fit_deflation, local_poly, measurements, run_model, save_json, savefig, setup_style)

meas = measurements()
use = meas["ok_s"] & (meas["t_s"] >= T_RELEASE - 1e-9)
ia, a, ea = local_poly(meas["t_s"], meas["s"], meas["sig_s"], use, A_WINDOW, LP_ORDER, 2)
iv, v, ev = local_poly(meas["t_s"], meas["s"], meas["sig_s"], use, V_WINDOW, LP_ORDER, 1)
ta = meas["t_s"][ia]
keep = meas["t_s"][ia - A_WINDOW // 2] >= T_RELEASE - 1e-9       # whole window after the onset
ta, a, ea = ta[keep], a[keep], ea[keep]
va = np.interp(ta, meas["t_s"][iv], v)
# early window (first 0.1 s after the onset): mean acceleration from Test 5
early = json.load(open(RESULTS / "motion_tests.json"))["test5_onset"]
t_early = 0.5 * (early["window"][0] + early["window"][1])
a_early, ea_early = early["measured"], early["measured_err"]
v_early = float(np.interp(t_early, meas["t_s"][iv], v))
rho, g = bv3.Params().rho, 9.81
C_add, mu_k = 0.5, 0.05

def deflation_state(key, times):
    f = fit_deflation(SCENARIOS[key])
    r = run_model(SCENARIOS[key], f["values"]["L_start"], f["values"]["D_nozzle"], t_end=ta[-1] - T_RELEASE + 0.05)
    tr = np.atleast_1d(times) - T_RELEASE
    R = np.interp(tr, r["t"], r["lam"]) * R0
    V = 4 / 3 * np.pi * R ** 3
    tt = r["t"]; VV = 4 / 3 * np.pi * (r["lam"] * R0) ** 3
    dVdt = np.interp(tr, tt, np.gradient(VV, tt))
    return dict(T=np.interp(tr, tt, r["thrust"]), m_air=np.interp(tr, tt, r["m_air"]), V=V, R=R, dVdt=dVdt)

def thrust_needed(st, m_e, C_D, acc, acc_err, vel):
    m_eff = m_e + st["m_air"] + C_add * rho * st["V"]
    F_D = 0.5 * rho * C_D * np.pi * st["R"] ** 2 * vel ** 2
    F_f = mu_k * np.maximum(m_e + st["m_air"] - rho * st["V"], 0) * g
    F_amr = -C_add * rho * vel * st["dVdt"]          # forward push while the balloon shrinks
    T = m_eff * acc + F_D + F_f - F_amr
    return T, m_eff * acc_err

out = dict(t=ta.tolist(), a=a.tolist(), a_err=ea.tolist(), t_early=t_early, a_early=a_early, a_early_err=ea_early,
           scenarios={})
cases = [(0.005, 0.47), (0.010, 1.0)]
print(f"From {ta[0]:.2f} s to {ta[-1]:.2f} s (mean), and in the first 0.1 s after the onset (t ≈ {t_early:.3f} s):")
for key in SCENARIOS:
    st = deflation_state(key, ta)
    st_e = deflation_state(key, [t_early])
    row = dict(T_deflation=st["T"].tolist(), T_deflation_early=float(st_e["T"][0]), cases={})
    for m_e, cd in cases:
        T, eT = thrust_needed(st, m_e, cd, a, ea, va)
        Te, eTe = thrust_needed(st_e, m_e, cd, a_early, ea_early, v_early)
        ratio = T / st["T"]
        row["cases"][f"m{int(m_e * 1e3)}g_CD{cd}"] = dict(T_needed=T.tolist(), T_err=eT.tolist(),
                                                         mean_ratio=float(np.mean(ratio)),
                                                         T_needed_early=float(Te[0]), T_err_early=float(eTe[0]),
                                                         ratio_early=float(Te[0] / st_e["T"][0]),
                                                         ratio_early_err=float(eTe[0] / st_e["T"][0]))
        print(f"  {key} {SCENARIOS[key]['label']:<30} {m_e * 1e3:2.0f} g, C_D {cd}: needed {np.mean(T):.3f} N vs deflation "
              f"{np.mean(st['T']):.3f} N -> ratio {np.mean(ratio):.2f} | early: needed {Te[0]:.2f} ± {eTe[0]:.2f} N vs "
              f"{st_e['T'][0]:.2f} N -> ratio {Te[0] / st_e['T'][0]:.2f} ± {eTe[0] / st_e['T'][0]:.2f}")
    out["scenarios"][key] = row
allr = [c["mean_ratio"] for s_ in out["scenarios"].values() for c in s_["cases"].values()]
alle = [c["ratio_early"] for s_ in out["scenarios"].values() for c in s_["cases"].values()]
out["ratio_range"] = [min(allr), max(allr)]
out["ratio_range_early"] = [min(alle), max(alle)]
print(f"-> from {ta[0]:.2f} s on, the motion shows only {100 * min(allr):.0f}-{100 * max(allr):.0f} % of the thrust the "
      f"deflation implies; in the first 0.1 s after the onset it shows {100 * min(alle):.0f}-{100 * max(alle):.0f} %")
save_json("force_balance.json", out)

plt = setup_style()
fig, ax = plt.subplots(figsize=(8.2, 4.2))
Ts = np.array([out["scenarios"][k]["cases"][c]["T_needed"] for k in SCENARIOS for c in out["scenarios"][k]["cases"]])
Es = np.array([out["scenarios"][k]["cases"][c]["T_err"] for k in SCENARIOS for c in out["scenarios"][k]["cases"]])
lo, hi = (Ts - 2 * Es).min(axis=0), (Ts + 2 * Es).max(axis=0)
ax.fill_between(ta, lo, hi, color=COL["data"], alpha=0.18, lw=0,
                label="needed by the measured motion (mass 5-10 g, C_D 0.47-1.0, ±2σ)")
ax.plot(ta, np.array(out["scenarios"]["S1"]["T_deflation"]), "-", color=COL["model"],
        label="from the deflation, S1 model defaults")
ax.plot(ta, np.array(out["scenarios"]["S4"]["T_deflation"]), "-", color=COL["model2"],
        label="from the deflation, S4 softer + elongated")
Te_all = np.array([[c["T_needed_early"] - 2 * c["T_err_early"], c["T_needed_early"] + 2 * c["T_err_early"]]
                   for k in SCENARIOS for c in out["scenarios"][k]["cases"].values()])
ax.vlines(t_early, Te_all[:, 0].min(), Te_all[:, 1].max(), color=COL["data"], lw=6, alpha=0.35)
ax.annotate("first 0.1 s\nafter onset", (t_early, Te_all[:, 1].max()), xytext=(0, 6), textcoords="offset points",
            ha="center", fontsize=8.5, color=COL["ink2"])
for key, col in (("S1", COL["model"]), ("S4", COL["model2"])):
    ax.plot([t_early], [out["scenarios"][key]["T_deflation_early"]], "o", ms=6, color=col, mec=COL["surface"], mew=1.5)
ax.axhline(0, color=COL["axis"], lw=1)
ax.set(xlabel="time (s)", ylabel="thrust (N)", ylim=(0, None), xlim=(0.12, None),
       title=f"Force balance: from 0.25 s the jet should push {1 / max(allr):.1f}-{1 / min(allr):.0f}x harder than the motion shows")
ax.legend(loc="upper right", fontsize=8.5)
fig.tight_layout()
savefig(fig, "fig08_force_balance.png")
print("saved docs/figures/fig08_force_balance.png")
