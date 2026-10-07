"""
Figures for docs/01-physics-model.md, made directly from balloon_v3.py with default inputs.

    python model/make_guide_figures.py
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
sys.path.insert(0, str(ROOT / "analysis"))
import balloon_v3 as v3  # noqa: E402
from common import COL, setup_style  # noqa: E402

plt = setup_style()
p = v3.Params()
tab = v3.build_tables(p)

# membrane pressure curve
fig, ax = plt.subplots(figsize=(7.6, 3.6))
ax.plot(tab["lam"], tab["dP"] / 1e3, "-", color=COL["data"])
i_pk = np.argmax(np.where(tab["lam"] < 2.0, tab["dP"], 0))
i_dp = np.argmin(np.where((tab["lam"] > 2.0) & (tab["lam"] < 4.0), tab["dP"], np.inf))
for i, txt, dy in ((i_pk, "peak %.2f kPa at λ = %.2f", 10), (i_dp, "dip %.2f kPa at λ = %.2f", -16),
                   (len(tab["lam"]) - 1, "%.2f kPa at release, λ = %.0f", -30)):
    ax.plot(tab["lam"][i], tab["dP"][i] / 1e3, "o", ms=6, color=COL["data"], mec=COL["surface"], mew=1.5)
    ax.annotate(txt % (tab["dP"][i] / 1e3, tab["lam"][i]), (tab["lam"][i], tab["dP"][i] / 1e3),
                xytext=(-10 if i == len(tab["lam"]) - 1 else 8, dy), textcoords="offset points",
                ha="right" if i == len(tab["lam"]) - 1 else "left", fontsize=9, color=COL["ink2"])
ax.set(xlabel="stretch ratio λ = R/R0", ylabel="gauge pressure ΔP (kPa)", ylim=(0, 8),
       title="Membrane law with the default (placeholder) constants")
fig.tight_layout()
fig.savefig(ROOT / "docs" / "figures" / "guide_pressure_curve.png")

# default flight
r = v3.simulate(p)
fig, ax = plt.subplots(1, 2, figsize=(10.5, 3.8))
ax[0].plot(r["t"], r["v"], "-", color=COL["data"])
ib = np.argmax(r["v"])
ax[0].plot(r["t"][ib], r["v"][ib], "o", ms=6, color=COL["data"], mec=COL["surface"], mew=1.5)
ax[0].annotate(f"peak {r['v'][ib]:.1f} m/s at {r['t'][ib]:.1f} s", (r["t"][ib], r["v"][ib]), xytext=(8, 0),
               textcoords="offset points", fontsize=9, color=COL["ink2"])
ax[0].set(xlabel="time (s)", ylabel="speed (m/s)", title="Speed (default inputs)")
ax[1].plot(r["t"], r["thrust"], "-", color=COL["model"], label="thrust")
ax[1].plot(r["t"], r["drag"], "-", color=COL["data"], label="drag")
ax[1].set(xlabel="time (s)", ylabel="force (N)", title="Thrust and drag")
ax[1].legend(loc="upper right")
fig.tight_layout()
fig.savefig(ROOT / "docs" / "figures" / "guide_default_flight.png")
print(v3.summary(r))
print("saved docs/figures/guide_pressure_curve.png, guide_default_flight.png")
