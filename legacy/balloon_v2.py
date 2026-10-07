"""
Balloon rocket on a horizontal guide wire  --  v2
State:  y = [x, v, m_air]
Model:  hyperelastic (Mooney-Rivlin) spherical membrane  ->  gas state (ideal gas)
        -> compressible subsonic nozzle (with Cd / Cv losses)  -> 1-DOF variable-mass
        equation of motion (thrust, drag, buoyancy-corrected friction, added mass).
All lookups depend only on m_air, so they are pre-tabulated once (fast RHS).
"""
from dataclasses import dataclass, replace
import numpy as np
from scipy.integrate import solve_ivp


@dataclass(frozen=True)
class Params:
    m_empty: float = 0.005
    R0: float = 0.02
    w0: float = 0.0005
    D_nozzle: float = 0.005
    lam0: float = 6.0
    k_pressure: float = 4.0
    C1: float = 7.5e4
    C2: float = 1.0e4
    P_atm: float = 101325.0
    T_amb: float = 295.0
    gamma: float = 1.4
    R_air: float = 287.05
    thermal: str = "isothermal"
    Cd: float = 0.80
    Cv: float = 0.95
    rho_air: float = 1.225
    C_D: float = 0.47
    CdA_min: float = 1.0e-3
    C_add: float = 0.5
    mu_k: float = 0.05
    mu_s: float = 0.08
    g: float = 9.81
    theta_deg: float = 0.0
    L_wire: float = np.inf
    use_buoyancy: bool = True
    use_added_mass: bool = True

    @property
    def A_e(self):
        return np.pi * (self.D_nozzle / 2) ** 2


def build_tables(p: Params, n=6000):
    lam = np.linspace(1.0, p.lam0, n)
    V = (4 / 3) * np.pi * (lam * p.R0) ** 3
    dP = p.k_pressure * (p.w0 / p.R0) * (1 / lam - lam ** -7) * (p.C1 + p.C2 * lam ** 2)
    Pb = p.P_atm + dP
    if p.thermal == "adiabatic":
        Tb = p.T_amb * (Pb / Pb[-1]) ** ((p.gamma - 1) / p.gamma)
    else:
        Tb = np.full_like(Pb, p.T_amb)
    m_air = Pb * V / (p.R_air * Tb)
    if not np.all(np.diff(m_air) > 0):
        raise ValueError("m_air(lambda) is not monotonic")
    g_, R = p.gamma, p.R_air
    p_crit = (2 / (g_ + 1)) ** (g_ / (g_ - 1))
    pr = np.clip(p.P_atm / Pb, p_crit, 1.0)
    v_e = np.sqrt(2 * g_ * R * Tb / (g_ - 1) * (1 - pr ** ((g_ - 1) / g_)))
    m_dot = p.A_e * Pb * np.sqrt(
        2 * g_ / ((g_ - 1) * R * Tb) * np.maximum(pr ** (2 / g_) - pr ** ((g_ + 1) / g_), 0.0))
    return dict(lam=lam, V=V, dP=dP, Pb=Pb, Tb=Tb, m_air=m_air,
                m_dot=p.Cd * m_dot, v_jet=p.Cv * v_e)


def simulate(p: Params = Params(), t_end=8.0, n_eval=1500):
    tab = build_tables(p)
    m_tab = tab["m_air"]
    th = np.radians(p.theta_deg)

    def state(m):
        lam = np.interp(m, m_tab, tab["lam"])
        m_dot = np.interp(m, m_tab, tab["m_dot"])
        v_jet = np.interp(m, m_tab, tab["v_jet"])
        return lam, m_dot, v_jet

    def rhs(t, y):
        x, v, m = y
        lam, m_dot, v_jet = state(m)
        thrust = m_dot * v_jet
        R = lam * p.R0
        A = np.pi * R ** 2
        V = (4 / 3) * np.pi * R ** 3
        m_disp = p.rho_air * V
        m_tot = p.m_empty + m
        W_net = max(m_tot - (m_disp if p.use_buoyancy else 0.0), 0.0) * p.g
        N = W_net * np.cos(th)
        F_grav = W_net * np.sin(th)
        F_drag = 0.5 * p.rho_air * max(p.C_D * A, p.CdA_min) * v * abs(v)
        m_eff = m_tot + (p.C_add * m_disp if p.use_added_mass else 0.0)
        F_drive = thrust - F_grav
        if v <= 0.0:
            if F_drive <= p.mu_s * N:
                return [0.0, 0.0, -m_dot]
            F_fric = p.mu_k * N
        else:
            F_fric = p.mu_k * N
        return [v, (F_drive - F_drag - F_fric) / m_eff, -m_dot]

    def stopped(t, y):
        return y[1]
    stopped.terminal, stopped.direction = True, -1
    events = [stopped]
    if np.isfinite(p.L_wire):
        def wire_end(t, y):
            return y[0] - p.L_wire
        wire_end.terminal, wire_end.direction = True, 1
        events.append(wire_end)

    y0 = [0.0, 0.0, m_tab[-1]]
    sol = solve_ivp(rhs, (0, t_end), y0, t_eval=np.linspace(0, t_end, n_eval),
                    events=events, method="RK45", rtol=1e-8, atol=1e-10, max_step=0.01)
    t, x, v, m = sol.t, sol.y[0], sol.y[1], sol.y[2]
    lam, m_dot, v_jet = state(m)
    thrust = m_dot * v_jet
    R = lam * p.R0
    F_drag = 0.5 * p.rho_air * np.maximum(p.C_D * np.pi * R ** 2, p.CdA_min) * v * np.abs(v)
    Pgauge = np.interp(m, m_tab, tab["dP"])
    out = dict(t=t, x=x, v=v, m_air=m, lam=lam, thrust=thrust, drag=F_drag,
               P_gauge=Pgauge, m_dot=m_dot, v_jet=v_jet, sol=sol, tab=tab)
    if thrust.max() > 0:
        burn_idx = np.where(thrust > 0.02 * thrust.max())[0][-1]
        out["t_burn"] = t[burn_idx]
        out["x_burn"] = x[burn_idx]
    out["v_max"] = v.max()
    out["x_end"] = x[-1]
    out["t_end"] = t[-1]
    trapz = np.trapezoid if hasattr(np, "trapezoid") else np.trapz
    out["impulse"] = trapz(thrust, t)
    return out


if __name__ == "__main__":
    P = Params()
    r = simulate(P)
    print(f"peak thrust      : {r['thrust'].max():.3f} N")
    print(f"burn time        : {r.get('t_burn', float('nan')):.2f} s")
    print(f"peak velocity    : {r['v_max']:.2f} m/s")
    print(f"distance at burn : {r.get('x_burn', float('nan')):.2f} m")
    print(f"total distance   : {r['x_end']:.2f} m  (stopped at t = {r['t_end']:.2f} s)")
    print("event times:", r["sol"].t_events, "status", r["sol"].status)
