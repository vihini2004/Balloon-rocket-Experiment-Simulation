/* Balloon rocket engine: a line-by-line port of balloon_v3.py plus the Gent
   membrane law, measured deflation curves, calibration, Monte Carlo and
   sensitivity tools. Pure functions, no DOM: runs in the page, in a Web
   Worker and in Node (for verification against the Python reference). */
(function (root, factory) {
  var E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.BalloonEngine = E;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PI = Math.PI;

  function EngineError(code, message) {
    var e = new Error(message);
    e.code = code;
    e.isEngineError = true;
    return e;
  }

  /* ---------------------------------------------------------------- */
  /* Parameters (SI). Defaults are balloon_v3.py's Params().           */
  /* ---------------------------------------------------------------- */
  var DEFAULTS = {
    m_empty: 0.005, R0: 0.02, w0: 0.0005, D_nozzle: 0.005, lam0: 6.0,
    membrane: 'mr', C1: 7.5e4, C2: 1.0e4, mu: 2.6e5, Jm: 100, pv: null, V0: null,
    P_atm: 101325, T_amb: 295, gamma: 1.4, R_air: 287.05, thermal: 'isothermal', rho_air: null,
    Cd: 0.80, Cv: 0.95, C_D: 0.47, CdA_min: 1.0e-3, C_add: 0.5,
    mu_k: 0.05, mu_s: 0.08, g: 9.81, theta_deg: 0, misalign_deg: 0, L_wire: Infinity,
    use_buoyancy: true, use_added_mass: true, use_added_mass_rate: true,
    t_end: 60, rtol: 1e-8, atol: 1e-10, max_step: 0.01, table_n: 6000
  };

  function withDefaults(p) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    for (k in p) if (p[k] !== undefined) out[k] = p[k];
    return out;
  }

  function rhoAmb(p) {
    return (p.rho_air !== null && p.rho_air !== undefined) ? p.rho_air : p.P_atm / (p.R_air * p.T_amb);
  }

  /* Dynamic viscosity of air, Sutherland's law. */
  function muAir(T) {
    return 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4);
  }

  /* ---------------------------------------------------------------- */
  /* Membrane laws                                                    */
  /* ---------------------------------------------------------------- */
  function membranePressure(p, lam) {
    var g = 1 / lam - Math.pow(lam, -7);
    if (p.membrane === 'gent') {
      var I1m3 = 2 * lam * lam + Math.pow(lam, -4) - 3;
      var den = 1 - I1m3 / p.Jm;
      return den > 0 ? 2 * p.mu * (p.w0 / p.R0) * g / den : NaN;
    }
    return 4 * (p.w0 / p.R0) * g * (p.C1 + p.C2 * lam * lam);
  }

  function interp1(x, xp, fp) {
    var n = xp.length;
    if (x <= xp[0]) return fp[0];
    if (x >= xp[n - 1]) return fp[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xp[mid] <= x) lo = mid; else hi = mid;
    }
    var w = (x - xp[lo]) / (xp[hi] - xp[lo]);
    return fp[lo] + w * (fp[hi] - fp[lo]);
  }

  /* numpy.gradient(f, x) with edge_order=1 on a non-uniform grid */
  function gradient(f, x) {
    var n = f.length, out = new Float64Array(n);
    out[0] = (f[1] - f[0]) / (x[1] - x[0]);
    out[n - 1] = (f[n - 1] - f[n - 2]) / (x[n - 1] - x[n - 2]);
    for (var i = 1; i < n - 1; i++) {
      var d1 = x[i] - x[i - 1], d2 = x[i + 1] - x[i];
      var a = -d2 / (d1 * (d1 + d2)), b = (d2 - d1) / (d1 * d2), c = d1 / (d2 * (d1 + d2));
      out[i] = a * f[i - 1] + b * f[i] + c * f[i + 1];
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Lookup tables: everything depends only on the air mass m          */
  /* ---------------------------------------------------------------- */
  function buildTables(p, n) {
    n = n || p.table_n || 6000;
    if (!(p.Cd > 0 && p.Cv > 0 && p.Cd <= p.Cv && p.Cv <= 1)) {
      throw EngineError('nozzle', 'The nozzle loss coefficients need 0 < C_d ≤ C_v ≤ 1 (the contraction coefficient C_d/C_v cannot exceed 1).');
    }
    var lam = new Float64Array(n), R = new Float64Array(n), V = new Float64Array(n), dP = new Float64Array(n);
    var i;
    if (p.membrane === 'measured') {
      if (!p.pv || !p.pv.V || p.pv.V.length < 2) throw EngineError('pv', 'The measured pressure curve needs at least two points.');
      var Vd = p.pv.V, Pd = p.pv.dP;
      var Vlo = Vd[0];
      var Vtop = Vd[Vd.length - 1];
      var Vhi = (p.V0 !== null && p.V0 !== undefined) ? Math.min(p.V0, Vtop) : Vtop;
      if (!(Vhi > Vlo)) throw EngineError('pv', 'The inflated volume must be larger than the smallest volume in the pressure curve.');
      for (i = 0; i < n; i++) {
        V[i] = Vlo + (Vhi - Vlo) * i / (n - 1);
        dP[i] = interp1(V[i], Vd, Pd);
        R[i] = Math.cbrt(3 * V[i] / (4 * PI));
      }
      for (i = 0; i < n; i++) lam[i] = R[i] / R[0];
    } else {
      if (!(p.lam0 > 1)) throw EngineError('size', 'The inflated balloon must be larger than the unstretched balloon (stretch ratio above 1).');
      var step = (p.lam0 - 1) / (n - 1);
      for (i = 0; i < n; i++) {
        lam[i] = i === n - 1 ? p.lam0 : 1 + step * i;
        R[i] = lam[i] * p.R0;
        V[i] = (4 / 3) * PI * R[i] * R[i] * R[i];
        dP[i] = membranePressure(p, lam[i]);
      }
    }
    for (i = 0; i < n; i++) {
      if (!isFinite(dP[i])) {
        throw EngineError('gent', 'The Gent law breaks down: the stretch reaches the locking limit (I₁ − 3 ≥ J_m). Increase J_m or reduce the inflation.');
      }
    }
    var Pb = new Float64Array(n), Tb = new Float64Array(n), m = new Float64Array(n);
    var g_ = p.gamma, Rg = p.R_air;
    for (i = 0; i < n; i++) Pb[i] = p.P_atm + dP[i];
    for (i = 0; i < n; i++) {
      Tb[i] = p.thermal === 'adiabatic' ? p.T_amb * Math.pow(Pb[i] / Pb[n - 1], (g_ - 1) / g_) : p.T_amb;
      m[i] = Pb[i] * V[i] / (Rg * Tb[i]);
    }
    for (i = 0; i < n - 1; i++) {
      if (!(m[i + 1] > m[i])) throw EngineError('monotonic', 'The air mass does not rise steadily with balloon size, so the model cannot recover the size from the mass. Check the pressure curve.');
    }
    var Ae = PI * (p.D_nozzle / 2) * (p.D_nozzle / 2);
    var pcrit = Math.pow(2 / (g_ + 1), g_ / (g_ - 1));
    var mdot = new Float64Array(n), vjet = new Float64Array(n), veIdeal = new Float64Array(n);
    var choked = false;
    for (i = 0; i < n; i++) {
      var prRaw = p.P_atm / Pb[i];
      if (prRaw < pcrit) choked = true;
      var pr = Math.min(Math.max(prRaw, pcrit), 1.0);
      var ve = Math.sqrt(2 * g_ * Rg * Tb[i] / (g_ - 1) * (1 - Math.pow(pr, (g_ - 1) / g_)));
      var md = Ae * Pb[i] * Math.sqrt(Math.max(2 * g_ / ((g_ - 1) * Rg * Tb[i]) * (Math.pow(pr, 2 / g_) - Math.pow(pr, (g_ + 1) / g_)), 0));
      veIdeal[i] = ve;
      mdot[i] = p.Cd * md;
      vjet[i] = p.Cv * ve;
    }
    var dVdm = gradient(V, m);
    return { n: n, lam: lam, R: R, V: V, dP: dP, Pb: Pb, Tb: Tb, m: m, mdot: mdot, vjet: vjet,
             veIdeal: veIdeal, dVdm: dVdm, Ae: Ae, choked: choked, pcrit: pcrit };
  }

  /* ---------------------------------------------------------------- */
  /* Forces and right-hand side                                       */
  /* ---------------------------------------------------------------- */
  function makeModel(p, tab) {
    var th = p.theta_deg * PI / 180, al = p.misalign_deg * PI / 180;
    var cth = Math.cos(th), sth = Math.sin(th), cal = Math.cos(al), sal = Math.sin(al);
    var rho = rhoAmb(p);
    var mT = tab.m, n = tab.n, hint = n - 2;
    var F = { T: 0, Tax: 0, N: 0, Fg: 0, Fd: 0, Famr: 0, meff: 0, mdot: 0, vjet: 0, R: 0, V: 0, Wnet: 0, ma: 0, dVdm: 0, M: 0 };

    function locate(m) {
      if (m <= mT[0]) { hint = 0; return -1; }
      if (m >= mT[n - 1]) { hint = n - 2; return -2; }
      var j = hint;
      if (j < 0) j = 0; if (j > n - 2) j = n - 2;
      if (mT[j] <= m && m < mT[j + 1]) return j;
      if (m < mT[j] && j > 0 && mT[j - 1] <= m) { hint = j - 1; return j - 1; }
      if (m >= mT[j + 1] && j + 2 < n && m < mT[j + 2]) { hint = j + 1; return j + 1; }
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (mT[mid] <= m) lo = mid; else hi = mid; }
      hint = lo;
      return lo;
    }

    function lookup(arr, j, m) {
      if (j === -1) return arr[0];
      if (j === -2) return arr[n - 1];
      var w = (m - mT[j]) / (mT[j + 1] - mT[j]);
      return arr[j] + w * (arr[j + 1] - arr[j]);
    }

    function forces(v, m) {
      var j = locate(m);
      var R = lookup(tab.R, j, m), V = lookup(tab.V, j, m), mdot = lookup(tab.mdot, j, m);
      var vjet = lookup(tab.vjet, j, m), dVdm = lookup(tab.dVdm, j, m);
      var T = mdot * vjet;
      var A = PI * R * R;
      var mdisp = rho * V;
      var M = p.m_empty + m;
      var Wnet = Math.max(M - (p.use_buoyancy ? mdisp : 0), 0) * p.g;
      var Wn = Wnet * cth, Ts = T * sal;
      F.T = T; F.Tax = T * cal;
      F.N = Math.sqrt(Wn * Wn + Ts * Ts);
      F.Fg = Wnet * sth;
      F.Fd = 0.5 * rho * Math.max(p.C_D * A, p.CdA_min) * v * Math.abs(v);
      F.ma = p.use_added_mass ? p.C_add * mdisp : 0;
      var dVdt = -dVdm * mdot;
      F.Famr = (p.use_added_mass && p.use_added_mass_rate) ? -p.C_add * rho * v * dVdt : 0;
      F.meff = M + F.ma;
      F.mdot = mdot; F.vjet = vjet; F.R = R; F.V = V; F.Wnet = Wnet; F.dVdm = dVdm; F.M = M;
      return F;
    }

    function friction(v, Fdrive, N) {
      if (v === 0) {
        if (Math.abs(Fdrive) <= p.mu_s * N) return { held: true, Ff: Fdrive };
        return { held: false, Ff: (Fdrive > 0 ? 1 : -1) * p.mu_k * N };
      }
      return { held: false, Ff: (v > 0 ? 1 : -1) * p.mu_k * N };
    }

    function rhs(t, y, out) {
      var v = y[1], m = y[2];
      var f = forces(v, m);
      var Fdrive = f.Tax - f.Fg + f.Famr;
      var fr = friction(v, Fdrive, f.N);
      if (fr.held) { out[0] = 0; out[1] = 0; out[2] = -f.mdot; return; }
      out[0] = v;
      out[1] = (Fdrive - f.Fd - fr.Ff) / f.meff;
      out[2] = -f.mdot;
    }

    return { rhs: rhs, forces: forces, friction: friction, rho: rho, cal: cal, sth: sth };
  }

  /* ---------------------------------------------------------------- */
  /* Dormand-Prince 5(4), the same scheme and step control as SciPy RK45 */
  /* ---------------------------------------------------------------- */
  var DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1];
  var DP_A = [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656]
  ];
  var DP_B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84];
  var DP_E = [-71 / 57600, 0, 71 / 16695, -71 / 1920, 17253 / 339200, -22 / 525, 1 / 40];

  function rmsNorm(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / a.length);
  }

  function hermite(t0, y0, f0, t1, y1, f1, t, k) {
    var h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
    var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return h00 * y0[k] + h10 * h * f0[k] + h01 * y1[k] + h11 * h * f1[k];
  }

  function rootHermite(t0, y0, f0, t1, y1, f1, k, target) {
    var a = t0, b = t1;
    var ga = hermite(t0, y0, f0, t1, y1, f1, a, k) - target;
    for (var it = 0; it < 80; it++) {
      var c = 0.5 * (a + b);
      var gc = hermite(t0, y0, f0, t1, y1, f1, c, k) - target;
      if ((gc > 0) === (ga > 0) && gc !== 0) { a = c; ga = gc; } else { b = c; }
      if (b - a < 1e-13) break;
    }
    return 0.5 * (a + b);
  }

  function integrate(p, model, tab, opts) {
    var rtol = opts.rtol, atol = opts.atol, hmax = opts.max_step, tEnd = opts.t_end;
    var L = p.L_wire;
    var rhs = model.rhs;
    var y = [0, 0, tab.m[tab.n - 1]];
    var t = 0;
    var f = [0, 0, 0];
    rhs(t, y, f);
    var nfev = 1;
    var T = [0], Y0 = [y[0]], Y1 = [y[1]], Y2 = [y[2]], F0 = [f[0]], F1 = [f[1]], F2 = [f[2]];

    // initial step, SciPy select_initial_step
    var scale = [atol + Math.abs(y[0]) * rtol, atol + Math.abs(y[1]) * rtol, atol + Math.abs(y[2]) * rtol];
    var d0 = rmsNorm([y[0] / scale[0], y[1] / scale[1], y[2] / scale[2]]);
    var d1 = rmsNorm([f[0] / scale[0], f[1] / scale[1], f[2] / scale[2]]);
    var h0 = (d0 < 1e-5 || d1 < 1e-5) ? 1e-6 : 0.01 * d0 / d1;
    h0 = Math.min(h0, tEnd);
    var y1 = [y[0] + h0 * f[0], y[1] + h0 * f[1], y[2] + h0 * f[2]];
    var f1 = [0, 0, 0];
    rhs(h0, y1, f1); nfev++;
    var d2 = rmsNorm([(f1[0] - f[0]) / scale[0], (f1[1] - f[1]) / scale[1], (f1[2] - f[2]) / scale[2]]) / h0;
    var h1 = (d1 <= 1e-15 && d2 <= 1e-15) ? Math.max(1e-6, h0 * 1e-3) : Math.pow(0.01 / Math.max(d1, d2), 1 / 5);
    var hAbs = Math.min(100 * h0, h1, tEnd, hmax);

    var K = [f.slice(), [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var ys = [0, 0, 0], yNew = [0, 0, 0], err = [0, 0, 0];
    var endedBy = 'time', steps = 0, rejects = 0, maxSteps = opts.maxSteps || 400000;
    var stepRejected = false;

    while (t < tEnd) {
      if (steps + rejects > maxSteps) { endedBy = 'steplimit'; break; }
      if (hAbs > hmax) hAbs = hmax;
      var minStep = 10 * Math.abs(t) * 2.220446049250313e-16 + 1e-300;
      if (hAbs < minStep) hAbs = minStep;
      var accepted = false;
      stepRejected = false;
      var h, tNew;
      while (!accepted) {
        h = hAbs; tNew = t + h;
        if (tNew > tEnd) { tNew = tEnd; h = tNew - t; hAbs = h; }
        K[0][0] = f[0]; K[0][1] = f[1]; K[0][2] = f[2];
        for (var s = 1; s < 6; s++) {
          var a = DP_A[s];
          for (var c = 0; c < 3; c++) {
            var acc = 0;
            for (var j = 0; j < s; j++) acc += a[j] * K[j][c];
            ys[c] = y[c] + h * acc;
          }
          rhs(t + DP_C[s] * h, ys, K[s]); nfev++;
        }
        for (c = 0; c < 3; c++) {
          var accB = 0;
          for (j = 0; j < 6; j++) accB += DP_B[j] * K[j][c];
          yNew[c] = y[c] + h * accB;
        }
        rhs(tNew, yNew, K[6]); nfev++;
        for (c = 0; c < 3; c++) {
          var accE = 0;
          for (j = 0; j < 7; j++) accE += DP_E[j] * K[j][c];
          err[c] = h * accE / (atol + Math.max(Math.abs(y[c]), Math.abs(yNew[c])) * rtol);
        }
        var errNorm = rmsNorm(err);
        if (errNorm < 1) {
          var factor = errNorm === 0 ? 10 : Math.min(10, 0.9 * Math.pow(errNorm, -0.2));
          if (stepRejected) factor = Math.min(1, factor);
          hAbs *= factor;
          accepted = true;
        } else {
          hAbs *= Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2));
          stepRejected = true;
          rejects++;
          if (hAbs < 1e-14) { endedBy = 'steplimit'; break; }
        }
      }
      if (!accepted) break;
      var fNew = [K[6][0], K[6][1], K[6][2]];
      var yN = [yNew[0], yNew[1], yNew[2]];

      // events: stopped (v falls through zero), wire end (x reaches L)
      var ev = null, te;
      if (y[1] > 0 && yN[1] <= 0) {
        te = rootHermite(t, y, f, tNew, yN, fNew, 1, 0);
        ev = { kind: 'stopped', t: te };
      }
      if (isFinite(L) && y[0] < L && yN[0] >= L) {
        te = rootHermite(t, y, f, tNew, yN, fNew, 0, L);
        if (!ev || te < ev.t) ev = { kind: 'wire', t: te };
      }
      if (ev) {
        var ye = [hermite(t, y, f, tNew, yN, fNew, ev.t, 0), hermite(t, y, f, tNew, yN, fNew, ev.t, 1), hermite(t, y, f, tNew, yN, fNew, ev.t, 2)];
        if (ev.kind === 'stopped') ye[1] = 0;
        if (ev.kind === 'wire') ye[0] = L;
        var fe = [0, 0, 0];
        rhs(ev.t, ye, fe); nfev++;
        T.push(ev.t); Y0.push(ye[0]); Y1.push(ye[1]); Y2.push(ye[2]); F0.push(fe[0]); F1.push(fe[1]); F2.push(fe[2]);
        endedBy = ev.kind;
        steps++;
        break;
      }
      t = tNew; y = yN; f = fNew; steps++;
      T.push(t); Y0.push(y[0]); Y1.push(y[1]); Y2.push(y[2]); F0.push(f[0]); F1.push(f[1]); F2.push(f[2]);
      // a balloon held by static friction with the flow finished will never move again
      if (y[1] === 0 && f[1] === 0 && f[2] === 0 && f[0] === 0) { endedBy = y[0] > 0 ? 'stopped' : 'never_moved'; break; }
    }
    return { t: T, x: Y0, v: Y1, m: Y2, fx: F0, fv: F1, fm: F2, endedBy: endedBy, steps: steps, rejects: rejects, nfev: nfev };
  }

  /* Evaluate the state at time t from the recorded steps (cubic Hermite). */
  function makeSampler(raw) {
    var T = raw.t, n = T.length, idx = 0;
    var Ys = [raw.x, raw.v, raw.m], Fs = [raw.fx, raw.fv, raw.fm];
    return function (t) {
      if (t <= T[0]) return [Ys[0][0], Ys[1][0], Ys[2][0]];
      if (t >= T[n - 1]) return [Ys[0][n - 1], Ys[1][n - 1], Ys[2][n - 1]];
      if (!(T[idx] <= t && t <= T[idx + 1])) {
        if (t > T[idx]) { while (idx < n - 2 && T[idx + 1] < t) idx++; }
        else {
          var lo = 0, hi = n - 1;
          while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
          idx = lo;
        }
      }
      var t0 = T[idx], t1 = T[idx + 1], h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
      var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      var out = [0, 0, 0];
      for (var k = 0; k < 3; k++) out[k] = h00 * Ys[k][idx] + h10 * h * Fs[k][idx] + h01 * Ys[k][idx + 1] + h11 * h * Fs[k][idx + 1];
      return out;
    };
  }

  function trapz(y, x) {
    var s = 0;
    for (var i = 1; i < x.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
    return s;
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                       */
  /* ---------------------------------------------------------------- */
  function simulate(pIn, opts) {
    opts = opts || {};
    var t0clock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var p = withDefaults(pIn);
    var tab = buildTables(p, opts.table_n || p.table_n);
    var model = makeModel(p, tab);
    var raw = integrate(p, model, tab, {
      rtol: opts.rtol || p.rtol, atol: opts.atol || p.atol, max_step: opts.max_step || p.max_step,
      t_end: opts.t_end || p.t_end, maxSteps: opts.maxSteps
    });
    var tRun = raw.t[raw.t.length - 1];
    var res = { p: p, tab: tab, raw: raw, endedBy: raw.endedBy, steps: raw.steps, rejects: raw.rejects, nfev: raw.nfev };
    var sampler = makeSampler(raw);
    res.stateAt = sampler;
    res.xAt = function (t) { return sampler(t)[0]; };

    if (opts.lite) {
      res.summary = liteSummary(res);
      res.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0clock;
      return res;
    }

    // uniform grid, like balloon_v3's t_eval, plus the exact end point
    var dt = opts.dt_out || 0.01;
    var nG = Math.floor(tRun / dt + 1e-9) + 1;
    var tg = [];
    for (var k = 0; k < nG; k++) tg.push(k * dt);
    if (tRun - tg[tg.length - 1] > 1e-9) tg.push(tRun);
    var G = { t: tg, x: [], v: [], a: [], m: [], R: [], lam: [], dP: [], T: [], Tax: [], D: [], Ff: [], Fg: [], Famr: [],
              vjet: [], mdot: [], N: [], meff: [], M: [], ma: [], V: [] };
    var fvec = [0, 0, 0];
    for (k = 0; k < tg.length; k++) {
      var st = sampler(tg[k]);
      var x = st[0], v = st[1], mm = st[2];
      if (k === tg.length - 1 && raw.endedBy === 'stopped') v = 0;
      var f = model.forces(v, mm);
      var Fdrive = f.Tax - f.Fg + f.Famr;
      var fr = model.friction(v, Fdrive, f.N);
      model.rhs(tg[k], [x, v, mm], fvec);
      G.x.push(x); G.v.push(v); G.m.push(mm); G.a.push(fvec[1]);
      G.R.push(f.R); G.V.push(f.V); G.lam.push(interpTab(tab, 'lam', mm)); G.dP.push(interpTab(tab, 'dP', mm));
      G.T.push(f.T); G.Tax.push(f.Tax); G.D.push(f.Fd); G.Ff.push(fr.Ff); G.Fg.push(f.Fg); G.Famr.push(f.Famr);
      G.vjet.push(f.vjet); G.mdot.push(f.mdot); G.N.push(f.N); G.meff.push(f.meff); G.M.push(f.M); G.ma.push(f.ma);
    }
    res.grid = G;
    res.summary = fullSummary(res);
    res.budget = momentumBudget(res);
    res.diag = diagnostics(res);
    res.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0clock;
    return res;
  }

  function interpTab(tab, key, m) { return interp1(m, tab.m, tab[key]); }

  function liteSummary(res) {
    var raw = res.raw, n = raw.t.length, vmax = 0, tvmax = 0;
    for (var i = 0; i < n; i++) if (raw.v[i] > vmax) { vmax = raw.v[i]; tvmax = raw.t[i]; }
    return { x_end: raw.x[n - 1], t_end: raw.t[n - 1], v_end: raw.v[n - 1], v_max: vmax, t_vmax: tvmax, endedBy: raw.endedBy };
  }

  function fullSummary(res) {
    var G = res.grid, n = G.t.length, i;
    var Tmax = 0;
    for (i = 0; i < n; i++) if (G.T[i] > Tmax) Tmax = G.T[i];
    var ib = 0;
    for (i = 0; i < n; i++) if (G.T[i] > 0.02 * Tmax) ib = i;
    var iv = 0;
    for (i = 0; i < n; i++) if (G.v[i] > G.v[iv]) iv = i;
    var s = {
      T_peak: Tmax, t_burn: G.t[ib], x_burn: G.x[ib], v_max: G.v[iv], t_vmax: G.t[iv], lam_vmax: G.lam[iv],
      x_end: G.x[n - 1], t_end: G.t[n - 1], v_end: G.v[n - 1], endedBy: res.endedBy,
      a0: G.a[0], m0: res.tab.m[res.tab.n - 1], mMin: res.tab.m[0], lam0: res.tab.lam[res.tab.n - 1],
      V0: res.tab.V[res.tab.n - 1], dP0: res.tab.dP[res.tab.n - 1],
      burnComplete: G.T[n - 1] <= 0.02 * Tmax
    };
    // time to reach 5 m, and the whole run's distance marks
    s.t_5m = timeToReach(res, 5);
    return s;
  }

  function timeToReach(res, X) {
    var raw = res.raw, n = raw.t.length;
    if (raw.x[n - 1] < X) return null;
    for (var i = 1; i < n; i++) {
      if (raw.x[i] >= X) return rootHermite(raw.t[i - 1], [raw.x[i - 1], raw.v[i - 1], raw.m[i - 1]], [raw.fx[i - 1], raw.fv[i - 1], raw.fm[i - 1]],
        raw.t[i], [raw.x[i], raw.v[i], raw.m[i]], [raw.fx[i], raw.fv[i], raw.fm[i]], 0, X);
    }
    return null;
  }

  /* Where the thrust impulse goes (derived in the physics guide, section 11.2):
     int T cos(a) dt = int D + int F_f + int W sin(th) + int mdot v + (M + m_a) v_end
     (+ added-mass momentum lost when the recovery term is switched off). */
  function momentumBudget(res) {
    var G = res.grid, p = res.p, n = G.t.length, i;
    var t = G.t;
    var thrust = trapz(G.Tax, t), drag = trapz(G.D, t), fric = trapz(G.Ff, t), grav = trapz(G.Fg, t);
    var exh = [], amLost = [];
    var rho = rhoAmb(p);
    for (i = 0; i < n; i++) {
      exh.push(G.mdot[i] * G.v[i]);
      var dVdm = interp1(G.m[i], res.tab.m, res.tab.dVdm);
      amLost.push((p.use_added_mass && !p.use_added_mass_rate) ? p.C_add * rho * G.v[i] * dVdm * G.mdot[i] : 0);
    }
    var exhaust = trapz(exh, t), lost = trapz(amLost, t);
    var fin = (G.M[n - 1] + G.ma[n - 1]) * G.v[n - 1];
    var accounted = drag + fric + grav + exhaust + fin + lost;
    return { thrust: thrust, drag: drag, friction: fric, gravity: grav, exhaust: exhaust, final: fin, amLost: lost,
             amr: trapz(G.Famr, t), residual: thrust - accounted, relResidual: thrust > 0 ? (thrust - accounted) / thrust : 0 };
  }

  function diagnostics(res) {
    var p = res.p, tab = res.tab, G = res.grid, n = tab.n, i;
    var PbMax = 0, dPmax = 0;
    for (i = 0; i < n; i++) { if (tab.Pb[i] > PbMax) PbMax = tab.Pb[i]; if (tab.dP[i] > dPmax) dPmax = tab.dP[i]; }
    var ratio = PbMax / p.P_atm, g_ = p.gamma;
    var Me = Math.sqrt(Math.max(2 / (g_ - 1) * (Math.pow(ratio, (g_ - 1) / g_) - 1), 0));
    var mu = muAir(p.T_amb), rho = rhoAmb(p), ReMax = 0, ReBurnMin = Infinity;
    var sm = res.summary;
    for (i = 0; i < G.t.length; i++) {
      var Re = rho * Math.abs(G.v[i]) * 2 * G.R[i] / mu;
      if (Re > ReMax) ReMax = Re;
      if (G.t[i] > 0.5 && G.t[i] < sm.t_burn && Re < ReBurnMin) ReBurnMin = Re;
    }
    var lam0 = tab.lam[n - 1];
    var I1m3 = 2 * lam0 * lam0 + Math.pow(lam0, -4) - 3;
    // static start check at release
    var model = makeModel(p, tab);
    var f0 = model.forces(0, tab.m[n - 1]);
    var drive0 = f0.Tax - f0.Fg + f0.Famr;
    var transit = 0.03 / Math.max(tab.vjet[n - 1], 1e-9);
    return {
      PbRatioMax: ratio, dPmax: dPmax, MeMax: Me, choked: tab.choked, pcritRatio: 1 / tab.pcrit,
      ReMax: ReMax, ReBurnMin: isFinite(ReBurnMin) ? ReBurnMin : null, muAir: mu, rho: rho,
      lam0: lam0, I1m3: I1m3, gentFraction: p.membrane === 'gent' ? I1m3 / p.Jm : null,
      thinWall: p.w0 / p.R0,
      T0: f0.T, drive0: drive0, staticLimit: p.mu_s * f0.N, startsMoving: drive0 > p.mu_s * f0.N,
      Wnet0: f0.Wnet, N0: f0.N, meff0: f0.meff, M0: f0.M, ma0: f0.ma,
      transitTime: transit
    };
  }

  /* ---------------------------------------------------------------- */
  /* Conversions from the measurement form (display units) to SI      */
  /* ---------------------------------------------------------------- */
  var PRESSURE_UNITS = { kPa: 1000, Pa: 1, cmH2O: 98.0665, mmHg: 133.322387415, inH2O: 249.08891 };

  function parseRows(text, minCols) {
    var rows = [];
    if (!text) return rows;
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var parts;
      if (/[;\t]/.test(line)) parts = line.split(/[;\t]+/).map(function (s) { return s.trim().replace(',', '.'); });
      else parts = line.split(/[\s,]+/);
      var nums = [];
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] === '') continue;
        var v = Number(parts[j]);
        if (!isFinite(v)) { nums = null; break; }
        nums.push(v);
      }
      if (nums && nums.length >= (minCols || 2)) rows.push(nums);
    }
    return rows;
  }

  function sizeToVolume(val, unit) {
    if (unit === 'volume_L') return val / 1000;
    var d = unit === 'circumference_cm' ? val / PI / 100 : val / 100;
    return PI * d * d * d / 6;
  }

  function parsePV(text, sizeUnit, pUnit, R0) {
    var rows = parseRows(text, 2), pts = [], i;
    var pf = PRESSURE_UNITS[pUnit] || 1000;
    for (i = 0; i < rows.length; i++) pts.push({ V: sizeToVolume(rows[i][0], sizeUnit), dP: rows[i][1] * pf });
    pts.sort(function (a, b) { return a.V - b.V; });
    var V = [], dP = [], notes = [];
    for (i = 0; i < pts.length; i++) {
      if (!(pts[i].V > 0) || !(pts[i].dP >= 0)) continue;
      if (V.length && pts[i].V - V[V.length - 1] <= 1e-12) { dP[dP.length - 1] = 0.5 * (dP[dP.length - 1] + pts[i].dP); continue; }
      V.push(pts[i].V); dP.push(pts[i].dP);
    }
    var Vrest = (4 / 3) * PI * R0 * R0 * R0;
    var raw = { V: V.slice(), dP: dP.slice() };
    if (V.length && dP[0] > 1) {
      if (Vrest < V[0] * 0.999) { V.unshift(Vrest); dP.unshift(0); notes.push('added'); }
      else notes.push('norest');
    }
    return { V: V, dP: dP, raw: raw, nRows: rows.length, notes: notes, Vrest: Vrest };
  }

  function parseRun(text, tUnit, xUnit, fps) {
    var rows = parseRows(text, 2), t = [], x = [];
    var tf = tUnit === 'ms' ? 1e-3 : (tUnit === 'frames' ? 1 / (fps || 30) : 1);
    var xf = xUnit === 'cm' ? 0.01 : (xUnit === 'mm' ? 0.001 : 1);
    rows.sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < rows.length; i++) { t.push(rows[i][0] * tf); x.push(rows[i][1] * xf); }
    return { t: t, x: x };
  }

  /* Form values (display units) -> SI parameters, with problems listed. */
  function fromInputs(inp) {
    var errors = [], warnings = [];
    function num(key, label, opt) {
      var v = inp[key];
      if (v === '' || v === null || v === undefined || !isFinite(Number(v))) {
        if (opt && opt.allowBlank) return null;
        errors.push({ key: key, msg: label + ' needs a number.' });
        return NaN;
      }
      v = Number(v);
      if (opt && opt.min !== undefined && !(v > opt.min || (opt.inclusive && v >= opt.min))) {
        errors.push({ key: key, msg: label + ' must be ' + (opt.inclusive ? 'at least ' : 'above ') + opt.min + '.' });
      }
      if (opt && opt.max !== undefined && !(v <= opt.max)) errors.push({ key: key, msg: label + ' must be at most ' + opt.max + '.' });
      return v;
    }
    var p = {};
    p.m_empty = num('mass_g', 'Empty mass', { min: 0 }) / 1000;
    var d0 = num('d0_mm', 'Unstretched diameter', { min: 0 });
    p.R0 = d0 / 2000;
    p.w0 = num('wall_mm', 'Wall thickness', { min: 0 }) / 1000;
    var infl = num('infl_cm', 'Inflated size', { min: 0 });
    var dInfl = inp.infl_mode === 'circumference' ? infl / PI : infl; // cm
    var Rinfl = dInfl / 200;
    p.membrane = inp.membrane || 'mr';
    p.lam0 = Rinfl / p.R0;
    p.C1 = num('C1_kPa', 'C₁', {}) * 1000;
    p.C2 = num('C2_kPa', 'C₂', {}) * 1000;
    p.mu = num('mu_kPa', 'Shear modulus μ', { min: 0 }) * 1000;
    p.Jm = num('Jm', 'J_m', { min: 0 });
    p.D_nozzle = num('nozzle_mm', 'Exit diameter', { min: 0 }) / 1000;
    p.Cd = num('Cd', 'C_d', { min: 0, max: 1 });
    p.Cv = num('Cv', 'C_v', { min: 0, max: 1 });
    p.T_amb = num('T_C', 'Room temperature', { min: -60, max: 60, inclusive: true }) + 273.15;
    p.P_atm = num('P_kPa', 'Air pressure', { min: 30, max: 120, inclusive: true }) * 1000;
    p.thermal = inp.thermal === 'adiabatic' ? 'adiabatic' : 'isothermal';
    p.C_D = num('C_D', 'Drag coefficient', { min: 0 });
    p.CdA_min = num('CdA_cm2', 'Minimum drag area', { min: 0, inclusive: true }) * 1e-4;
    p.C_add = num('C_add', 'Added-mass coefficient', { min: 0, inclusive: true });
    p.use_added_mass = p.C_add > 0;
    p.use_added_mass_rate = inp.recovery !== false;
    p.use_buoyancy = inp.buoyancy !== false;
    p.mu_k = num('mu_k', 'Kinetic friction', { min: 0, inclusive: true });
    p.mu_s = num('mu_s', 'Static friction', { min: 0, inclusive: true });
    if (p.mu_s < p.mu_k) warnings.push({ key: 'mu_s', msg: 'Static friction is usually at least the kinetic value.' });
    p.theta_deg = num('slope_deg', 'Wire slope', { min: -45, max: 45, inclusive: true });
    p.misalign_deg = num('misalign_deg', 'Jet angle', { min: -45, max: 45, inclusive: true });
    var Lw = num('wire_m', 'Wire length', { min: 0, allowBlank: true });
    p.L_wire = Lw === null ? Infinity : Lw;
    p.t_end = num('t_end', 'Time limit', { min: 0, max: 600 });
    var acc = inp.accuracy === 'high' ? 'high' : 'standard';
    p.rtol = acc === 'high' ? 1e-10 : 1e-8;
    p.atol = acc === 'high' ? 1e-12 : 1e-10;
    p.max_step = acc === 'high' ? 0.002 : 0.01;
    p.table_n = acc === 'high' ? 12000 : 6000;
    p.Rinfl = Rinfl;
    p.V0 = (4 / 3) * PI * Rinfl * Rinfl * Rinfl;
    if (p.membrane === 'measured') {
      var pv = parsePV(inp.pv_text, inp.pv_size_unit, inp.pv_p_unit, p.R0);
      p.pvInfo = pv;
      if (pv.V.length < 3) errors.push({ key: 'pv_text', msg: 'Enter at least three rows of size and pressure for the measured curve.' });
      else {
        if (pv.notes.indexOf('norest') >= 0) errors.push({ key: 'pv_text', msg: 'The curve needs a zero-pressure point: the smallest measured size is not above the unstretched size.' });
        p.pv = { V: pv.V, dP: pv.dP };
        var Vtop = pv.V[pv.V.length - 1];
        if (p.V0 > Vtop * 1.0005) warnings.push({ key: 'infl_cm', msg: 'The inflated size is larger than the largest measured point, so the run starts at the top of the measured curve.' });
        if (p.V0 <= pv.V[0]) errors.push({ key: 'infl_cm', msg: 'The inflated size is smaller than the measured curve covers.' });
      }
    } else if (!(p.lam0 > 1)) {
      errors.push({ key: 'infl_cm', msg: 'The inflated size must be larger than the unstretched size.' });
    }
    if (p.Cd > p.Cv) errors.push({ key: 'Cd', msg: 'C_d cannot exceed C_v: that would need a jet wider than the hole.' });
    return { p: p, errors: errors, warnings: warnings };
  }

  /* ---------------------------------------------------------------- */
  /* Optimisation: Nelder-Mead                                        */
  /* ---------------------------------------------------------------- */
  function nelderMead(fn, x0, opts) {
    opts = opts || {};
    var n = x0.length, maxIter = opts.maxIter || 200 * n, ftol = opts.ftol || 1e-10, xtol = opts.xtol || 1e-7;
    var step = opts.step || x0.map(function () { return 0.1; });
    var simplex = [x0.slice()], i, j, evals = 0;
    function f(x) { evals++; var v = fn(x); return isFinite(v) ? v : 1e300; }
    for (i = 0; i < n; i++) { var xi = x0.slice(); xi[i] += step[i]; simplex.push(xi); }
    var fv = simplex.map(f);
    var iter = 0;
    while (iter < maxIter) {
      iter++;
      var order = fv.map(function (v, k) { return k; }).sort(function (a, b) { return fv[a] - fv[b]; });
      simplex = order.map(function (k) { return simplex[k]; });
      fv = order.map(function (k) { return fv[k]; });
      var fspread = Math.abs(fv[n] - fv[0]), xspread = 0;
      for (i = 1; i <= n; i++) for (j = 0; j < n; j++) xspread = Math.max(xspread, Math.abs(simplex[i][j] - simplex[0][j]));
      if (fspread <= ftol * (Math.abs(fv[0]) + 1e-30) && xspread <= xtol) break;
      if (opts.onIter) opts.onIter(iter, fv[0]);
      var c = new Array(n).fill(0);
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      var xr = c.map(function (cj, k) { return cj + (cj - simplex[n][k]); });
      var fr = f(xr);
      if (fr < fv[0]) {
        var xe = c.map(function (cj, k) { return cj + 2 * (cj - simplex[n][k]); });
        var fe = f(xe);
        if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
      } else if (fr < fv[n - 1]) {
        simplex[n] = xr; fv[n] = fr;
      } else {
        var outside = fr < fv[n];
        var xc = outside ? c.map(function (cj, k) { return cj + 0.5 * (xr[k] - cj); }) : c.map(function (cj, k) { return cj + 0.5 * (simplex[n][k] - cj); });
        var fc = f(xc);
        if (fc < (outside ? fr : fv[n])) { simplex[n] = xc; fv[n] = fc; }
        else {
          for (i = 1; i <= n; i++) {
            simplex[i] = simplex[i].map(function (v, k) { return simplex[0][k] + 0.5 * (v - simplex[0][k]); });
            fv[i] = f(simplex[i]);
          }
        }
      }
    }
    var best = 0;
    for (i = 1; i <= n; i++) if (fv[i] < fv[best]) best = i;
    return { x: simplex[best], f: fv[best], iterations: iter, evals: evals, converged: iter < maxIter };
  }

  function invert(A) {
    var n = A.length, M = A.map(function (r, i) { return r.concat(A.map(function (_, j) { return i === j ? 1 : 0; })); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-300) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      var d = M[c][c];
      for (var k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (r = 0; r < n; r++) if (r !== c) {
        var fct = M[r][c];
        if (fct !== 0) for (k = 0; k < 2 * n; k++) M[r][k] -= fct * M[c][k];
      }
    }
    return M.map(function (r) { return r.slice(n); });
  }

  /* ---------------------------------------------------------------- */
  /* Calibration to a measured run x(t)                               */
  /* ---------------------------------------------------------------- */
  var FIT_SPECS = {
    C_D: { label: 'Drag coefficient C_D', lo: 0.02, hi: 5, kind: 'log' },
    mu_k: { label: 'Kinetic friction μ_k', lo: 1e-5, hi: 3, kind: 'log' },
    CdA_min: { label: 'Minimum drag area', lo: 1e-6, hi: 0.1, kind: 'log' },
    Cv: { label: 'Velocity coefficient C_v', kind: 'cv' },
    Cd: { label: 'Discharge coefficient C_d', kind: 'cd' },
    t0: { label: 'Release time offset t₀', kind: 'lin' }
  };

  function logit(u) { return Math.log(u / (1 - u)); }
  function expit(z) { return 1 / (1 + Math.exp(-z)); }

  function calibrate(pBase, data, keys, opts) {
    opts = opts || {};
    var base = withDefaults(pBase);
    var both = keys.indexOf('Cv') >= 0 && keys.indexOf('Cd') >= 0;
    var tMax = 0;
    for (var i = 0; i < data.t.length; i++) tMax = Math.max(tMax, data.t[i]);
    var ssx = 0, meanx = 0;
    for (i = 0; i < data.x.length; i++) meanx += data.x[i] / data.x.length;
    for (i = 0; i < data.x.length; i++) ssx += (data.x[i] - meanx) * (data.x[i] - meanx);

    function toNatural(z) {
      var q = { t0: 0 }, cv = base.Cv, cd = base.Cd;
      keys.forEach(function (k, idx) {
        var s = FIT_SPECS[k], zi = z[idx];
        if (s.kind === 'log') q[k] = Math.exp(zi);
        else if (s.kind === 'lin') q[k] = zi;
      });
      if (both) {
        cv = expit(z[keys.indexOf('Cv')]);
        cd = cv * expit(z[keys.indexOf('Cd')]);
      } else if (keys.indexOf('Cv') >= 0) {
        cv = cd + (1 - cd) * expit(z[keys.indexOf('Cv')]);
      } else if (keys.indexOf('Cd') >= 0) {
        cd = cv * expit(z[keys.indexOf('Cd')]);
      }
      if (keys.indexOf('Cv') >= 0) q.Cv = cv;
      if (keys.indexOf('Cd') >= 0) q.Cd = cd;
      return q;
    }
    function toZ(q) {
      return keys.map(function (k) {
        var s = FIT_SPECS[k];
        if (s.kind === 'log') return Math.log(Math.max(q[k], 1e-12));
        if (s.kind === 'lin') return q[k];
        if (k === 'Cv') {
          if (both) return logit(Math.min(Math.max(q.Cv, 1e-4), 1 - 1e-4));
          return logit(Math.min(Math.max((q.Cv - base.Cd) / (1 - base.Cd), 1e-4), 1 - 1e-4));
        }
        if (k === 'Cd') return logit(Math.min(Math.max(q.Cd / (both ? q.Cv : base.Cv), 1e-4), 1 - 1e-4));
        return 0;
      });
    }
    function applyQ(q) {
      var pp = {}, k;
      for (k in base) pp[k] = base[k];
      keys.forEach(function (key) { if (key !== 't0') pp[key] = q[key]; });
      if (pp.mu_s < pp.mu_k) pp.mu_s = pp.mu_k;
      return pp;
    }
    function residuals(q, accurate) {
      var pp = applyQ(q), t0 = q.t0 || 0;
      var r;
      try {
        r = simulate(pp, { lite: true, t_end: Math.max(tMax - t0 + 0.25, 0.5),
          rtol: accurate ? 1e-9 : 1e-7, atol: accurate ? 1e-11 : 1e-9, table_n: accurate ? 6000 : 2500 });
      } catch (e) { return null; }
      var out = [];
      for (var i = 0; i < data.t.length; i++) {
        var ts = data.t[i] - t0;
        var xs = ts <= 0 ? 0 : r.xAt(ts);
        out.push(xs - data.x[i]);
      }
      return out;
    }
    function ssr(res) { var s = 0; for (var i = 0; i < res.length; i++) s += res[i] * res[i]; return s; }

    var q0 = { t0: 0 };
    keys.forEach(function (k) { if (k !== 't0') q0[k] = base[k]; });
    var z0 = toZ(q0);
    var before = residuals(q0, false);
    var ssr0 = before ? ssr(before) : Infinity;
    var evals = 0;
    var nm = nelderMead(function (z) {
      evals++;
      if (opts.onProgress && evals % 5 === 0) opts.onProgress(evals);
      var res = residuals(toNatural(z), false);
      return res ? ssr(res) : Infinity;
    }, z0, { step: keys.map(function (k) { return k === 't0' ? 0.05 : 0.25; }), maxIter: opts.maxIter || 150 * keys.length, ftol: 1e-9, xtol: 1e-6 });
    var qBest = toNatural(nm.x);
    var resBest = residuals(qBest, true);
    var n = data.t.length, kk = keys.length;
    var S = ssr(resBest), dof = Math.max(n - kk, 1), s2 = S / dof;
    // Jacobian of residuals with respect to the natural parameters (central differences)
    var J = [];
    for (i = 0; i < n; i++) J.push(new Array(kk).fill(0));
    var jacOK = true;
    keys.forEach(function (k, c) {
      var v = qBest[k], hstep = k === 't0' ? 1e-3 : Math.max(Math.abs(v) * 1e-3, 1e-7);
      var qp = {}, qm = {}, key;
      for (key in qBest) { qp[key] = qBest[key]; qm[key] = qBest[key]; }
      qp[k] = v + hstep; qm[k] = v - hstep;
      if ((k === 'Cd' && qp.Cd > (qp.Cv || base.Cv)) || (k === 'Cv' && qp.Cv > 1)) { qp[k] = v; }
      if ((k === 'Cv' && qm.Cv < (qm.Cd || base.Cd))) { qm[k] = v; }
      var rp = residuals(qp, true), rm = residuals(qm, true);
      if (!rp || !rm) { jacOK = false; return; }
      var denom = qp[k] - qm[k];
      for (var r = 0; r < n; r++) J[r][c] = (rp[r] - rm[r]) / denom;
    });
    var cov = null, se = null, corr = null;
    if (jacOK && n > kk) {
      var JtJ = [];
      for (var a = 0; a < kk; a++) { JtJ.push([]); for (var b = 0; b < kk; b++) { var sab = 0; for (var r = 0; r < n; r++) sab += J[r][a] * J[r][b]; JtJ[a].push(sab); } }
      var inv = invert(JtJ);
      if (inv) {
        cov = inv.map(function (row) { return row.map(function (v) { return v * s2; }); });
        se = cov.map(function (row, idx) { return Math.sqrt(Math.max(row[idx], 0)); });
        corr = cov.map(function (row, a2) { return row.map(function (v, b2) { return v / (se[a2] * se[b2] || 1); }); });
      }
    }
    return {
      keys: keys, values: qBest, se: se, corr: corr, ssr: S, ssr0: ssr0, rmse: Math.sqrt(S / n), rmse0: Math.sqrt(ssr0 / n),
      r2: ssx > 0 ? 1 - S / ssx : null, n: n, evals: nm.evals, converged: nm.converged,
      residuals: { t: data.t.slice(), r: resBest }, before: before
    };
  }

  /* ---------------------------------------------------------------- */
  /* Fits to a measured deflation curve                              */
  /* ---------------------------------------------------------------- */
  function pvPointsLam(pv, R0) {
    var pts = [];
    for (var i = 0; i < pv.V.length; i++) {
      var R = Math.cbrt(3 * pv.V[i] / (4 * PI));
      pts.push({ lam: R / R0, dP: pv.dP[i] });
    }
    return pts.filter(function (q) { return q.lam > 1.0005; });
  }

  function fitMR(pv, R0, w0) {
    var pts = pvPointsLam(pv, R0);
    if (pts.length < 3) return null;
    var Saa = 0, Sab = 0, Sbb = 0, Say = 0, Sby = 0, mean = 0, ss = 0;
    pts.forEach(function (q) {
      var a = 4 * (w0 / R0) * (1 / q.lam - Math.pow(q.lam, -7)), b = a * q.lam * q.lam;
      Saa += a * a; Sab += a * b; Sbb += b * b; Say += a * q.dP; Sby += b * q.dP; mean += q.dP / pts.length;
    });
    var det = Saa * Sbb - Sab * Sab;
    if (Math.abs(det) < 1e-300) return null;
    var C1 = (Say * Sbb - Sby * Sab) / det, C2 = (Saa * Sby - Sab * Say) / det, S = 0;
    pts.forEach(function (q) {
      var a = 4 * (w0 / R0) * (1 / q.lam - Math.pow(q.lam, -7));
      var r = q.dP - (C1 * a + C2 * a * q.lam * q.lam);
      S += r * r; ss += (q.dP - mean) * (q.dP - mean);
    });
    return { C1: C1, C2: C2, rmse: Math.sqrt(S / pts.length), r2: ss > 0 ? 1 - S / ss : null, n: pts.length };
  }

  function fitGent(pv, R0, w0, init) {
    var pts = pvPointsLam(pv, R0);
    if (pts.length < 3) return null;
    var lamMax = 0;
    pts.forEach(function (q) { lamMax = Math.max(lamMax, q.lam); });
    var I1max = 2 * lamMax * lamMax + Math.pow(lamMax, -4) - 3;
    function model(mu, Jm, lam) {
      var den = 1 - (2 * lam * lam + Math.pow(lam, -4) - 3) / Jm;
      return 2 * mu * (w0 / R0) * (1 / lam - Math.pow(lam, -7)) / den;
    }
    function unpack(z) { return { mu: Math.exp(z[0]), Jm: I1max + Math.exp(z[1]) }; }
    var mu0 = (init && init.mu) || 2e5, Jm0 = Math.max((init && init.Jm) || 100, I1max * 1.2);
    var nm = nelderMead(function (z) {
      var q = unpack(z), S = 0;
      for (var i = 0; i < pts.length; i++) { var r = pts[i].dP - model(q.mu, q.Jm, pts[i].lam); S += r * r; }
      return S;
    }, [Math.log(mu0), Math.log(Jm0 - I1max)], { step: [0.3, 0.5], maxIter: 2000, ftol: 1e-12, xtol: 1e-9 });
    var q = unpack(nm.x), S = 0, mean = 0, ss = 0;
    pts.forEach(function (pt) { mean += pt.dP / pts.length; });
    pts.forEach(function (pt) { var r = pt.dP - model(q.mu, q.Jm, pt.lam); S += r * r; ss += (pt.dP - mean) * (pt.dP - mean); });
    return { mu: q.mu, Jm: q.Jm, rmse: Math.sqrt(S / pts.length), r2: ss > 0 ? 1 - S / ss : null, n: pts.length, I1max: I1max };
  }

  /* ---------------------------------------------------------------- */
  /* Monte Carlo uncertainty (independent Gaussian inputs)            */
  /* ---------------------------------------------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gaussFactory(rand) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0, v = 0;
      while (u === 0) u = rand();
      v = rand();
      var mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * PI * v);
      return mag * Math.cos(2 * PI * v);
    };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* unc: [{key, sd, rel}] on form keys (display units). */
  function monteCarlo(inputs, unc, N, seed, opts) {
    opts = opts || {};
    var rand = mulberry32(seed >>> 0), gauss = gaussFactory(rand);
    var nominal = fromInputs(inputs);
    if (nominal.errors.length) throw EngineError('inputs', nominal.errors[0].msg);
    var nomRun = simulate(nominal.p, { lite: true });
    var active = unc.filter(function (u) { return u.sd > 0; });
    var tHorizon = Math.min(Math.max(nomRun.summary.t_end * 1.6, 1), nominal.p.t_end);
    var G = opts.gridN || 240, tg = [];
    for (var k = 0; k < G; k++) tg.push(tHorizon * k / (G - 1));
    var X = [], Vv = [], outs = { x_end: [], v_max: [], t_end: [], t_burn: [] }, samples = [], failures = 0;
    for (var s = 0; s < N; s++) {
      var draw = {}, key;
      for (key in inputs) draw[key] = inputs[key];
      var sampled = {};
      active.forEach(function (u) {
        var base = Number(inputs[u.key]);
        var sd = u.rel ? Math.abs(base) * u.sd : u.sd, val = base, tries = 0;
        do { val = base + sd * gauss(); tries++; } while (u.positive && val <= 0 && tries < 50);
        if (u.positive && val <= 0) val = base;
        if (u.max !== undefined && val > u.max) val = u.max;
        draw[u.key] = val; sampled[u.key] = val;
      });
      if (Number(draw.Cd) > Number(draw.Cv)) { draw.Cd = draw.Cv; sampled.Cd = draw.Cd; }
      if (draw.pv_scale !== undefined && draw.membrane === 'measured') {
        // scale all measured pressures together (calibration uncertainty of the gauge)
      }
      var conv = fromInputs(draw);
      if (inputs.membrane === 'measured' && sampled.pv_scale !== undefined && conv.p.pv) {
        conv.p.pv = { V: conv.p.pv.V, dP: conv.p.pv.dP.map(function (v) { return v * sampled.pv_scale; }) };
      }
      var r;
      try {
        if (conv.errors.length) throw new Error('bad');
        r = simulate(conv.p, { lite: true, t_end: Math.min(nominal.p.t_end, tHorizon * 1.5) });
      } catch (e) { failures++; continue; }
      var xs = [], vs = [];
      var tEndRun = r.summary.t_end;
      for (k = 0; k < G; k++) {
        if (tg[k] <= tEndRun) { var st = r.stateAt(tg[k]); xs.push(st[0]); vs.push(Math.max(st[1], 0)); }
        else { xs.push(r.summary.x_end); vs.push(0); }
      }
      X.push(xs); Vv.push(vs);
      outs.x_end.push(r.summary.x_end); outs.v_max.push(r.summary.v_max); outs.t_end.push(tEndRun);
      outs.t_burn.push(burnTimeLite(r));
      samples.push(sampled);
      if (opts.onProgress && (s + 1) % 10 === 0) opts.onProgress(s + 1, N);
    }
    var bands = { t: tg, x: { lo: [], mid: [], hi: [] }, v: { lo: [], mid: [], hi: [] } };
    for (k = 0; k < G; k++) {
      var colx = X.map(function (row) { return row[k]; }).sort(function (a, b) { return a - b; });
      var colv = Vv.map(function (row) { return row[k]; }).sort(function (a, b) { return a - b; });
      bands.x.lo.push(quantile(colx, 0.025)); bands.x.mid.push(quantile(colx, 0.5)); bands.x.hi.push(quantile(colx, 0.975));
      bands.v.lo.push(quantile(colv, 0.025)); bands.v.mid.push(quantile(colv, 0.5)); bands.v.hi.push(quantile(colv, 0.975));
    }
    var stats = {};
    Object.keys(outs).forEach(function (key2) {
      var arr = outs[key2].slice().sort(function (a, b) { return a - b; }), m = 0, v = 0;
      arr.forEach(function (x) { m += x / arr.length; });
      arr.forEach(function (x) { v += (x - m) * (x - m) / Math.max(arr.length - 1, 1); });
      stats[key2] = { mean: m, sd: Math.sqrt(v), p025: quantile(arr, 0.025), p50: quantile(arr, 0.5), p975: quantile(arr, 0.975) };
    });
    // approximate variance shares from squared correlations
    var shares = {};
    ['x_end', 'v_max'].forEach(function (outKey) {
      var y = outs[outKey], list = [], total = 0;
      active.forEach(function (u) {
        var xs2 = samples.map(function (smp) { return smp[u.key]; });
        var rr = pearson(xs2, y);
        var r2 = isFinite(rr) ? rr * rr : 0;
        list.push({ key: u.key, r: rr, r2: r2 });
        total += r2;
      });
      list.forEach(function (it) { it.share = total > 0 ? it.r2 / total : 0; });
      list.sort(function (a, b) { return b.r2 - a.r2; });
      shares[outKey] = list;
    });
    return { N: N, used: X.length, failures: failures, seed: seed, bands: bands, stats: stats, shares: shares, active: active.map(function (u) { return u.key; }) };
  }

  function burnTimeLite(r) {
    var raw = r.raw, n = raw.t.length, Tmax = 0, tb = 0;
    var model = makeModel(r.p, r.tab);
    var Ts = [];
    for (var i = 0; i < n; i++) { var f = model.forces(raw.v[i], raw.m[i]); Ts.push(f.T); if (f.T > Tmax) Tmax = f.T; }
    for (i = 0; i < n; i++) if (Ts[i] > 0.02 * Tmax) tb = raw.t[i];
    return tb;
  }

  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; }
    var sab = 0, saa = 0, sbb = 0;
    for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
  }

  /* ---------------------------------------------------------------- */
  /* Local sensitivity: elasticities by central differences (+/-5 %)  */
  /* ---------------------------------------------------------------- */
  function sensitivity(inputs, keys, opts) {
    opts = opts || {};
    var nom = fromInputs(inputs);
    if (nom.errors.length) throw EngineError('inputs', nom.errors[0].msg);
    var r0 = simulate(nom.p, { lite: true });
    var out0 = { x_end: r0.summary.x_end, v_max: r0.summary.v_max, t_end: r0.summary.t_end };
    var rows = [];
    keys.forEach(function (key, idx) {
      var base = Number(inputs[key]);
      if (!isFinite(base) || base === 0) return;
      var hStep = 0.05, up = {}, dn = {}, k;
      for (k in inputs) { up[k] = inputs[k]; dn[k] = inputs[k]; }
      up[key] = base * (1 + hStep); dn[key] = base * (1 - hStep);
      var useUp = true, useDn = true;
      if (key === 'Cv' && up.Cv > 1) useUp = false;
      if (key === 'Cd' && up.Cd > Number(inputs.Cv)) useUp = false;
      if (key === 'Cv' && dn.Cv < Number(inputs.Cd)) useDn = false;
      var ru = null, rd = null;
      try { if (useUp) { var cu = fromInputs(up); if (!cu.errors.length) ru = simulate(cu.p, { lite: true }); } } catch (e) { ru = null; }
      try { if (useDn) { var cd = fromInputs(dn); if (!cd.errors.length) rd = simulate(cd.p, { lite: true }); } } catch (e) { rd = null; }
      var el = {};
      ['x_end', 'v_max', 't_end'].forEach(function (o) {
        var yu = ru ? ru.summary[o] : null, yd = rd ? rd.summary[o] : null, y0 = out0[o];
        if (yu !== null && yd !== null) el[o] = ((yu - yd) / y0) / (2 * hStep);
        else if (yu !== null) el[o] = ((yu - y0) / y0) / hStep;
        else if (yd !== null) el[o] = ((y0 - yd) / y0) / hStep;
        else el[o] = null;
      });
      rows.push({ key: key, el: el });
      if (opts.onProgress) opts.onProgress(idx + 1, keys.length);
    });
    return { base: out0, rows: rows };
  }

  /* ---------------------------------------------------------------- */
  /* Small helpers for the form                                       */
  /* ---------------------------------------------------------------- */
  function pressureFromAltitude(h) { return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588); }

  /* C_v for air leaving through a straw: Bernoulli with entry and pipe
     friction losses, Blasius (turbulent) or 64/Re (laminar) friction factor. */
  function strawCv(L, D, dP, rho, mu) {
    var Kin = 0.5, Cv = 0.9, info = null;
    for (var it = 0; it < 50; it++) {
      var v = Cv * Math.sqrt(2 * dP / rho), Re = rho * v * D / mu;
      var f = Re < 2300 ? 64 / Re : 0.3164 * Math.pow(Re, -0.25);
      var CvNew = 1 / Math.sqrt(1 + Kin + f * L / D);
      info = { Re: Re, f: f, v: v };
      if (Math.abs(CvNew - Cv) < 1e-9) { Cv = CvNew; break; }
      Cv = CvNew;
    }
    info.Cv = Cv;
    return info;
  }

  return {
    DEFAULTS: DEFAULTS, withDefaults: withDefaults, rhoAmb: rhoAmb, muAir: muAir,
    membranePressure: membranePressure, buildTables: buildTables, simulate: simulate,
    fromInputs: fromInputs, parseRows: parseRows, parsePV: parsePV, parseRun: parseRun, sizeToVolume: sizeToVolume,
    PRESSURE_UNITS: PRESSURE_UNITS, nelderMead: nelderMead, calibrate: calibrate, FIT_SPECS: FIT_SPECS,
    fitMR: fitMR, fitGent: fitGent, monteCarlo: monteCarlo, sensitivity: sensitivity,
    pressureFromAltitude: pressureFromAltitude, strawCv: strawCv, interp1: interp1, quantile: quantile
  };
});
