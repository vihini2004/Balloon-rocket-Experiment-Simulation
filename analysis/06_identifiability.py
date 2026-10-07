"""
Step 6 - What can this clip determine, and what can it not?

A parameter can only be measured from the video if changing it changes the predicted
positions by more than the measurement noise (about 4.5 mm), and in a way no other
parameter can imitate. For the best fit of Test 2 this step computes:
  * the largest change in predicted position caused by a 10 % change in each parameter,
  * the uncertainty and correlations if friction were fitted too,
  * whether the four rubber/shape scenarios can be told apart from the motion.

Writes results/identifiability.json and docs/figures/fig09_identifiability.png.
"""
import json

import numpy as np

from common import (COL, RESULTS, SCENARIOS, fit_deflation, fit_motion, position_jacobian, save_json,
                    savefig, setup_style, straw_after)

t, s, sig = straw_after()
out = {}
for key in ("S1", "S4"):
    defl = fit_deflation(SCENARIOS[key])
    f = fit_motion(SCENARIOS[key], defl, t, s, sig)
    vals = dict(f["all"])
    extra = dict(mu_k=0.05, CdA_min=1.0e-3, C_add=0.5)
    keys = ["m_empty", "C_D", "v0", "x0", "mu_k", "CdA_min", "C_add"]
    J = position_jacobian(SCENARIOS[key], defl, t, vals, keys, extra=extra)
    allv = dict(vals, **extra)
    effect = {k: float(1e3 * 0.1 * abs(allv[k]) * np.abs(J[:, i]).max()) for i, k in enumerate(keys)}
    # covariance if friction is fitted along with mass, drag, v0, x0
    k5 = ["m_empty", "C_D", "v0", "x0", "mu_k"]
    J5 = J[:, [keys.index(k) for k in k5]] / sig[:, None]
    C5 = np.linalg.pinv(J5.T @ J5) * max(f["chi2_red"], 1.0)
    se5 = np.sqrt(np.diag(C5))
    corr5 = C5 / np.outer(se5, se5)
    out[key] = dict(best_fit=vals, effect_of_10pct_mm=effect,
                    with_friction_free=dict(se={k: float(x) for k, x in zip(k5, se5)},
                                            mu_k_relative_error=float(se5[4] / 0.05),
                                            corr=corr5.tolist(), keys=k5))
    print(f"{key} ({SCENARIOS[key]['label']}): largest change in predicted position for a 10 % change in")
    for k in keys:
        tag = "measurable" if effect[k] > 2 * np.median(sig) * 1e3 else ("barely" if effect[k] > 1 else "NOT measurable")
        print(f"   {k:<8} {effect[k]:7.2f} mm   ({tag}; noise ~{np.median(sig) * 1e3:.1f} mm per point)")
    print(f"   if friction is fitted too: mu_k = 0.05 ± {se5[4]:.3f} ({100 * se5[4] / 0.05:.0f} %), "
          f"corr(mu_k, m_empty) = {corr5[4, 0]:+.2f}, corr(mu_k, C_D) = {corr5[4, 1]:+.2f}")
mt = json.load(open(RESULTS / "motion_tests.json"))["test2_free_fit"]
out["scenario_chi2"] = {k: mt[k]["chi2"] for k in mt}
print("Motion fit quality per scenario (chi2):", {k: round(v, 1) for k, v in out["scenario_chi2"].items()},
      "-> the motion cannot tell the scenarios apart; only the fitted mass and drag change")
save_json("identifiability.json", out)

plt = setup_style()
fig, ax = plt.subplots(figsize=(8.2, 3.8))
eff = out["S1"]["effect_of_10pct_mm"]
names = {"m_empty": "moving mass", "C_D": "drag coefficient", "v0": "speed at release", "x0": "position at release",
         "mu_k": "wire friction μk", "CdA_min": "drag-area floor", "C_add": "added-mass coeff."}
order = sorted(eff, key=lambda k: eff[k])
y = np.arange(len(order))
ax.barh(y, [max(eff[k], 1e-3) for k in order], height=0.55, color=COL["data"])
ax.set_xscale("log")
ax.set_yticks(y, [names[k] for k in order])
noise = float(np.median(sig) * 1e3)
ax.axvline(noise, color=COL["model"], lw=1.6)
ax.annotate(f"measurement noise ≈ {noise:.1f} mm", (noise, len(order) - 0.6), xytext=(6, 0), textcoords="offset points",
            fontsize=9, color=COL["ink2"])
for yi, k in zip(y, order):
    lab = "no effect" if eff[k] < 1e-3 else f"{eff[k]:.2g} mm"
    ax.annotate(lab, (max(eff[k], 1e-3), yi), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8.5,
                color=COL["ink2"])
ax.set(xlabel="largest change in predicted position for a 10 % change (mm, log scale)",
       title="What this 0.7 s clip can measure (best fit, S1)", xlim=(1e-3, 4e2))
ax.grid(axis="y", visible=False)
fig.tight_layout()
savefig(fig, "fig09_identifiability.png")
print("saved docs/figures/fig09_identifiability.png")
