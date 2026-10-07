"""
Checks on the physics model (model/balloon_v3.py).

Run with   pytest tests/          or simply   python tests/test_model.py

Each test checks one claim made in docs/01-physics-model.md (section 12).
"""
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
sys.path.insert(0, str(ROOT / "legacy"))
import balloon_v3 as v3  # noqa: E402

TRAPZ = np.trapezoid if hasattr(np, "trapezoid") else np.trapz
_DEFAULT = {}


def default_run():
    if "r" not in _DEFAULT:
        _DEFAULT["r"] = v3.simulate(v3.Params())
    return _DEFAULT["r"]


# ---------------------------------------------------------------- derivations (symbolic)
def test_membrane_law_from_energy_balance():
    """dP dV = V_rubber dW with Mooney-Rivlin W gives dP = 4(H0/R0)(1/l - 1/l^7)(C1 + C2 l^2)."""
    import sympy as sp
    lam, C1, C2, H0, R0 = sp.symbols("lam C1 C2 H0 R0", positive=True)
    I1 = 2 * lam ** 2 + lam ** -4
    I2 = lam ** 4 + 2 * lam ** -2
    W = C1 * (I1 - 3) + C2 * (I2 - 3)
    V = sp.Rational(4, 3) * sp.pi * (lam * R0) ** 3
    P = (4 * sp.pi * R0 ** 2 * H0) * sp.diff(W, lam) / sp.diff(V, lam)
    target = 4 * (H0 / R0) * (1 / lam - lam ** -7) * (C1 + C2 * lam ** 2)
    assert sp.simplify(P - target) == 0


def test_added_mass_force_of_shrinking_sphere():
    """Unsteady-Bernoulli pressure integrated over a moving, shrinking sphere: F = -(rho/2) d(V U)/dt."""
    import sympy as sp
    t, r, th, rho = sp.symbols("t r theta rho", positive=True)
    U = sp.Function("U")(t)
    R = sp.Function("R")(t)
    phi = -U * R ** 3 * sp.cos(th) / (2 * r ** 2) - R ** 2 * sp.diff(R, t) / r
    dphidx = sp.cos(th) * sp.diff(phi, r) - sp.sin(th) / r * sp.diff(phi, th)
    dphidt_fixed = sp.diff(phi, t) - U * dphidx          # time derivative at a fixed point in space
    grad2 = sp.diff(phi, r) ** 2 + (sp.diff(phi, th) / r) ** 2
    p = -rho * (dphidt_fixed + grad2 / 2)
    Fx = -sp.integrate((p * sp.cos(th)).subs(r, R) * 2 * sp.pi * R ** 2 * sp.sin(th), (th, 0, sp.pi))
    Vs = sp.Rational(4, 3) * sp.pi * R ** 3
    assert sp.simplify(Fx + rho / 2 * sp.diff(Vs * U, t)) == 0


def test_energy_identity():
    """Work done by the gas on the way up equals the energy stored in the rubber (45.5 J)."""
    p = v3.Params()
    tab = v3.build_tables(p)
    I1 = 2 * p.lam0 ** 2 + p.lam0 ** -4
    I2 = p.lam0 ** 4 + 2 * p.lam0 ** -2
    W = p.C1 * (I1 - 3) + p.C2 * (I2 - 3)
    Vr = 4 * np.pi * p.R0 ** 2 * p.w0
    assert abs(TRAPZ(tab["dP"], tab["V"]) - Vr * W) / (Vr * W) < 1e-4
    assert abs(Vr * W - 45.5) < 0.1


# ---------------------------------------------------------------- default run
def test_default_run_numbers():
    r = default_run()
    assert abs(r["thrust"].max() - 0.211) < 0.0005
    assert abs(r["t_burn"] - 4.81) < 0.005
    assert abs(r["v_max"] - 11.32) < 0.005
    assert abs(r["x_end"] - 39.12) < 0.01
    assert r["ended_by"] == "stopped"


def test_jet_is_subsonic():
    tab = v3.build_tables(v3.Params())
    assert not tab["choked"]
    assert (tab["Pb"] / 101325.0).max() < 1.893


def test_momentum_budget_closes():
    """Rest to rest: thrust impulse = drag + friction + forward momentum carried off by the exhaust."""
    p = v3.Params()
    r = default_run()
    tab = r["tab"]
    V = np.interp(r["m_air"], tab["m_air"], tab["V"])
    N = (p.m_empty + r["m_air"] - p.rho * V) * p.g
    I_T = TRAPZ(r["thrust"], r["t"])
    I_D = TRAPZ(r["drag"], r["t"])
    I_f = TRAPZ(p.mu_k * N * np.sign(r["v"]), r["t"])
    I_ex = TRAPZ(r["m_dot"] * r["v"], r["t"])
    assert abs(I_T - (I_D + I_f + I_ex)) < 1e-3 * I_T


def test_added_mass_impulse_is_zero():
    p = v3.Params()
    r = default_run()
    V = np.interp(r["m_air"], r["tab"]["m_air"], r["tab"]["V"])
    total = -0.5 * p.rho * (V[-1] * r["v"][-1] - V[0] * r["v"][0])     # -[1/2 rho V v] from start to end
    assert abs(total) < 1e-6
    # and the numerical integral of both added-mass terms agrees
    ma = 0.5 * p.rho * V
    I = TRAPZ(r["F_amr"], r["t"]) + TRAPZ(-ma * np.gradient(r["v"], r["t"]), r["t"])
    assert abs(I) < 2e-4


# ---------------------------------------------------------------- regressions and guards
def test_v3_reproduces_v2_with_v2_settings():
    import balloon_v2 as v2
    a = v2.simulate(v2.Params())
    b = v3.simulate(v3.Params(**v3.V2_COMPAT), t_end=8.0, n_eval=1500)
    for k in ("x", "v", "thrust"):
        assert np.max(np.abs(a[k] - b[k])) < 1e-4, k


def test_measured_curve_path_matches_analytic_law():
    p = v3.Params()
    tab = v3.build_tables(p)
    r_pv = v3.simulate(replace(p, pv_data=(tuple(tab["V"]), tuple(tab["dP"]))))
    r = default_run()
    for k in ("v_max", "x_end", "t_end"):
        assert abs(r_pv[k] - r[k]) / abs(r[k]) < 5e-4, k


def test_friction_never_drives_backwards():
    r = v3.simulate(replace(v3.Params(), theta_deg=20))
    assert r["v"].min() > -1e-9
    assert r["ended_by"] == "stopped"


def test_rejects_cd_above_cv():
    try:
        v3.build_tables(replace(v3.Params(), Cd=0.97, Cv=0.95))
    except ValueError:
        return
    raise AssertionError("Cd > Cv was accepted")


def test_numerical_convergence():
    import balloon_v3 as mod
    orig = mod.solve_ivp

    def tight(*a, **k):
        k.update(rtol=1e-10, atol=1e-12, max_step=0.002)
        return orig(*a, **k)

    mod.solve_ivp = tight
    try:
        r2 = mod.simulate(v3.Params())
    finally:
        mod.solve_ivp = orig
    r1 = default_run()
    for k in ("v_max", "x_end", "t_end", "t_burn"):
        assert abs(r1[k] - r2[k]) < 5e-4, k


def test_initial_conditions_for_mid_flight_start():
    """x0 / v0 arguments (used by the video analysis) shift the start correctly."""
    r = v3.simulate(v3.Params(), t_end=0.5, x0=0.3, v0=0.8)
    assert abs(r["x"][0] - 0.3) < 1e-12 and abs(r["v"][0] - 0.8) < 1e-12


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}: {e!r}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
