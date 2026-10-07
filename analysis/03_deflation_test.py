"""
Step 3 - TEST 1: does the balloon empty the way the model says it should?

The model's deflation (rubber pressure law -> quasi-steady nozzle flow) does not depend
on the motion at all, so it can be tested on its own against the measured balloon
length L(t). Two numbers are fitted:
    L_start   the balloon's length scale at release (the initial size),
    D_nozzle  the effective neck diameter (sets how fast air escapes; C_d fixed at 0.8).
Everything else is fixed. The SHAPE of L(t) is then a prediction of the rubber law and
the nozzle physics. Fits are done from the release onward, for the four scenarios of
unknown rubber stiffness / balloon elongation, and also over the whole clip for comparison.

Writes results/deflation_fit.json and docs/figures/fig04_deflation.png.
"""
import numpy as np

from common import COL, SCENARIOS, T_RELEASE, fit_deflation, measurements, save_json, savefig, setup_style

m = measurements()
tL, L, sig_L = m["t_L"], m["L"], m["sig_L"]


out = {}
print("Deflation fit after release (t >= %.2f s):" % T_RELEASE)
for key, scn in SCENARIOS.items():
    f = fit_deflation(scn, T_RELEASE)
    out[key] = dict(label=scn["label"], after_release={k: v for k, v in f.items() if k != "arrays"})
    v, e = f["values"], f["se"]
    print(f"  {key} {scn['label']:<30} D_nozzle = {1e3 * v['D_nozzle']:.1f} ± {1e3 * e['D_nozzle']:.1f} mm, "
          f"chi2/dof = {f['chi2']:.1f}/{f['dof']} (p = {f['p_value']:.2f}), rms {f['rms_mm']:.1f} mm, "
          f"runs z = {f['runs']['z']:+.1f}, gauge pressure {f['gauge_pressure_Pa'][0]/1e3:.1f} -> {f['gauge_pressure_Pa'][1]/1e3:.1f} kPa, "
          f"air out {f['mass_flow_gps']:.1f} g/s")
print("Same fit over the WHOLE clip (from frame 1), for comparison:")
for key in ("S1", "S4"):
    f = fit_deflation(SCENARIOS[key], tL[0])
    out[key]["whole_clip"] = {k: v for k, v in f.items() if k != "arrays"}
    print(f"  {key}: chi2/dof = {f['chi2']:.1f}/{f['dof']} (p = {f['p_value']:.3f}), runs z = {f['runs']['z']:+.1f}")
# How demanding is this test? Compare with a straight line in time (also 2 parameters).
m_ = measurements()
sel = (tL >= T_RELEASE - 1e-9) & m_["ok_L"]
X = np.column_stack([np.ones(sel.sum()), tL[sel]])
w = 1 / sig_L[sel]
c, *_ = np.linalg.lstsq(X * w[:, None], L[sel] * w, rcond=None)
chi2_line = float(np.sum(((X @ c - L[sel]) * w) ** 2))
out["straight_line_chi2"] = chi2_line
print(f"A straight line L = L0 - k t (also 2 parameters) gives chi2 = {chi2_line:.1f} on {sel.sum() - 2} dof -> "
      "the data are consistent with the model but cannot single out its particular curve")
save_json("deflation_fit.json", out)

# figure: data, S1 and S4 fits, residuals
plt = setup_style()
fig, ax = plt.subplots(2, 1, figsize=(8.2, 6.0), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
f1 = fit_deflation(SCENARIOS["S1"], T_RELEASE)
f4 = fit_deflation(SCENARIOS["S4"], T_RELEASE)
t, y, sg, L1 = (f1["arrays"][k] for k in ("t", "L", "sig", "L_model"))
L4 = f4["arrays"]["L_model"]
tt = t + T_RELEASE
ax[0].errorbar(tL, L * 100, yerr=2 * sig_L * 100, fmt="o", ms=3.6, color=COL["data"], ecolor=COL["data"],
               elinewidth=0.9, alpha=0.9, label="measured length (±2σ)")
ax[0].plot(tt, L1 * 100, "-", color=COL["model"], lw=4.0, label="model: S1 " + SCENARIOS["S1"]["label"].lower())
ax[0].plot(tt, L4 * 100, "-", color=COL["model2"], lw=1.6, label="model: S4 " + SCENARIOS["S4"]["label"].lower() + " (lies on S1)")
ax[0].axvline(T_RELEASE, color=COL["ink2"], lw=1)
ax[0].set(ylabel="balloon length L (cm)",
          title=f"Test 1 - deflation: model vs video (χ²/dof = {f1['chi2_red']:.2f}, p = {f1['p_value']:.2f})")
ax[0].legend(loc="upper right")
ax[1].axhline(0, color=COL["axis"], lw=1)
ax[1].fill_between(tt, -2 * sg * 1e3, 2 * sg * 1e3, color=COL["data"], alpha=0.12, lw=0, label="±2σ measurement error")
ax[1].plot(tt, (y - L1) * 1e3, "o", ms=3.6, color=COL["model"], label="measured − model (S1)")
ax[1].set(xlabel="time (s)", ylabel="residual (mm)")
ax[1].legend(loc="lower left", ncols=2)
fig.tight_layout()
savefig(fig, "fig04_deflation.png")
print("saved docs/figures/fig04_deflation.png")
