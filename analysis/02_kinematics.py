"""
Step 2 - From positions to velocity, acceleration and balloon size, with error bars.

  * s(t): distance travelled by the guide straw (marker B).
  * v(t), a(t): local quadratic least-squares fits over 9 frames (0.15 s) and 15 frames
    (0.25 s), weighted by the per-frame errors of step 1, skipping the flagged frame.
    Their 1-sigma errors follow exactly from the fit. Values are only reported where
    the whole window lies inside the record (no end effects).
  * L(t) = x_C - x_A: the balloon's length along the wire.
  * Onset of acceleration: at first the straw is not accelerating forward; then it
    suddenly is. A change-point fit locates that moment (the "release").

Writes results/kinematics.csv, results/release.json, docs/figures/fig02_release.png,
docs/figures/fig03_kinematics.png.
"""
import numpy as np

from common import (A_WINDOW, COL, DT, LP_ORDER, T_RELEASE, V_WINDOW, local_poly, measurements, release_fit,
                    save_json, savefig, setup_style, RESULTS)

m = measurements()
t, s, sig_s, ok_s = m["t_s"], m["s"], m["sig_s"], m["ok_s"]          # straw, frames 0..50
tL, L, sig_L, ok_L = m["t_L"], m["L"], m["sig_L"], m["ok_L"]         # balloon length, frames 1..50
print(f"Excluded as mis-clicks: {m['outliers']}  (frame numbers per marker)")

# onset of acceleration ------------------------------------------------------------------------
rel = release_fit(t, s, sig_s, ok_s)
lo, hi = rel["t_release_68"]
print(f"Before t = {rel['t_release']:.3f} s the straw moves at {rel['v_pre']:.2f} ± {rel['v_pre_err']:.2f} m/s and is not "
      f"speeding up (quadratic fit to those frames: a = {rel['a_before']:+.1f} ± {rel['a_before_err']:.1f} m/s²).")
print(f"Then it accelerates at {rel['a_after']:.1f} ± {rel['a_after_err']:.1f} m/s². Onset 68 % range {lo:.3f}-{hi:.3f} s.")
print(f"  chi2: change point {rel['chi2']:.1f} (dof {rel['dof']}); smooth cubic {rel['chi2_cubic']:.1f}; "
      f"smooth quartic (same number of parameters) {rel['chi2_quartic']:.1f}  ->  the change is rapid, but whether it is abrupt "
      f"or smooth is not determined")
assert abs(rel["t_release"] - T_RELEASE) < 0.01, "update T_RELEASE in common.py"
save_json("release.json", rel)

# derivatives ---------------------------------------------------------------------------------
iv, v, ev = local_poly(t, s, sig_s, ok_s, V_WINDOW, LP_ORDER, 1)
ia, a, ea = local_poly(t, s, sig_s, ok_s, A_WINDOW, LP_ORDER, 2)
print(f"Velocity: window {V_WINDOW} frames, median 1-sigma error {np.median(ev):.3f} m/s")
print(f"Acceleration: window {A_WINDOW} frames, median 1-sigma error {np.median(ea):.2f} m/s²")

n = len(t)
V = np.full(n, np.nan); EV = np.full(n, np.nan); A = np.full(n, np.nan); EA = np.full(n, np.nan)
V[iv], EV[iv], A[ia], EA[ia] = v, ev, a, ea
LL = np.full(n, np.nan); ELL = np.full(n, np.nan)
LL[m["frame_L"]], ELL[m["frame_L"]] = L, sig_L
hdr = "frame,t_s,s_m,sigma_s_m,used,v_mps,sigma_v_mps,a_mps2,sigma_a_mps2,L_m,sigma_L_m"
rows = np.column_stack([m["frame_s"], t, s, sig_s, ok_s.astype(int), V, EV, A, EA, LL, ELL])
np.savetxt(RESULTS / "kinematics.csv", rows, delimiter=",", header=hdr, comments="",
           fmt=["%d", "%.5f", "%.4f", "%.4f", "%d", "%.3f", "%.3f", "%.2f", "%.2f", "%.4f", "%.4f"])

after = t[ia] >= T_RELEASE + (A_WINDOW // 2) * DT
print("Acceleration (windows entirely after the onset), ±2σ:")
for k in np.where(after)[0][::4]:
    print(f"   t = {t[ia][k]:.3f} s  a = {a[k]:5.2f} ± {2 * ea[k]:.2f} m/s²   v = {np.interp(t[ia][k], t[iv], v):.2f} m/s")
print(f"Balloon length: {L[0] * 100:.1f} cm at frame 1 -> {L[-1] * 100:.1f} cm at the end (±{2 * np.median(sig_L) * 100:.1f} cm, 2σ)")
print(f"Speed at the end of the clip: {v[-1]:.2f} ± {2 * ev[-1]:.2f} m/s (2σ, last full window, t = {t[iv][-1]:.3f} s)")

# figures ---------------------------------------------------------------------------------------
plt = setup_style()

fig, ax = plt.subplots(1, 2, figsize=(10.5, 3.6))
sel = (t <= 0.30 + 1e-9)
k_ok, k_bad = sel & ok_s, sel & ~ok_s
ax[0].errorbar(t[k_ok], s[k_ok] * 100, yerr=2 * sig_s[k_ok] * 100, fmt="o", ms=4, color=COL["data"],
               ecolor=COL["data"], elinewidth=1, capsize=0, label="straw (±2σ)")
if k_bad.any():
    ax[0].plot(t[k_bad], s[k_bad] * 100, "x", ms=6, mew=1.5, color=COL["muted"], label="excluded mis-click")
tt = np.linspace(0, 0.30, 300)
fit_sel = sel & ok_s
X = np.column_stack([np.ones(fit_sel.sum()), t[fit_sel], np.clip(t[fit_sel] - rel["t_release"], 0, None) ** 2 / 2,
                     np.clip(t[fit_sel] - rel["t_release"], 0, None) ** 3 / 6])
w = 1 / sig_s[fit_sel]
coef, *_ = np.linalg.lstsq(X * w[:, None], s[fit_sel] * w, rcond=None)
u = np.clip(tt - rel["t_release"], 0, None)
ax[0].plot(tt, (np.column_stack([np.ones_like(tt), tt, u ** 2 / 2, u ** 3 / 6]) @ coef) * 100, "-",
           color=COL["model"], lw=1.8, label="steady speed, then accelerating")
ax[0].axvspan(lo, hi, color=COL["muted"], alpha=0.15, lw=0)
ax[0].axvline(rel["t_release"], color=COL["ink2"], lw=1)
ax[0].annotate(f"onset ≈ {rel['t_release']:.2f} s", (rel["t_release"], 2), xytext=(6, 0),
               textcoords="offset points", color=COL["ink2"], fontsize=9)
ax[0].set(xlabel="time (s)", ylabel="distance travelled (cm)", title="Start of the clip: the straw is not yet free")
ax[0].legend(loc="upper left")
gr, pr = np.array(rel["grid"]), np.array(rel["chi2_profile"])
ax[1].plot(gr, pr, "-", color=COL["data"], lw=1.8)
for val, txt, dy in ((rel["chi2_cubic"], "smooth cubic, no onset (χ² = %.0f)", 4),
                     (rel["chi2_quartic"], "smooth quartic, same no. of parameters (χ² = %.0f)", 4)):
    ax[1].axhline(val, color=COL["muted"], lw=1)
    ax[1].annotate(txt % val, (gr[0], val), xytext=(2, dy), textcoords="offset points", color=COL["ink2"], fontsize=9)
ax[1].set(xlabel="assumed onset time (s)", ylabel="χ² of the fit", title="Fit quality vs onset time")
fig.tight_layout()
savefig(fig, "fig02_release.png")

fig, ax = plt.subplots(2, 2, figsize=(10.5, 7.0), sharex=True)
ax[0, 0].plot(t[ok_s], s[ok_s], "o", ms=3.2, color=COL["data"], label="straw")
if (~ok_s).any():
    ax[0, 0].plot(t[~ok_s], s[~ok_s], "x", ms=6, mew=1.5, color=COL["muted"], label="excluded mis-click")
    ax[0, 0].legend(loc="upper left")
ax[0, 0].set(ylabel="s (m)", title="Distance travelled by the straw")
ax[0, 1].fill_between(t[iv], v - 2 * ev, v + 2 * ev, color=COL["data"], alpha=0.14, lw=0)
ax[0, 1].plot(t[iv], v, "-", color=COL["data"], lw=1.8)
ax[0, 1].set(ylabel="v (m/s)", title="Velocity (band = ±2σ)")
blend = t[ia] < rel["t_release"] + (A_WINDOW // 2) * DT     # window still spans the onset
ax[1, 0].fill_between(t[ia], a - 2 * ea, a + 2 * ea, color=COL["data"], alpha=0.14, lw=0)
ax[1, 0].plot(t[ia][blend | np.roll(blend, 1)], a[blend | np.roll(blend, 1)], "-", color=COL["data"], lw=1.8, alpha=0.35)
ax[1, 0].plot(t[ia][~blend], a[~blend], "-", color=COL["data"], lw=1.8)
ax[1, 0].annotate("window spans\nthe onset", (t[ia][blend][-1], a[blend][-1]), xytext=(10, 12),
                  textcoords="offset points", color=COL["ink2"], fontsize=8.5)
ax[1, 0].axhline(0, color=COL["axis"], lw=1)
ax[1, 0].set(ylabel="a (m/s²)", xlabel="time (s)", title="Acceleration (band = ±2σ)")
ax[1, 1].fill_between(tL, (L - 2 * sig_L) * 100, (L + 2 * sig_L) * 100, color=COL["data"], alpha=0.14, lw=0)
ax[1, 1].plot(tL[ok_L], L[ok_L] * 100, "o", ms=3.2, color=COL["data"])
ax[1, 1].set(ylabel="L (cm)", xlabel="time (s)", title="Balloon length along the wire (±2σ)")
for axx in ax.ravel():
    axx.axvline(rel["t_release"], color=COL["ink2"], lw=1)
ax[0, 0].annotate("onset", (rel["t_release"], 1.3), xytext=(4, 0), textcoords="offset points",
                  color=COL["ink2"], fontsize=9)
fig.tight_layout()
savefig(fig, "fig03_kinematics.png")
print("saved docs/figures/fig02_release.png, fig03_kinematics.png")
