"""
Balloon rocket on a guide wire  --  v3
=====================================
Derivation of every equation: docs/01-physics-model.md.  Checks: tests/test_model.py.
simulate() also accepts x0 / v0 (start mid-flight), used by the video analysis in analysis/.

State:  y = [x, v, m_air]

Chain:  membrane law (Mooney-Rivlin thin sphere, OR a measured deflation P-V curve)
        -> gas state (ideal gas, isothermal or adiabatic)
        -> quasi-steady subsonic isentropic nozzle with Cd / Cv losses
        -> 1-DOF variable-mass equation of motion:
             m_eff dv/dt = T cos(a) - D - F_fric - W_net sin(theta) + F_am_rate
           m_eff     = m_rubber+straw + m_air + C_add * rho * V         (added mass)
           F_am_rate = -C_add * rho * v * dV/dt                         (added-mass recovery)
           W_net     = (m_rubber+straw + m_air - rho * V) g             (buoyancy)
           F_fric    = mu_k * N,  N = hypot(W_net cos(theta), T sin(a)), opposes motion

Changes vs v2 (each can be switched off; with the v2 settings listed in
`V2_COMPAT` the v2 numbers are reproduced exactly):
  1. Ambient air density is derived from P_atm and T_amb (ideal gas) instead of
     a separate hard-coded 1.225 kg/m^3 that contradicted T_amb = 295 K.
  2. Added mass enters as -d(m_a v)/dt, not only -m_a dv/dt. For a sphere of
     changing volume in ideal flow the exact force is  F = -(1/2) rho d(V v)/dt,
     so a shrinking balloon gets an extra forward push  -(1/2) rho v dV/dt
     ("added-mass recovery"; Weymouth & Triantafyllou, J. Fluid Mech. 2013).
  3. Friction always opposes the direction of motion (v2 kept it pointing
     backwards even when v < 0, and froze v at a negative value).
  4. Optional jet misalignment angle: the sideways thrust component loads the
     straw against the wire and adds friction proportional to thrust.
  5. Optional measured deflation P-V curve (pv_data) replaces the Mooney-Rivlin law.
     This single change captures latex hysteresis, strain stiffening, and a
     non-spherical balloon shape at once, which no two-constant law can.
  6. Default t_end is long enough for the balloon to actually stop, so
     "total distance" is the real final distance.
  7. Sanity checks: Cd <= Cv (contraction coefficient Cc = Cd/Cv must be <= 1).

Checked and deliberately NOT modelled (all < ~0.5 % of the force budget here):
  - membrane radial inertia / Rayleigh-Plesset pressure (~1e-3 Pa vs ~6 kPa)
  - internal pressure gradient from acceleration (rho a D ~ 3 Pa)
  - jet exiting into the wake's base pressure (~20 Pa vs ~6 kPa)
  - choked flow (P_b/P_atm <= 1.07, choking needs 1.89)
"""
from dataclasses import dataclass, replace
from typing import Optional, Tuple
import numpy as np
from scipy.integrate import solve_ivp


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Params:
    # --- mass & geometry ---
    m_empty: float = 0.005      # balloon rubber + tape + guide straw (kg)
    R0: float = 0.02            # uninflated (reference) radius (m)
    w0: float = 0.0005          # uninflated wall thickness (m)
    D_nozzle: float = 0.005     # air-exit diameter (m)  (balloon neck or exit straw, NOT the guide straw)
    lam0: float = 6.0           # initial stretch ratio (fully inflated)

    # --- membrane: W = C1 (I1-3) + C2 (I2-3)  ->  dP = 4 (w0/R0) (1/lam - 1/lam^7)(C1 + C2 lam^2)
    # (k = 4 verified symbolically from the energy balance P dV = V_rubber dW.)
    # C1, C2 are PLACEHOLDERS. Mooney-Rivlin fits latex only to lam ~ 3-4 and has no
    # hysteresis, so for accuracy prefer a measured deflation curve in pv_data.
    k_pressure: float = 4.0
    C1: float = 7.5e4
    C2: float = 1.0e4
    # Measured DEFLATION curve: (V [m^3], gauge dP [Pa]) with V increasing. Overrides
    # the Mooney-Rivlin law when given. Drag/added-mass then use the equal-volume sphere.
    pv_data: Optional[Tuple[Tuple[float, ...], Tuple[float, ...]]] = None

    # --- gas ---
    P_atm: float = 101325.0     # set to the site's pressure (about -1.2 kPa per 100 m altitude)
    T_amb: float = 295.0
    gamma: float = 1.4
    R_air: float = 287.05
    thermal: str = "isothermal"  # "isothermal" or "adiabatic" (bounding cases; effect < 1 %)
    rho_air: Optional[float] = None  # None -> P_atm / (R_air T_amb). Set a number only to override.

    # --- nozzle losses (calibrate with a static-thrust test) ---
    # thrust = Cd*Cv * ideal; mass flow = Cd * ideal; Cc = Cd/Cv must be <= 1.
    # For an exit STRAW of length L: Cv ~ 1/sqrt(1 + K_entry + f L/D), f ~ 0.3164 Re^-0.25.
    Cd: float = 0.80
    Cv: float = 0.95

    # --- environment & mechanics ---
    C_D: float = 0.47           # sphere, subcritical Re (Re here <= ~1.6e5)
    CdA_min: float = 1.0e-3     # floor on drag area (limp balloon + tape + straw). PLACEHOLDER
    C_add: float = 0.5          # added-mass coefficient (sphere; ~0.2 for a 2:1 elongated balloon)
    mu_k: float = 0.05          # EFFECTIVE straw-on-wire kinetic friction (calibrate!)
    mu_s: float = 0.08          # static friction
    g: float = 9.81
    theta_deg: float = 0.0      # wire inclination (+ = rising in direction of travel)
    misalign_deg: float = 0.0   # angle between jet axis and wire (neck droop / taping error)
    L_wire: float = np.inf      # usable wire length (m); integration stops there

    # --- physics switches (ablation / debugging) ---
    use_buoyancy: bool = True
    use_added_mass: bool = True
    use_added_mass_rate: bool = True   # the -C_add rho v dV/dt term (needs use_added_mass)
    friction_opposes_motion: bool = True  # False = v2 behaviour

    @property
    def A_e(self):
        return np.pi * (self.D_nozzle / 2) ** 2

    @property
    def rho(self):
        return self.rho_air if self.rho_air is not None else self.P_atm / (self.R_air * self.T_amb)


# v2's effective settings (for regression testing)
V2_COMPAT = dict(rho_air=1.225, use_added_mass_rate=False, friction_opposes_motion=False)


# --------------------------------------------------------------------------
# Pre-computed tables (everything is a function of m_air)
# --------------------------------------------------------------------------
def build_tables(p: Params, n=6000):
    if not (0 < p.Cd <= p.Cv <= 1.0):
        raise ValueError("need 0 < Cd <= Cv <= 1 (contraction coefficient Cc = Cd/Cv <= 1)")

    if p.pv_data is None:
        lam = np.linspace(1.0, p.lam0, n)                  # lam = 1 -> dP = 0 -> flow stops
        R = lam * p.R0
        V = (4 / 3) * np.pi * R ** 3
        dP = p.k_pressure * (p.w0 / p.R0) * (1 / lam - lam ** -7) * (p.C1 + p.C2 * lam ** 2)
    else:
        Vd, dPd = (np.asarray(a, float) for a in p.pv_data)
        if np.any(np.diff(Vd) <= 0):
            raise ValueError("pv_data volumes must be strictly increasing")
        V = np.linspace(Vd[0], Vd[-1], n)
        dP = np.interp(V, Vd, dPd)
        R = (3 * V / (4 * np.pi)) ** (1 / 3)               # equal-volume sphere
        lam = R / R[0]

    Pb = p.P_atm + dP
    if p.thermal == "adiabatic":
        # gas left in the balloon expands isentropically from T_amb at full inflation
        Tb = p.T_amb * (Pb / Pb[-1]) ** ((p.gamma - 1) / p.gamma)
    elif p.thermal == "isothermal":
        Tb = np.full_like(Pb, p.T_amb)
    else:
        raise ValueError("thermal must be 'isothermal' or 'adiabatic'")
    m_air = Pb * V / (p.R_air * Tb)
    if not np.all(np.diff(m_air) > 0):
        raise ValueError("m_air is not monotonic in volume -> lookup is ambiguous. Check membrane data.")

    # quasi-steady isentropic nozzle expanding to ambient (subsonic: exit pressure = P_atm)
    g_, Rg = p.gamma, p.R_air
    p_crit = (2 / (g_ + 1)) ** (g_ / (g_ - 1))
    pr = np.clip(p.P_atm / Pb, p_crit, 1.0)
    v_e = np.sqrt(2 * g_ * Rg * Tb / (g_ - 1) * (1 - pr ** ((g_ - 1) / g_)))
    m_dot = p.A_e * Pb * np.sqrt(
        2 * g_ / ((g_ - 1) * Rg * Tb) * np.maximum(pr ** (2 / g_) - pr ** ((g_ + 1) / g_), 0.0))
    dVdm = np.gradient(V, m_air)
    return dict(lam=lam, R=R, V=V, dP=dP, Pb=Pb, Tb=Tb, m_air=m_air, dVdm=dVdm,
                m_dot=p.Cd * m_dot, v_jet=p.Cv * v_e, choked=bool(np.any(p.P_atm / Pb < p_crit)))


# --------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------
def simulate(p: Params = Params(), t_end=60.0, n_eval=6000, table_n=6000, x0=0.0, v0=0.0, rtol=1e-8, atol=1e-10):
    tab = build_tables(p, n=table_n)
    m_tab = tab["m_air"]
    th = np.radians(p.theta_deg)
    al = np.radians(p.misalign_deg)
    rho = p.rho

    def state(m):
        f = lambda k: np.interp(m, m_tab, tab[k])
        return f("R"), f("V"), f("m_dot"), f("v_jet"), f("dVdm")

    def forces(v, m):
        R, V, m_dot, v_jet, dVdm = state(m)
        T = m_dot * v_jet
        A = np.pi * R ** 2
        m_disp = rho * V
        m_tot = p.m_empty + m
        W_net = np.maximum(m_tot - (m_disp if p.use_buoyancy else 0.0), 0.0) * p.g
        N = np.hypot(W_net * np.cos(th), T * np.sin(al))
        F_grav = W_net * np.sin(th)
        F_drag = 0.5 * rho * np.maximum(p.C_D * A, p.CdA_min) * v * np.abs(v)
        m_a = p.C_add * m_disp if p.use_added_mass else 0.0
        dVdt = -dVdm * m_dot
        F_amr = -p.C_add * rho * v * dVdt if (p.use_added_mass and p.use_added_mass_rate) else 0.0
        return dict(T=T, T_axial=T * np.cos(al), N=N, F_grav=F_grav, F_drag=F_drag, F_amr=F_amr,
                    m_eff=m_tot + m_a, m_dot=m_dot, v_jet=v_jet, R=R)

    def rhs(t, y):
        x, v, m = y
        F = forces(v, m)
        F_drive = F["T_axial"] - F["F_grav"] + F["F_amr"]
        if p.friction_opposes_motion:
            if v == 0.0:
                if abs(F_drive) <= p.mu_s * F["N"]:       # stiction holds
                    return [0.0, 0.0, -F["m_dot"]]
                F_fric = np.sign(F_drive) * p.mu_k * F["N"]
            else:
                F_fric = np.sign(v) * p.mu_k * F["N"]
        else:                                            # v2 logic, kept for regression only
            if v <= 0.0 and F_drive <= p.mu_s * F["N"]:
                return [0.0, 0.0, -F["m_dot"]]
            F_fric = p.mu_k * F["N"]
        return [v, (F_drive - F["F_drag"] - F_fric) / F["m_eff"], -F["m_dot"]]

    def stopped(t, y):
        return y[1]
    stopped.terminal, stopped.direction = True, -1
    events = [stopped]
    if np.isfinite(p.L_wire):
        def wire_end(t, y):
            return y[0] - p.L_wire
        wire_end.terminal, wire_end.direction = True, 1
        events.append(wire_end)

    y0 = [x0, v0, m_tab[-1]]
    sol = solve_ivp(rhs, (0, t_end), y0, t_eval=np.linspace(0, t_end, n_eval), dense_output=True,
                    events=events, method="RK45", rtol=rtol, atol=atol, max_step=0.01)
    # append the exact event point so end-of-run values are not grid-limited
    t = sol.t
    if sol.status == 1:
        te = [e[0] for e in sol.t_events if len(e)][0]
        t = np.append(t[t < te], te)
    Y = sol.sol(t)
    x, v, m = Y
    F = forces(v, m)
    Pgauge = np.interp(m, m_tab, tab["dP"])
    lam = np.interp(m, m_tab, tab["lam"])
    trapz = np.trapezoid if hasattr(np, "trapezoid") else np.trapz
    out = dict(t=t, x=x, v=v, m_air=m, lam=lam, thrust=F["T"], drag=F["F_drag"], F_amr=F["F_amr"],
               P_gauge=Pgauge, m_dot=F["m_dot"], v_jet=F["v_jet"], sol=sol, tab=tab,
               ended_by=("stopped" if sol.status == 1 and len(sol.t_events[0]) else
                         "wire end" if sol.status == 1 else "t_end reached (still moving!)"))
    if F["T"].max() > 0:
        burn_idx = np.where(F["T"] > 0.02 * F["T"].max())[0][-1]
        out["t_burn"], out["x_burn"] = t[burn_idx], x[burn_idx]
    out["v_max"] = v.max()
    out["x_end"], out["t_end"], out["v_end"] = x[-1], t[-1], v[-1]
    out["impulse_thrust"] = trapz(F["T"], t)
    out["impulse_drag"] = trapz(F["F_drag"], t)
    out["impulse_am_rate"] = trapz(np.broadcast_to(F["F_amr"], t.shape), t)
    return out


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------
def plot(res, p: Params, show=True, savepath=None):
    import matplotlib.pyplot as plt
    t = res["t"]
    fig, ax = plt.subplots(2, 3, figsize=(16, 8))
    ax = ax.ravel()
    ax[0].plot(t, res["x"], "b", lw=2);            ax[0].set(title="Position x(t)", ylabel="m")
    ax[1].plot(t, res["v"], "r", lw=2);            ax[1].set(title="Velocity v(t)", ylabel="m/s")
    ax[2].plot(t, res["thrust"], "m", lw=2, label="thrust")
    ax[2].plot(t, res["drag"], "k--", label="drag")
    ax[2].set(title="Forces", ylabel="N"); ax[2].legend()
    ax[3].plot(t, res["lam"], "g", lw=2);          ax[3].set(title=r"Stretch ratio $\lambda(t)$", xlabel="Time (s)")
    ax[4].plot(t, res["P_gauge"] / 1e3, "c", lw=2); ax[4].set(title="Gauge pressure", ylabel="kPa", xlabel="Time (s)")
    ax[5].plot(t, res["m_air"] * 1e3, "orange", lw=2); ax[5].set(title="Air mass in balloon", ylabel="g", xlabel="Time (s)")
    for a in ax:
        a.grid(True)
    plt.tight_layout()
    if savepath:
        plt.savefig(savepath, dpi=120)
    if show:
        plt.show()


def summary(r):
    return (f"peak thrust {r['thrust'].max():.3f} N | burn {r.get('t_burn', np.nan):.2f} s | "
            f"v_max {r['v_max']:.2f} m/s | x at burnout {r.get('x_burn', np.nan):.2f} m | "
            f"x_end {r['x_end']:.2f} m at t={r['t_end']:.2f} s ({r['ended_by']})")


if __name__ == "__main__":
    P = Params()
    r = simulate(P)
    print(summary(r))
    plot(r, P)
