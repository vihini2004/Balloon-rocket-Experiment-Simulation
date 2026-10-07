"""
Shared code for the video analysis.

Everything the numbered scripts need lives here, so each step can be read on its own:

  * loading the Tracker export and rebuilding exact frame times,
  * the measurement-noise model (tracking scatter + rounding of the exported numbers),
  * Savitzky-Golay derivatives WITH propagated error bars,
  * the release-time (change-point) fit,
  * thin wrappers that run the physics model (model/balloon_v3.py) for this clip,
  * weighted least-squares fitting with covariance, and a runs test for residuals,
  * one plotting style for every figure.

Units are SI throughout (m, s, kg, N, Pa) unless a variable name says otherwise.
"""
from __future__ import annotations

import csv
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
import balloon_v3 as bv3  # noqa: E402  (the physics model)

DATA_FILE = ROOT / "analysis" / "data" / "tracker_export.csv"
RESULTS = ROOT / "analysis" / "results"
FIGURES = ROOT / "docs" / "figures"
RESULTS.mkdir(parents=True, exist_ok=True)
FIGURES.mkdir(parents=True, exist_ok=True)

FPS = 60.0          # frames per second (checked against the exported time stamps in step 01)
DT = 1.0 / FPS      # time between frames, s
MARKERS = "ABCD"    # Tracker point masses: A = front of balloon, B = guide straw, C = rear (neck) end, D = see step 01

# ------------------------------------------------------------------------------------------
# 1. Loading the Tracker export
# ------------------------------------------------------------------------------------------

def quant_step(text: str) -> float:
    """Rounding step of a number exported in scientific notation, e.g. '-1.03E+00' -> 0.01.

    Tracker exported every value with 3 significant figures, so the resolution of a
    position depends on its size: 0.1 mm below 0.1 m, 1 mm up to 1 m, 1 cm above 1 m.
    """
    mantissa, exponent = text.strip().upper().split("E")
    decimals = len(mantissa.split(".")[1]) if "." in mantissa else 0
    return 10.0 ** (int(exponent) - decimals)


def load_tracker(path: Path = DATA_FILE) -> dict:
    """Read the 4-marker Tracker CSV.

    Returns {marker: dict(frame, t, x, y, qx, t_text)}. Frame numbers are rebuilt from the
    (rounded) exported times; t is then the exact frame time frame/FPS.
    """
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    names = [c.strip() for c in rows[0] if c.strip()]
    assert names == ["mass_A", "mass_B", "mass_C", "mass_D"], names
    out = {}
    for j, name in enumerate(MARKERS):
        frame, x, y, qx, t_text = [], [], [], [], []
        for r in rows[2:]:
            cells = r[1 + 4 * j: 4 + 4 * j]
            if len(cells) < 3 or not cells[0].strip():
                continue
            frame.append(int(round(float(cells[0]) * FPS)))
            t_text.append(cells[0].strip())
            x.append(float(cells[1]))
            y.append(float(cells[2]))
            qx.append(quant_step(cells[1]))
        frame = np.array(frame)
        out[name] = dict(frame=frame, t=frame * DT, x=np.array(x), y=np.array(y),
                         qx=np.array(qx), t_text=t_text)
    return out


def check_frame_rate(markers: dict, fps_candidates=(24, 25, 29.97, 30, 50, 59.94, 60)) -> dict:
    """Which frame rates reproduce every exported time stamp exactly (after 3-s.f. rounding)?"""
    ok = {}
    for fps in fps_candidates:
        good = True
        for d in markers.values():
            for text in d["t_text"]:
                t = float(text)
                k = round(t * fps)
                rebuilt = 0.0 if k == 0 else float("%.2E" % (k / fps))
                good &= abs(rebuilt - t) < 1e-12
        ok[fps] = bool(good)
    return ok


def on_frames(d: dict, frames: np.ndarray, key: str = "x") -> np.ndarray:
    """Values of one marker on a given list of frames (all must exist)."""
    i = np.searchsorted(d["frame"], frames)
    assert np.all(d["frame"][i] == frames), "marker missing on some frames"
    return d[key][i]

# ------------------------------------------------------------------------------------------
# 2. Measurement noise
# ------------------------------------------------------------------------------------------

def tracking_sigma(d: dict) -> tuple[float, int]:
    """Random tracking error of one marker's x, from third differences (robust estimate).

    For a smooth path sampled every DT, the third difference x[k+3]-3x[k+2]+3x[k+1]-x[k]
    is almost pure noise (the motion's own contribution, jerk*dt^3, is ~0.1 mm here and
    ~1 mm just after the onset - the median-based spread ignores such few points), and for
    independent errors of size sigma its variance is 20 sigma^2. The spread is measured
    with the median absolute deviation (x 1.4826), so that a single mis-click cannot
    inflate it. Only the part of the track where the export rounding is <= 1 mm is used,
    and the rounding variance q^2/12 is subtracted, leaving the tracking scatter alone.
    """
    x, q = d["x"], d["qx"]
    d3 = np.diff(x, 3)
    qmax = np.maximum.reduce([q[:-3], q[1:-2], q[2:-1], q[3:]])
    sel = qmax <= 1e-3
    z = d3[sel]
    mad = 1.4826 * np.median(np.abs(z - np.median(z)))
    var_round = np.mean(q[:-3][sel] ** 2) / 12.0
    return float(np.sqrt(max(mad ** 2 / 20.0 - var_round, 0.0))), int(sel.sum())


OUTLIER_SIGMA = 4.5   # a position this many standard errors from the midpoint of its neighbours is a mis-click


def find_outliers(d: dict, sig_track: float) -> list[int]:
    """Frames whose position is > OUTLIER_SIGMA standard errors from the midpoint of its two neighbours.

    For independent errors the difference x_k - (x_{k-1}+x_{k+1})/2 has standard deviation
    sqrt(s_k^2 + (s_{k-1}^2 + s_{k+1}^2)/4). The curvature of the real motion adds a*dt^2/2:
    about 0.7 mm here, 2.4 mm just after the onset - small next to the 17.5 mm of the one flagged frame.
    The worst offender is removed and the test repeated until no frame exceeds the limit.
    """
    x = d["x"].astype(float).copy()
    sg = np.sqrt(sig_track ** 2 + d["qx"] ** 2 / 12.0)
    flagged = []
    while True:
        best, kbest = 0.0, None
        for k in range(1, len(x) - 1):
            if k in flagged or (k - 1) in flagged or (k + 1) in flagged:
                continue
            dev = x[k] - 0.5 * (x[k - 1] + x[k + 1])
            z = abs(dev) / np.sqrt(sg[k] ** 2 + (sg[k - 1] ** 2 + sg[k + 1] ** 2) / 4)
            if z > best:
                best, kbest = z, k
        if kbest is None or best <= OUTLIER_SIGMA:
            return [int(d["frame"][k]) for k in flagged]
        flagged.append(kbest)


def position_sigma(d: dict, sig_track: float) -> np.ndarray:
    """Per-sample standard error: tracking scatter and rounding added in quadrature."""
    return np.sqrt(sig_track ** 2 + d["qx"] ** 2 / 12.0)

# ------------------------------------------------------------------------------------------
# 3. Derivatives with error bars
# ------------------------------------------------------------------------------------------

def local_poly(t: np.ndarray, y: np.ndarray, sig: np.ndarray, ok: np.ndarray, window: int, order: int, deriv: int):
    """Local polynomial (Savitzky-Golay-type) estimate of y or a derivative, with 1-sigma errors.

    Around each sample a polynomial of the given order is fitted by weighted least squares
    (weights 1/sigma^2) to the `window` samples centred on it, skipping excluded samples
    (ok == False). The estimate is a linear combination of the data, so its standard error
    follows exactly from (X^T W X)^-1. Only centres whose whole window lies inside the
    record are returned: no extrapolation at the ends (end effects are what produced a
    spurious 'flat' acceleration in an earlier, quick analysis). If samples inside a window
    are excluded the fit uses the rest, so it can become one-sided there.
    """
    h = window // 2
    idx, est, err = [], [], []
    fact = float(np.prod(np.arange(1, deriv + 1))) if deriv > 0 else 1.0
    for i in range(h, len(y) - h):
        j = np.arange(i - h, i + h + 1)
        j = j[ok[j]]
        if len(j) < order + 2:
            continue
        u = t[j] - t[i]
        X = np.vander(u, order + 1, increasing=True)
        W = 1.0 / sig[j] ** 2
        A = X.T @ (X * W[:, None])
        C = np.linalg.inv(A)
        coef = C @ (X.T @ (W * y[j]))
        idx.append(i)
        est.append(fact * coef[deriv])
        err.append(fact * np.sqrt(C[deriv, deriv]))
    return np.array(idx), np.array(est), np.array(err)


V_WINDOW, A_WINDOW, LP_ORDER = 9, 15, 2   # 0.15 s and 0.25 s windows, local quadratics

# ------------------------------------------------------------------------------------------
# 4. The measured quantities used everywhere
# ------------------------------------------------------------------------------------------

def measurements() -> dict:
    """Straw distance s(t) on frames 0..50 and balloon length L(t) on frames 1..50, with errors.

    s is the distance the straw (marker B) has moved since frame 0, positive in the
    direction of travel (the balloon moves towards -x in the video's axes).
    L = x_C - x_A is the balloon's length along the wire (between the leading and the
    trailing marker); it starts at frame 1 because markers C and D start there.
    ok_s / ok_L mark the samples kept; frames flagged as mis-clicks are excluded everywhere.
    """
    M = load_tracker()
    sig = {k: tracking_sigma(M[k])[0] for k in "ABC"}
    bad = {k: find_outliers(M[k], sig[k]) for k in "ABC"}
    fs = np.arange(0, 51)
    xB, qB = on_frames(M["B"], fs), on_frames(M["B"], fs, "qx")
    fL = np.arange(1, 51)
    xA, xC = on_frames(M["A"], fL), on_frames(M["C"], fL)
    qA, qC = on_frames(M["A"], fL, "qx"), on_frames(M["C"], fL, "qx")
    sA = np.sqrt(sig["A"] ** 2 + qA ** 2 / 12)
    sC = np.sqrt(sig["C"] ** 2 + qC ** 2 / 12)
    ok_s = ~np.isin(fs, bad["B"])
    ok_L = ~(np.isin(fL, bad["A"]) | np.isin(fL, bad["C"]))
    return dict(frame_s=fs, t_s=fs * DT, s=-(xB - xB[0]), sig_s=np.sqrt(sig["B"] ** 2 + qB ** 2 / 12), ok_s=ok_s,
                frame_L=fL, t_L=fL * DT, L=xC - xA, sig_L=np.sqrt(sA ** 2 + sC ** 2), ok_L=ok_L,
                sig_track=sig, outliers=bad)


# ------------------------------------------------------------------------------------------
# 5. Release time (change point)
# ------------------------------------------------------------------------------------------

def release_fit(t: np.ndarray, s: np.ndarray, sig: np.ndarray, ok: np.ndarray, t_max=0.30, step=DT / 4) -> dict:
    """Locate the onset of strong acceleration at the start of the track.

    Model: constant speed, then accelerating:
        s = s0 + v_pre t                                      for t <  t_r
        s = s0 + v_pre t + a (t-t_r)^2/2 + j (t-t_r)^3/6       for t >= t_r
    t_r is scanned on a fine grid; the rest is a linear weighted fit. The 68 % range of
    t_r is where chi2 rises by 1 x (chi2_min/dof) (scaled for the observed scatter).
    For comparison: a smooth cubic and a smooth quartic from t = 0 (the quartic has as
    many parameters as the change-point model), and a quadratic fit to the frames before
    t_r alone, which measures the acceleration there.
    """
    sel = (t <= t_max + 1e-9) & ok
    tt, ss, w = t[sel], s[sel], 1.0 / sig[sel]

    def lin(X):
        coef, *_ = np.linalg.lstsq(X * w[:, None], ss * w, rcond=None)
        return coef, float(np.sum(((X @ coef - ss) * w) ** 2))

    grid = np.arange(tt[0], 0.2 + 1e-9, step)
    prof = []
    for tr in grid:
        u = np.clip(tt - tr, 0, None)
        coef, c2 = lin(np.column_stack([np.ones_like(tt), tt, u ** 2 / 2, u ** 3 / 6]))
        prof.append((c2, float(tr), coef))
    chi2 = np.array([p[0] for p in prof])
    ib = int(np.argmin(chi2))
    dof = len(tt) - 5
    scale = max(chi2[ib] / dof, 1.0)
    inside = grid[chi2 <= chi2[ib] + scale]
    tr = grid[ib]
    u = np.clip(tt - tr, 0, None)
    X = np.column_stack([np.ones_like(tt), tt, u ** 2 / 2, u ** 3 / 6])
    cov = np.linalg.inv((X * w[:, None]).T @ (X * w[:, None])) * scale
    t0 = tt - tt[0]
    _, chi2_cubic = lin(np.column_stack([np.ones_like(tt), t0, t0 ** 2 / 2, t0 ** 3 / 6]))
    _, chi2_quartic = lin(np.column_stack([np.ones_like(tt), t0, t0 ** 2 / 2, t0 ** 3 / 6, t0 ** 4 / 24]))
    pre = (t < tr) & ok
    Xp = np.column_stack([np.ones(pre.sum()), t[pre], t[pre] ** 2 / 2])
    wp = 1.0 / sig[pre]
    cp, *_ = np.linalg.lstsq(Xp * wp[:, None], s[pre] * wp, rcond=None)
    rp = (Xp @ cp - s[pre]) * wp
    covp = np.linalg.inv((Xp * wp[:, None]).T @ (Xp * wp[:, None])) * max(np.sum(rp ** 2) / (pre.sum() - 3), 1.0)
    return dict(t_release=float(tr), t_release_68=[float(inside.min()), float(inside.max())],
                v_pre=float(prof[ib][2][1]), v_pre_err=float(np.sqrt(cov[1, 1])),
                a_after=float(prof[ib][2][2]), a_after_err=float(np.sqrt(cov[2, 2])),
                a_before=float(cp[2]), a_before_err=float(np.sqrt(covp[2, 2])),
                chi2=float(chi2[ib]), dof=dof, chi2_cubic=chi2_cubic, chi2_quartic=chi2_quartic,
                n=int(sel.sum()), grid=grid.tolist(), chi2_profile=chi2.tolist())


T_RELEASE = 0.12   # s; the change-point fit gives 0.121 s (68 % range 0.113-0.129 s), see step 02

# ------------------------------------------------------------------------------------------
# 6. Running the physics model for this clip
# ------------------------------------------------------------------------------------------

R0 = 0.02          # model's unstretched radius (placeholder; only sets where on the rubber law we are)

# Unknown 'internal' quantities, bracketed by four scenarios.
#   kP  multiplies the rubber pressure law (1 = the model's placeholder constants)
#   e   balloon length / width. The model is a sphere, so the measured length L is
#       converted to the sphere of EQUAL VOLUME: d_eq = L e^(-2/3).
SCENARIOS = {
    "S1": dict(label="Model defaults", kP=1.0, e=1.0),
    "S2": dict(label="Softer rubber (pressure x0.3)", kP=0.3, e=1.0),
    "S3": dict(label="Elongated balloon (1.3:1)", kP=1.0, e=1.3),
    "S4": dict(label="Softer and elongated", kP=0.3, e=1.3),
}


def model_params(scn: dict, **kw) -> bv3.Params:
    base = bv3.Params()
    return replace(base, C1=base.C1 * scn["kP"], C2=base.C2 * scn["kP"], **kw)


def run_model(scn: dict, L_start: float, D_nozzle: float, t_end: float, x0=0.0, v0=1.0,
              m_empty=0.005, C_D=0.47, mu_k=0.05, **kw) -> dict:
    """Simulate from the release instant. L_start is the measured-length scale at release."""
    lam0 = L_start * scn["e"] ** (-2.0 / 3.0) / (2 * R0)
    p = model_params(scn, lam0=lam0, D_nozzle=D_nozzle, m_empty=m_empty, C_D=C_D,
                     mu_k=mu_k, mu_s=1.6 * mu_k, **kw)
    r = bv3.simulate(p, t_end=t_end, n_eval=3000, x0=x0, v0=v0, rtol=1e-7, atol=1e-10)
    r["L_pred"] = 2 * R0 * r["lam"] * scn["e"] ** (2.0 / 3.0)   # back to a measured-length scale
    r["params"] = p
    return r


def predicted_length(scn, L_start, D_nozzle, t):
    r = run_model(scn, L_start, D_nozzle, t_end=t[-1] + 0.02)
    return np.interp(t, r["t"], r["L_pred"]), r


def predicted_position(scn, L_start, D_nozzle, t, m_empty, C_D, v0, x0, **kw):
    r = run_model(scn, L_start, D_nozzle, t_end=t[-1] + 0.02, x0=x0, v0=v0,
                  m_empty=m_empty, C_D=C_D, **kw)
    return np.interp(t, r["t"], r["x"]), r

# ------------------------------------------------------------------------------------------
# 7. Fitting and residual tests
# ------------------------------------------------------------------------------------------

def wls_fit(fun, x0, lower, upper, scale, names, n_data):
    """Weighted least squares. fun(params) must return residuals already divided by sigma.

    Returns best values, standard errors (scaled up by sqrt(chi2/dof) when that is > 1,
    the usual allowance for noise that is slightly larger than estimated), covariance,
    correlations, chi2 and degrees of freedom.
    """
    sol = least_squares(fun, x0, bounds=(lower, upper), x_scale=scale, diff_step=1e-4)
    J = sol.jac
    cov = np.linalg.pinv(J.T @ J)
    chi2 = float(np.sum(sol.fun ** 2))
    dof = n_data - len(x0)
    infl = max(chi2 / dof, 1.0)
    cov = cov * infl
    se = np.sqrt(np.abs(np.diag(cov)))
    den = np.outer(np.where(se > 0, se, 1), np.where(se > 0, se, 1))
    at_bound = [names[i] for i in range(len(x0))
                if np.isclose(sol.x[i], lower[i], rtol=1e-3, atol=1e-9) or np.isclose(sol.x[i], upper[i], rtol=1e-3, atol=1e-9)]
    return dict(values=dict(zip(names, map(float, sol.x))), se=dict(zip(names, map(float, se))),
                cov=cov.tolist(), corr=(cov / den).tolist(), chi2=chi2, dof=dof,
                chi2_red=chi2 / dof, residuals=sol.fun.tolist(), at_bound=at_bound, x=sol.x.tolist())


def runs_test(res) -> dict:
    """Wald-Wolfowitz runs test on residual signs: too FEW runs means a systematic pattern."""
    sg = np.sign(np.asarray(res))
    sg = sg[sg != 0]
    n1, n2 = int(np.sum(sg > 0)), int(np.sum(sg < 0))
    n = n1 + n2
    runs = int(1 + np.sum(sg[1:] != sg[:-1]))
    mu = 1 + 2 * n1 * n2 / n
    var = 2 * n1 * n2 * (2 * n1 * n2 - n) / (n ** 2 * (n - 1))
    return dict(runs=runs, expected=float(mu), z=float((runs - mu) / np.sqrt(var)))


def chi2_pvalue(chi2, dof):
    from scipy.stats import chi2 as c2
    return float(c2.sf(chi2, dof))


def save_json(name: str, obj) -> Path:
    path = RESULTS / name
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
    return path

# ------------------------------------------------------------------------------------------
# 8. Plot style (one look for every figure)
# ------------------------------------------------------------------------------------------
# Reference categorical palette, slots 1-3, light mode (validated for colour-vision
# deficiency as a set). Measurements are always blue, the model always orange.
COL = dict(data="#2a78d6", model="#eb6834", model2="#1baf7a", muted="#898781",
           ink="#0b0b0b", ink2="#52514e", grid="#e1e0d9", axis="#c3c2b7", surface="#fcfcfb")


def setup_style():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "figure.facecolor": COL["surface"], "axes.facecolor": COL["surface"],
        "savefig.facecolor": COL["surface"], "axes.edgecolor": COL["axis"],
        "axes.labelcolor": COL["ink2"], "axes.titlecolor": COL["ink"], "text.color": COL["ink"],
        "xtick.color": COL["ink2"], "ytick.color": COL["ink2"],
        "axes.grid": True, "grid.color": COL["grid"], "grid.linewidth": 0.8, "grid.linestyle": "-",
        "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 0.8,
        "lines.linewidth": 1.8, "lines.solid_capstyle": "round", "lines.solid_joinstyle": "round",
        "lines.markersize": 4.5, "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "semibold",
        "axes.titlelocation": "left", "legend.frameon": False, "legend.fontsize": 9,
        "figure.dpi": 100, "savefig.dpi": 160, "savefig.bbox": "tight",
    })
    return plt


def savefig(fig, name: str):
    path = FIGURES / name
    fig.savefig(path)
    return path

# ------------------------------------------------------------------------------------------
# 9. The two fits used by several steps
# ------------------------------------------------------------------------------------------

def fit_deflation(scn: dict, t_from: float = T_RELEASE, t_to: float = 9.9) -> dict:
    """Fit L_start and D_nozzle to the measured balloon length between t_from and t_to."""
    m = measurements()
    sel = (m["t_L"] >= t_from - 1e-9) & (m["t_L"] <= t_to + 1e-9) & m["ok_L"]
    t, y, sg = m["t_L"][sel] - t_from, m["L"][sel], m["sig_L"][sel]
    fun = lambda z: (predicted_length(scn, z[0], z[1], t)[0] - y) / sg
    f = wls_fit(fun, [0.23, 0.010], [0.10, 0.002], [0.40, 0.040], [0.01, 0.001],
                ["L_start", "D_nozzle"], len(y))
    Lfit, r = predicted_length(scn, f["values"]["L_start"], f["values"]["D_nozzle"], t)
    f.update(runs=runs_test(f["residuals"]), p_value=chi2_pvalue(f["chi2"], f["dof"]), t_from=t_from,
             rms_mm=float(1e3 * np.sqrt(np.mean((Lfit - y) ** 2))),
             gauge_pressure_Pa=[float(r["P_gauge"][0]), float(np.interp(t[-1], r["t"], r["P_gauge"]))],
             air_mass_g=[float(1e3 * r["m_air"][0]), float(1e3 * np.interp(t[-1], r["t"], r["m_air"]))],
             mass_flow_gps=float(1e3 * (r["m_air"][0] - np.interp(t[-1], r["t"], r["m_air"])) / t[-1]))
    f["arrays"] = dict(t=t, L=y, sig=sg, L_model=Lfit)
    return f


def straw_after(t_from: float = T_RELEASE, t_to: float = 9.9):
    """Straw data from the release onward, flagged frames excluded: (time since release, s, sigma)."""
    m = measurements()
    sel = (m["t_s"] >= t_from - 1e-9) & (m["t_s"] <= t_to + 1e-9) & m["ok_s"]
    return m["t_s"][sel] - t_from, m["s"][sel], m["sig_s"][sel]


MOTION_KEYS = ["m_empty", "C_D", "v0", "x0"]
_LO = dict(m_empty=5e-4, C_D=0.02, v0=0.0, x0=-0.2)
_HI = dict(m_empty=0.5, C_D=30.0, v0=3.0, x0=0.5)
_SCALE = dict(m_empty=0.005, C_D=0.2, v0=0.1, x0=0.01)


def fit_motion(scn: dict, defl: dict, t, s, sig, fixed: dict | None = None, start: dict | None = None,
               mu_k: float = 0.05) -> dict:
    """Fit the straw distance with the model; thrust comes from the deflation fit `defl`.

    Free by default: m_empty (moving mass besides the air), C_D (drag coefficient on the
    equal-volume sphere's frontal area), v0 and x0 (speed and position at release).
    """
    fixed = dict(fixed or {})
    free = [k for k in MOTION_KEYS if k not in fixed]
    z0 = dict(m_empty=0.01, C_D=1.0, v0=0.8, x0=float(s[0]))
    z0.update(start or {})
    Ls, Dn = defl["values"]["L_start"], defl["values"]["D_nozzle"]

    def full(z):
        d = dict(fixed)
        d.update(zip(free, z))
        return d

    def fun(z):
        d = full(z)
        return (predicted_position(scn, Ls, Dn, t, d["m_empty"], d["C_D"], d["v0"], d["x0"], mu_k=mu_k)[0] - s) / sig

    f = wls_fit(fun, [z0[k] for k in free], [_LO[k] for k in free], [_HI[k] for k in free],
                [_SCALE[k] for k in free], free, len(s))
    f["all"] = full(f["x"])
    f["runs"] = runs_test(f["residuals"])
    f["p_value"] = chi2_pvalue(f["chi2"], f["dof"])
    pred, r = predicted_position(scn, Ls, Dn, t, **{k: f["all"][k] for k in MOTION_KEYS}, mu_k=mu_k)
    f["rms_mm"] = float(1e3 * np.sqrt(np.mean((pred - s) ** 2)))
    f["model_run"] = r
    return f


def position_jacobian(scn, defl, t, values: dict, keys, extra: dict | None = None, rel=1e-4):
    """d s_model(t) / d parameter, by central differences (parameters may include mu_k etc.)."""
    Ls, Dn = defl["values"]["L_start"], defl["values"]["D_nozzle"]
    extra = dict(extra or {})

    def pos(vals):
        kw = {k: vals[k] for k in vals if k not in MOTION_KEYS}
        return predicted_position(scn, Ls, Dn, t, vals["m_empty"], vals["C_D"], vals["v0"], vals["x0"], **kw)[0]

    base = dict(values)
    base.update(extra)
    cols = []
    for k in keys:
        h = max(abs(base[k]) * rel, 1e-7)
        up, dn = dict(base), dict(base)
        up[k] += h
        dn[k] -= h
        cols.append((pos(up) - pos(dn)) / (2 * h))
    return np.array(cols).T
