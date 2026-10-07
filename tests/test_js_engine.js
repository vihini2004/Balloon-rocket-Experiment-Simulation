// The browser simulator's engine (simulator/src/engine.js) against the Python model.
//   python tests/make_js_reference.py && node tests/test_js_engine.js
const path = require('path');
const E = require(path.join(__dirname, '..', 'simulator', 'src', 'engine.js'));
const ref = require(path.join(__dirname, 'js_reference.json'));

// the Mooney-Rivlin curve on the same 6000-point grid Python uses (np.linspace(1, 6, 6000))
const N = 6000, R0 = 0.02, w0 = 0.0005;
const pvV = [], pvP = [];
for (let i = 0; i < N; i++) {
  const lam = 1 + 5 * i / (N - 1);
  pvV.push(4 / 3 * Math.PI * Math.pow(lam * R0, 3));
  pvP.push(4 * (w0 / R0) * (1 / lam - Math.pow(lam, -7)) * (7.5e4 + 1.0e4 * lam * lam));
}
const cases = {
  A_default: {},
  B_adiabatic: { thermal: 'adiabatic' },
  C_slope_misalign_friction: { theta_deg: 5, misalign_deg: 10, mu_k: 0.3, mu_s: 0.4 },
  D_wire4: { L_wire: 4.0 },
  E_nozzle10_noAM: { D_nozzle: 0.010, use_added_mass: false },
  F_prolate_nofloor_nobuoy: { C_add: 0.21, CdA_min: 0.0, use_buoyancy: false },
  I_no_recovery: { use_added_mass_rate: false },
  G_measured_MR: { membrane: 'measured', pv: { V: pvV, dP: pvP } },
  H_gent_as_pv: { membrane: 'gent', mu: 2.6e5, Jm: 100 },
};
const TOL = 0.001;              // 0.1 % on everything except the grid-dependent burn metrics
let worst = 0, failed = 0;
for (const [name, over] of Object.entries(cases)) {
  const r = E.simulate(over), s = r.summary, py = ref[name];
  const rows = [['x_end', s.x_end, py.x_end], ['v_max', s.v_max, py.v_max], ['t_end', s.t_end, py.t_end],
    ['T_peak', s.T_peak, py.T_peak], ['I_thrust_axial', r.budget.thrust, py.I_thrust_axial],
    ['t_burn', s.t_burn, py.t_burn], ['x_burn', s.x_burn, py.x_burn]];
  let ok = r.endedBy === py.ended || (r.endedBy === 'wire' && py.ended === 'wire end');
  const txt = rows.map(([k, a, b]) => {
    const d = (a - b) / b;
    if (!['t_burn', 'x_burn'].includes(k)) { worst = Math.max(worst, Math.abs(d)); if (Math.abs(d) > TOL) ok = false; }
    else if (Math.abs(d) > 0.02) ok = false;
    return `${k} ${(100 * d).toFixed(3)}%`;
  });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${txt.join('  ')}`);
}
console.log(`\nworst difference (excluding burn metrics): ${(100 * worst).toFixed(4)} %`);
process.exit(failed ? 1 : 0);
