"""
Step 1 - Is the Tracker data trustworthy, and how precise is it?

Checks, in order:
  1. Frame rate: which frame rate reproduces every exported time stamp?
  2. Marker alignment: A and B start at frame 0, C and D at frame 1, so rows must be
     matched by TIME, not by row number (row matching shifts C and D by one frame).
  3. Geometry: the straw (B) must lie between the balloon's ends (A front, C rear).
  4. Marker D: does it behave like a point on the balloon?
  5. Precision: the export kept 3 significant figures; what does that cost?
  6. Noise: random tracking scatter of each marker (robust third-difference estimate),
     and mis-clicks: positions far from the midpoint of their neighbours.
  7. Wire slope: from the straw's vertical coordinate.

Writes results/data_quality.json and docs/figures/fig01_tracks.png.
"""
import numpy as np

from common import (COL, DT, OUTLIER_SIGMA, load_tracker, check_frame_rate, find_outliers, on_frames,
                    tracking_sigma, save_json, setup_style, savefig)

M = load_tracker()
report = {}

# 1. frame rate -------------------------------------------------------------------------
fr = check_frame_rate(M)
report["frame_rate_check"] = {str(k): v for k, v in fr.items()}
assert fr[60], "time stamps are not consistent with 60 frames per second"
print("1. Frame rate: time stamps reproduced exactly by", [k for k, v in fr.items() if v], "fps -> using 60 fps")

# 2. alignment ---------------------------------------------------------------------------
for k in "ABCD":
    d = M[k]
    report[f"frames_{k}"] = [int(d["frame"][0]), int(d["frame"][-1]), int(len(d["frame"]))]
print("2. Frames: " + ", ".join(f"{k} {M[k]['frame'][0]}-{M[k]['frame'][-1]}" for k in "ABCD")
      + "  -> markers are matched by frame number (time), never by row")
frames = np.arange(1, 51)
xA, xB, xC, xD = (on_frames(M[k], frames) for k in "ABCD")
yB = on_frames(M["B"], frames, "y")
# what row-matching would have done: pair A's row i with C's row i (one frame apart)
row_shift_error = np.abs((M["A"]["x"][:50] + M["C"]["x"]) / 2 - (xA + xC) / 2)
report["row_matching_error_mm_max"] = float(1e3 * row_shift_error.max())
print(f"   (row matching would shift the A-C midpoint by up to {1e3 * row_shift_error.max():.1f} mm)")

# 3. geometry -----------------------------------------------------------------------------
order_ok = bool(np.all(xA < xB) and np.all(xB < xC))
report["straw_between_balloon_ends"] = order_ok
print(f"3. Straw between front and rear of balloon on every frame: {order_ok}")

# 4. marker D -----------------------------------------------------------------------------
slope, icpt = np.polyfit(xB, xD, 1)
resid = xD - (slope * xB + icpt)
dB = xB - xB[0]
ratio = (xD - xD[0])[5:] / dB[5:]
report["marker_D"] = dict(scale_vs_B=float(slope), rms_residual_m=float(resid.std()),
                          rms_residual_pct_of_range=float(100 * resid.std() / np.ptp(xD)),
                          displacement_ratio_range=[float(ratio.min()), float(ratio.max())],
                          mean_y_m=float(on_frames(M["D"], frames, "y").mean()), excluded=True)
print(f"4. Marker D: x_D = {slope:.3f} x_B + {icpt:+.3f}  (rms deviation {100 * resid.std() / np.ptp(xD):.1f} % of its range)")
print(f"   D moves {ratio.min():.1f}-{ratio.max():.1f} times as far as the straw it should travel with -> mis-scaled track, EXCLUDED")

# 5. precision ----------------------------------------------------------------------------
steps = sorted(set(np.round(np.concatenate([M[k]["qx"] for k in "ABC"]), 8)))
far = int(np.sum(M["B"]["qx"] >= 1e-2))
report["export_rounding_steps_m"] = [float(s) for s in steps]
report["straw_samples_with_1cm_rounding"] = far
print(f"5. Export rounding steps present: {[f'{s * 1e3:g} mm' for s in steps]}; "
      f"{far} of {len(M['B']['qx'])} straw positions are rounded to the nearest 1 cm (|x| >= 1 m)")

# 6. noise --------------------------------------------------------------------------------
noise = {}
for k in "ABC":
    s, n = tracking_sigma(M[k])
    noise[k] = dict(sigma_mm=1e3 * s, n_third_differences=n)
    print(f"6. Tracking scatter of marker {k}: {1e3 * s:.2f} mm (robust estimate from {n} third differences)")
report["tracking_noise"] = noise
out_frames = {}
for k in "ABC":
    sk = noise[k]["sigma_mm"] / 1e3
    bad = find_outliers(M[k], sk)
    x = M[k]["x"]
    sg = np.sqrt(sk ** 2 + M[k]["qx"] ** 2 / 12)
    devs, zs = {}, {}
    for i in range(1, len(x) - 1):
        f = int(M[k]["frame"][i])
        devs[f] = float(1e3 * (x[i] - 0.5 * (x[i - 1] + x[i + 1])))
        zs[f] = abs(devs[f]) / (1e3 * np.sqrt(sg[i] ** 2 + (sg[i - 1] ** 2 + sg[i + 1] ** 2) / 4))
    near = {f + d for f in bad for d in (-1, 1)}
    others = sorted(((z, f) for f, z in zs.items() if f not in bad and f not in near), reverse=True)
    out_frames[k] = dict(flagged=bad, deviation_mm={f: round(devs[f], 1) for f in bad},
                         z_flagged={f: round(zs[f], 2) for f in bad},
                         largest_other_z=[round(others[0][0], 2), others[0][1]])
    print(f"   Marker {k}: largest deviation among unflagged frames {others[0][0]:.2f} standard errors (frame {others[0][1]})")
    if bad:
        print(f"   Marker {k}: frame(s) {bad} lie more than {OUTLIER_SIGMA} standard errors from the midpoint of their "
              f"neighbours ({', '.join(f'{devs[f]:+.1f} mm, {zs[f]:.2f} standard errors' for f in bad)}) -> treated as "
              "mis-clicks and excluded")
report["mis_clicks"] = out_frames
print("   Total error per straw position = tracking scatter (+) rounding/sqrt(12): "
      f"{np.sqrt(noise['B']['sigma_mm']**2 + 1e6 * (1e-3)**2 / 12):.1f} mm below 1 m, "
      f"{np.sqrt(noise['B']['sigma_mm']**2 + 1e6 * (1e-2)**2 / 12):.1f} mm above 1 m")

# 7. wire slope -----------------------------------------------------------------------------
sl, _ = np.polyfit(xB, yB, 1)
report["wire_slope_deg"] = float(np.degrees(np.arctan(sl)))
report["straw_y_range_mm"] = float(1e3 * np.ptp(yB))
print(f"7. Straw height changes by {1e3 * np.ptp(yB):.0f} mm over 2 m; best-fit slope {np.degrees(np.arctan(sl)):+.2f} deg "
      "(in the video's axes) -> wire treated as level")

save_json("data_quality.json", report)

# figure ------------------------------------------------------------------------------------
plt = setup_style()
fig, ax = plt.subplots(1, 2, figsize=(10.5, 3.9), gridspec_kw=dict(width_ratios=[1.35, 1]))
labels = {"A": "A  balloon front", "B": "B  guide straw", "C": "C  balloon rear (neck)"}
colors = {"A": COL["model2"], "B": COL["data"], "C": COL["model"]}
for k in "ABC":
    d = M[k]
    ax[0].plot(d["t"], d["x"], "o-", ms=3.2, lw=1.2, color=colors[k], label=labels[k])
ax[0].set(xlabel="time (s)", ylabel="x position in video axes (m)",
          title="Tracked markers (motion is towards -x)")
ax[0].legend(loc="lower left")
ax[1].plot(xB, xD, "o", ms=3.5, color=COL["muted"], label="marker D vs straw B")
xx = np.linspace(xB.min(), xB.max(), 10)
ax[1].plot(xx, slope * xx + icpt, "-", lw=1.4, color=COL["ink2"], label=f"x_D = {slope:.2f} x_B")
ax[1].set(xlabel="straw position x_B (m)", ylabel="marker D position x_D (m)",
          title="Marker D is the straw's track scaled by ~4.6")
ax[1].legend(loc="upper left")
from matplotlib.ticker import MaxNLocator
ax[1].xaxis.set_major_locator(MaxNLocator(5))
fig.tight_layout()
savefig(fig, "fig01_tracks.png")
print("saved docs/figures/fig01_tracks.png")
