"""
Step 4 - TESTS 2-5: does the model reproduce the MOTION of the straw?

The thrust in every run below comes from the deflation fit of step 3, so it is tied to
how fast the balloon really emptied. Only the motion-side unknowns are varied.

  Test 2  Shape:   fit m_empty (moving mass apart from the air), C_D (drag coefficient),
                   v0 and x0 (speed and position at the onset) to s(t). Are the residuals
                   noise? Are the fitted values physically sensible?
  Test 3  Size:    no fitting at all. Start the model at the onset with the measured
                   speed and use ordinary values for mass and drag. How far off is it?
  Test 4  Predict: fit on 0.12-0.50 s only (deflation included), then predict 0.50-0.83 s,
                   carrying the fit's own uncertainty into the prediction.
  Test 5  Onset:   the first 0.1 s after the onset - measured acceleration against the
                   model, and whether the speed can be continuous through the onset.
  + sensitivity of Test 2 to the assumed onset time, and to the excluded frame.

Writes results/motion_tests.json, docs/figures/fig05_motion_fit.png,
docs/figures/fig06_prediction.png, docs/figures/fig07_holdout.png.
"""
import json

import numpy as np

from common import (A_WINDOW, COL, LP_ORDER, RESULTS, SCENARIOS, T_RELEASE, V_WINDOW, chi2_pvalue, fit_deflation,
                    fit_motion, local_poly, measurements, position_jacobian, predicted_position, save_json, savefig,
                    setup_style, straw_after)

out = {}
rel = json.load(open(RESULTS / "release.json"))
defl = {k: fit_deflation(scn) for k, scn in SCENARIOS.items()}
t, s, sig = straw_after()
meas = measurements()
MKEYS = ("m_empty", "C_D", "v0", "x0")


def clean(f):
    return {k: v for k, v in f.items() if k not in ("model_run", "arrays")}


def model_s(key, values, dfl=None):
    d = dfl or defl[key]
    return predicted_position(SCENARIOS[key], d["values"]["L_start"], d["values"]["D_nozzle"], t,
                              **{k: values[k] for k in MKEYS})[0]


# ---------------------------------------------------------------- Test 2: free fit (shape)
print("TEST 2 - fit mass and drag (thrust fixed by the deflation fit):")
fits = {}
for key, scn in SCENARIOS.items():
    f = fit_motion(scn, defl[key], t, s, sig)
    fits[key] = f
    v, e = f["values"], f["se"]
    print(f"  {key} {scn['label']:<30} m_empty = {1e3 * v['m_empty']:5.1f} ± {1e3 * e['m_empty']:.1f} g, "
          f"C_D = {v['C_D']:.2f} ± {e['C_D']:.2f}, v0 = {v['v0']:.2f} ± {e['v0']:.2f} m/s | "
          f"chi2/dof = {f['chi2']:.1f}/{f['dof']} (p = {f['p_value']:.1e}), rms {f['rms_mm']:.1f} mm, "
          f"runs z = {f['runs']['z']:+.1f}, corr(m, C_D) = {f['corr'][0][1]:+.2f}")
out["test2_free_fit"] = {k: dict(label=SCENARIOS[k]["label"], **clean(f)) for k, f in fits.items()}
print(f"  -> misses are about {np.sqrt(fits['S1']['chi2_red']):.1f} times the measurement noise "
      f"(rms {fits['S1']['rms_mm']:.1f} mm vs noise {1e3 * np.median(sig):.1f} mm)")

# with the flagged frame put back in (transparency)
mm = measurements()
sel_all = mm["t_s"] >= T_RELEASE - 1e-9
t_all, s_all, sig_all = mm["t_s"][sel_all] - T_RELEASE, mm["s"][sel_all], mm["sig_s"][sel_all]
inc = {}
for key in ("S1", "S4"):
    g = fit_motion(SCENARIOS[key], defl[key], t_all, s_all, sig_all)
    inc[key] = dict(values=g["values"], chi2=g["chi2"], dof=g["dof"], chi2_red=g["chi2_red"])
    print(f"  {key} with the excluded frame put back: m_empty = {1e3 * g['values']['m_empty']:.1f} g, "
          f"C_D = {g['values']['C_D']:.2f}, chi2/dof = {g['chi2']:.1f}/{g['dof']}")
out["test2_with_excluded_frame"] = inc

# like-for-like velocity and acceleration: the SAME local fits applied to video and model
f1 = fits["S1"]
tf = meas["t_s"]
after = tf >= T_RELEASE - 1e-9
mod_frames = np.full_like(tf, np.nan)
mod_frames[after] = predicted_position(SCENARIOS["S1"], defl["S1"]["values"]["L_start"], defl["S1"]["values"]["D_nozzle"],
                                       tf[after] - T_RELEASE, **{k: f1["all"][k] for k in MKEYS})[0]
use = meas["ok_s"] & after
lfl = {}
for name, win, der in (("v", V_WINDOW, 1), ("a", A_WINDOW, 2)):
    idx, est, err = local_poly(tf, meas["s"], meas["sig_s"], use, win, LP_ORDER, der)
    idm, mod, _ = local_poly(tf, np.nan_to_num(mod_frames), meas["sig_s"], use, win, LP_ORDER, der)
    full = tf[idx - win // 2] >= T_RELEASE - 1e-9            # whole window after the onset
    idx, est, err, mod = idx[full], est[full], err[full], mod[full]
    z = (est - mod) / err
    lfl[name] = dict(t=tf[idx].tolist(), data=est.tolist(), err=err.tolist(), model=mod.tolist(), z=z.tolist(),
                     frac_within_2sigma=float(np.mean(np.abs(z) < 2)), max_abs_z=float(np.max(np.abs(z))),
                     t_max_abs_z=float(tf[idx][np.argmax(np.abs(z))]))
    print(f"  like-for-like {name}: {100 * np.mean(np.abs(z) < 2):.0f} % of points within 2σ (about 95 % expected "
          f"for noise alone); largest miss {np.max(np.abs(z)):.1f}σ at t = {tf[idx][np.argmax(np.abs(z))]:.3f} s")
out["test2_like_for_like"] = lfl

# ---------------------------------------------------------------- Test 3: pure prediction (size)
print("\nTEST 3 - no fitting: start at the onset with the measured speed, ordinary mass and drag:")
pre = (meas["t_s"] < T_RELEASE) & meas["ok_s"]
x_rel = float(np.polyval(np.polyfit(meas["t_s"][pre], meas["s"][pre], 1, w=1 / meas["sig_s"][pre]), T_RELEASE))
s_end_meas = float(s[-1] - x_rel)
idx_v, v_est, v_err = local_poly(meas["t_s"], meas["s"], meas["sig_s"], meas["ok_s"], V_WINDOW, LP_ORDER, 1)
v_end_meas, v_end_err = float(v_est[-1]), float(v_err[-1])
t_v_end = float(meas["t_s"][idx_v[-1]] - T_RELEASE)
preds = {}
for key, scn in SCENARIOS.items():
    for m_e, cd in ((0.005, 0.47), (0.010, 1.0)):
        x, r = predicted_position(scn, defl[key]["values"]["L_start"], defl[key]["values"]["D_nozzle"], t,
                                  m_e, cd, rel["v_pre"], x_rel)
        v_end = float(np.interp(t_v_end, r["t"], r["v"]))
        tag = f"{key}_m{int(m_e * 1e3)}g_CD{cd}"
        preds[tag] = dict(scenario=key, m_empty=m_e, C_D=cd, distance_m=float(x[-1] - x_rel), v_end=v_end,
                          s=x.tolist(), v=np.interp(t, r["t"], r["v"]).tolist())
        print(f"  {key} m_empty {m_e * 1e3:.0f} g, C_D {cd}: distance after onset {x[-1] - x_rel:.2f} m "
              f"(measured {s_end_meas:.2f} m), speed at t = {t_v_end + T_RELEASE:.3f} s: {v_end:.1f} m/s "
              f"(measured {v_end_meas:.2f} ± {2 * v_end_err:.2f}, 2σ)")
ratios_d = [p["distance_m"] / s_end_meas for p in preds.values()]
ratios_v = [p["v_end"] / v_end_meas for p in preds.values()]
out["test3_prediction"] = dict(release_position=x_rel, release_speed=rel["v_pre"], measured_distance=s_end_meas,
                               measured_v_end=v_end_meas, measured_v_end_err=v_end_err, t_v_end=t_v_end + T_RELEASE,
                               distance_ratio_range=[min(ratios_d), max(ratios_d)],
                               speed_ratio_range=[min(ratios_v), max(ratios_v)],
                               runs={k: {kk: vv for kk, vv in p.items() if kk not in ("s", "v")} for k, p in preds.items()})
print(f"  -> the model overshoots the distance by x{min(ratios_d):.1f}-x{max(ratios_d):.1f} "
      f"and the final speed by x{min(ratios_v):.1f}-x{max(ratios_v):.1f}")

# ---------------------------------------------------------------- Test 4: hold-out prediction
print("\nTEST 4 - fit on the early part only (motion AND deflation), predict the rest with the fit's uncertainty:")
hold = {}
for key in ("S1", "S4"):
    for split in (0.40, 0.50, 0.60):
        tr = t <= split - T_RELEASE + 1e-9
        dfl = fit_deflation(SCENARIOS[key], T_RELEASE, t_to=split)
        f = fit_motion(SCENARIOS[key], dfl, t[tr], s[tr], sig[tr])
        Jtr = position_jacobian(SCENARIOS[key], dfl, t[tr], f["all"], list(MKEYS)) / sig[tr][:, None]
        C = np.linalg.pinv(Jtr.T @ Jtr) * max(f["chi2_red"], 1.0)
        full_pred = model_s(key, f["all"], dfl)
        pred = full_pred[~tr]
        Jte = position_jacobian(SCENARIOS[key], dfl, t[~tr], f["all"], list(MKEYS))
        sp = np.sqrt(np.einsum("ij,jk,ik->i", Jte, C, Jte))
        z = (s[~tr] - pred) / np.sqrt(sp ** 2 + sig[~tr] ** 2 * max(f["chi2_red"], 1.0))
        rel_se_cd = f["se"]["C_D"] / max(f["values"]["C_D"], 1e-9)
        under = bool(f["at_bound"]) or rel_se_cd > 1.0 or f["se"]["C_D"] < 1e-6
        tag = f"{key}_train_to_{split:.2f}"
        hold[tag] = dict(train_chi2_red=f["chi2_red"], m_empty=f["values"]["m_empty"], C_D=f["values"]["C_D"],
                         se=f["se"], at_bound=f["at_bound"], underdetermined=under, end_pred=float(pred[-1]),
                         end_pred_err=float(sp[-1]), end_meas=float(s[-1]), end_z=float(z[-1]),
                         test_chi2_per_point=float(np.mean(z ** 2)), n_test=int((~tr).sum()),
                         t_test=(t[~tr] + T_RELEASE).tolist(), pred=pred.tolist(), pred_err=sp.tolist(),
                         t_train=(t[tr] + T_RELEASE).tolist(), train_fit=full_pred[tr].tolist())
        flag = (f"  [UNDERDETERMINED: training window too short to pin down drag (C_D = {f['values']['C_D']:.2f} ± "
                f"{f['se']['C_D']:.2g}) - not used]") if under else ""
        print(f"  {key} train to {split:.2f} s: m = {1e3 * f['values']['m_empty']:.0f} g, C_D = {f['values']['C_D']:.2f} ± "
              f"{f['se']['C_D']:.2f}; end point predicted {pred[-1]:.3f} ± {sp[-1]:.3f} m, measured {s[-1]:.3f} m -> "
              f"{z[-1]:+.1f}σ; mean chi2 per test point {np.mean(z ** 2):.1f} (n = {(~tr).sum()}){flag}")
out["test4_holdout"] = hold

# ---------------------------------------------------------------- Test 5: the first 0.1 s after the onset
print("\nTEST 5 - the first 0.1 s after the onset:")
early = (t > 0) & (t <= 0.10 + 1e-9)
te, se_, sge = t[early], s[early], sig[early]


def quad_acc(y):
    X = np.column_stack([np.ones_like(te), te - te.mean(), (te - te.mean()) ** 2 / 2])
    W = 1 / sge ** 2
    C = np.linalg.inv(X.T @ (X * W[:, None]))
    c = C @ (X.T @ (W * y))
    r = (X @ c - y) / sge
    return c[2], np.sqrt(C[2, 2] * max(np.sum(r ** 2) / (len(y) - 3), 1.0))


a_meas, a_err = quad_acc(se_)
print(f"  measured mean acceleration over {te[0] + T_RELEASE:.3f}-{te[-1] + T_RELEASE:.3f} s (quadratic fit): "
      f"{a_meas:.1f} ± {a_err:.1f} m/s²")
early_tab = dict(measured=float(a_meas), measured_err=float(a_err), window=[float(te[0] + T_RELEASE), float(te[-1] + T_RELEASE)],
                 ordinary={}, fitted={})
for key, scn in SCENARIOS.items():
    for m_e, cd in ((0.005, 0.47), (0.010, 1.0)):
        x, _ = predicted_position(scn, defl[key]["values"]["L_start"], defl[key]["values"]["D_nozzle"], te,
                                  m_e, cd, rel["v_pre"], x_rel)
        early_tab["ordinary"][f"{key}_m{int(m_e * 1e3)}g_CD{cd}"] = float(quad_acc(x)[0])
    xf = model_s(key, fits[key]["all"])[early]
    early_tab["fitted"][key] = float(quad_acc(xf)[0])
o = early_tab["ordinary"]
print("  model, same fit to its own positions - ordinary values: " +
      ", ".join(f"{k.split('_')[0]} {k.split('_')[1][1:]}/{k.split('_')[2][2:]}: {v:.0f}" for k, v in o.items()))
print("  model, Test-2 fits (large mass and drag): " + ", ".join(f"{k}: {v:.1f}" for k, v in early_tab["fitted"].items()))
cont = {}
for key in ("S1", "S4"):
    fA = fits[key]
    fB = fit_motion(SCENARIOS[key], defl[key], t, s, sig, fixed=dict(v0=rel["v_pre"]))
    d = fB["chi2"] - fA["chi2"]
    d_scaled = d / max(fA["chi2_red"], 1.0)
    cont[key] = dict(v0_free=fA["values"]["v0"], v0_free_se=fA["se"]["v0"], chi2_free=fA["chi2"], chi2_fixed=fB["chi2"],
                     delta_chi2=d, delta_chi2_scaled=d_scaled, sigma_equiv=float(np.sqrt(d_scaled)),
                     fixed_fit=dict(m_empty=fB["values"]["m_empty"], C_D=fB["values"]["C_D"]))
    print(f"  {key}: the fit needs v0 = {fA['values']['v0']:.2f} ± {fA['se']['v0']:.2f} m/s at the onset (measured just before: "
          f"{rel['v_pre']:.2f}); forcing continuity raises chi2 by {d:.1f} ({np.sqrt(d_scaled):.1f}σ after scaling by chi2/dof)")
early_tab["continuity"] = cont
out["test5_onset"] = early_tab

# ---------------------------------------------------------------- onset-time sensitivity
print("\nSensitivity of Test 2 to the assumed onset time (scenario S1):")
sens = {}
for tr_ in (0.100, 0.117, 0.133, 0.150):
    dfl = fit_deflation(SCENARIOS["S1"], tr_)
    tt, ss, sg = straw_after(tr_)
    f = fit_motion(SCENARIOS["S1"], dfl, tt, ss, sg)
    sens[f"{tr_:.3f}"] = dict(m_empty=f["values"]["m_empty"], C_D=f["values"]["C_D"], v0=f["values"]["v0"],
                              chi2_red=f["chi2_red"], deflation_chi2_red=dfl["chi2_red"])
    print(f"  onset {tr_:.3f} s: m_empty = {1e3 * f['values']['m_empty']:.0f} g, C_D = {f['values']['C_D']:.2f}, "
          f"v0 = {f['values']['v0']:.2f} m/s, chi2/dof = {f['chi2_red']:.2f} (deflation {dfl['chi2_red']:.2f})")
out["onset_time_sensitivity"] = sens
save_json("motion_tests.json", out)

# ================================================================= figures
plt = setup_style()
pred1 = model_s("S1", f1["all"])

fig, axs = plt.subplots(2, 2, figsize=(10.5, 6.4), gridspec_kw=dict(height_ratios=[1.35, 1]))
a0, a2, a1, a3 = axs[0, 0], axs[0, 1], axs[1, 0], axs[1, 1]
a1.sharex(a0)
a0.plot(meas["t_s"][meas["ok_s"]], meas["s"][meas["ok_s"]], "o", ms=3.4, color=COL["data"], label="straw, measured")
a0.plot(t + T_RELEASE, pred1, "-", color=COL["model"], label="model fitted from the onset (S1)")
a0.axvline(T_RELEASE, color=COL["ink2"], lw=1)
a0.set(ylabel="s (m)", title="Test 2 - motion fit, mass and drag free")
a0.legend(loc="upper left")
a1.axhline(0, color=COL["axis"], lw=1)
a1.fill_between(t + T_RELEASE, -2e3 * sig, 2e3 * sig, color=COL["data"], alpha=0.12, lw=0, label="±2σ noise")
a1.plot(t + T_RELEASE, 1e3 * (s - pred1), "o", ms=3.4, color=COL["model"], label="measured − model")
a1.set(xlabel="time (s)", ylabel="residual (mm)")
a1.legend(loc="lower left", ncols=2)
for axx, name, unit, ttl in ((a2, "v", "m/s", "Velocity (same local fits on video and model)"),
                             (a3, "a", "m/s²", "Acceleration (same local fits on both)")):
    d = lfl[name]
    tt_, y, e, mm_ = (np.array(d[k]) for k in ("t", "data", "err", "model"))
    axx.fill_between(tt_, y - 2 * e, y + 2 * e, color=COL["data"], alpha=0.14, lw=0)
    axx.plot(tt_, y, "-", color=COL["data"], label="video (±2σ)")
    axx.plot(tt_, mm_, "-", color=COL["model"], label="model (S1 fit)")
    axx.set(ylabel=f"{name} ({unit})", title=ttl)
    axx.legend(loc="upper right" if name == "a" else "lower right")
a3.set(xlabel="time (s)")
fig.tight_layout()
savefig(fig, "fig05_motion_fit.png")

fig, ax = plt.subplots(1, 2, figsize=(10.5, 3.9))
pa, pb = preds["S1_m5g_CD0.47"], preds["S4_m10g_CD1.0"]
ax[0].plot(t + T_RELEASE, s - x_rel, "o", ms=3.4, color=COL["data"], label="video")
ax[1].fill_between(meas["t_s"][idx_v], v_est - 2 * v_err, v_est + 2 * v_err, color=COL["data"], alpha=0.14, lw=0)
ax[1].plot(meas["t_s"][idx_v], v_est, "-", color=COL["data"], label="video (±2σ)")
for axx, key in ((ax[0], "s"), (ax[1], "v")):
    off = x_rel if key == "s" else 0
    axx.plot(t + T_RELEASE, np.array(pa[key]) - off, "-", color=COL["model"], label="model: all defaults (5 g, C_D 0.47)")
    axx.plot(t + T_RELEASE, np.array(pb[key]) - off, "-", color=COL["model2"], label="model: soft + elongated, 10 g, C_D 1.0")
    axx.set(xlabel="time (s)")
ax[0].set(ylabel="distance since onset (m)", title="Test 3 - prediction with ordinary values (no fitting)")
ax[1].set(ylabel="speed (m/s)", title="Speed: prediction vs video")
ax[0].legend(loc="upper left")
fig.tight_layout()
savefig(fig, "fig06_prediction.png")

h = hold["S1_train_to_0.50"]
fig, ax = plt.subplots(figsize=(8.2, 3.9))
tt_tr, tt_te = np.array(h["t_train"]), np.array(h["t_test"])
ax.axhline(0, color=COL["axis"], lw=1)
mtr = (t + T_RELEASE) <= 0.50 + 1e-9
ax.plot(tt_tr, 1e3 * (s[mtr] - np.array(h["train_fit"])), "o", ms=3.6, color=COL["data"], label="training data − fit")
pe = np.array(h["pred_err"])
band = 2e3 * np.sqrt(pe ** 2 + sig[~mtr] ** 2 * max(h["train_chi2_red"], 1.0))
ax.fill_between(tt_te, -band, band, color=COL["model"], alpha=0.12, lw=0, label="±2σ prediction band")
ax.plot(tt_te, 1e3 * (s[~mtr] - np.array(h["pred"])), "o", ms=3.6, color=COL["model"], label="unseen data − prediction")
ax.axvline(0.50, color=COL["ink2"], lw=1)
ax.annotate("fit ends here", (0.50, ax.get_ylim()[1] * 0.85), xytext=(5, 0), textcoords="offset points",
            fontsize=9, color=COL["ink2"])
ax.set(xlabel="time (s)", ylabel="measured − model (mm)",
       title=f"Test 4 - hold-out (S1): end point {h['end_z']:+.1f}σ from the prediction")
ax.legend(loc="lower left")
fig.tight_layout()
savefig(fig, "fig07_holdout.png")
print("\nsaved docs/figures/fig05_motion_fit.png, fig06_prediction.png, fig07_holdout.png")
