(function () {
  'use strict';
  var E = window.BalloonEngine;
  var STORE_KEY = 'balloon-rocket-simulator/v1';

  /* ================================================================ */
  /* Example data (synthetic, clearly marked in the page)             */
  /* ================================================================ */
  var EXAMPLE_RUN = 't_s x_m\n0.2 0.231\n0.4 0.639\n0.6 1.364\n0.8 2.077\n1.0 2.853\n1.2 3.585\n1.4 4.394\n1.6 5.111\n1.8 5.920\n2.0 6.696\n2.2 7.550\n2.4 8.386\n2.6 9.294\n2.8 10.078\n3.0 10.965\n3.2 11.850\n3.4 12.895\n3.6 13.811\n3.8 14.841\n4.0 15.980\n4.2 17.041\n4.4 18.305\n4.6 19.759\n4.8 21.552\n5.0 23.301\n5.2 24.803\n5.4 25.950\n5.6 26.977\n5.8 27.851\n6.0 28.588\n';
  var EXAMPLE_PV = 'diameter_cm pressure_cmH2O\n4.6 38.5\n5 47.0\n5.5 51.0\n6 51.0\n7 49.5\n8 49.5\n10 47.5\n12 47.0\n14 49.0\n16 51.0\n18 53.0\n20 55.0\n22 58.5\n24 62.5\n';

  var EXAMPLE = {
    mass_g: '5', d0_mm: '40', wall_mm: '0.5', infl_mode: 'diameter', infl_cm: '24',
    membrane: 'mr', C1_kPa: '75', C2_kPa: '10', mu_kPa: '260', Jm: '100',
    pv_text: EXAMPLE_PV, pv_size_unit: 'diameter_cm', pv_p_unit: 'cmH2O',
    nozzle_mm: '5', Cd: '0.80', Cv: '0.95',
    T_C: '22', P_kPa: '101.325', thermal: 'isothermal',
    C_D: '0.47', CdA_cm2: '10', C_add: '0.5', recovery: true, buoyancy: true,
    mu_k: '0.05', mu_s: '0.08', slope_deg: '0', misalign_deg: '0', wire_m: '',
    t_end: '60', accuracy: 'standard'
  };

  var FIELDS = {
    mass_g: { label: 'Empty mass', sym: 'm<sub>e</sub>', unit: 'g', hint: 'Balloon rubber, tape and straw, weighed together.' },
    d0_mm: { label: 'Unstretched diameter', sym: '2R<sub>0</sub>', unit: 'mm', hint: 'Width of the balloon when just round, before the rubber stretches.' },
    wall_mm: { label: 'Wall thickness', sym: 'H<sub>0</sub>', unit: 'mm', hint: 'Unstretched rubber; measure a cut piece with calipers.' },
    infl_cm: { label: 'Inflated size', unit: 'cm', hint: 'Measured just before release.' },
    C1_kPa: { label: 'Constant C<sub>1</sub>', unit: 'kPa', hint: 'Mooney–Rivlin constants are placeholders until fitted to a measured curve.' },
    C2_kPa: { label: 'Constant C<sub>2</sub>', unit: 'kPa' },
    mu_kPa: { label: 'Shear modulus', sym: 'μ', unit: 'kPa' },
    Jm: { label: 'Locking limit', sym: 'J<sub>m</sub>', unit: '', hint: 'Sets how sharply the rubber stiffens; must exceed I<sub>1</sub> − 3 at full inflation.' },
    nozzle_mm: { label: 'Exit diameter', sym: 'D', unit: 'mm', hint: 'Inside diameter where the air leaves: the neck or an exit straw.' },
    Cd: { label: 'Discharge coefficient', sym: 'C<sub>d</sub>', unit: '', hint: 'Real mass flow ÷ ideal. Cannot exceed C<sub>v</sub>.' },
    Cv: { label: 'Velocity coefficient', sym: 'C<sub>v</sub>', unit: '', hint: 'Real jet speed ÷ ideal.' },
    T_C: { label: 'Temperature', sym: 'T', unit: '°C' },
    P_kPa: { label: 'Air pressure', sym: 'P<sub>atm</sub>', unit: 'kPa', hint: 'From a barometer or weather report, or set it from your altitude below.' },
    C_D: { label: 'Drag coefficient', sym: 'C<sub>D</sub>', unit: '', hint: '0.47 for a smooth sphere at these speeds; fit it to your run.' },
    CdA_cm2: { label: 'Minimum drag area', sym: '(C<sub>D</sub>A)<sub>min</sub>', unit: 'cm²', hint: 'Floor for a limp balloon plus tape and straw.' },
    C_add: { label: 'Added-mass coefficient', sym: 'C<sub>add</sub>', unit: '', hint: '0.5 for a sphere, about 0.21 for a 2:1 elongated balloon; 0 switches added mass off.' },
    mu_k: { label: 'Kinetic friction', sym: 'μ<sub>k</sub>', unit: '', hint: 'Straw on wire while sliding; best found by fitting your run.' },
    mu_s: { label: 'Static friction', sym: 'μ<sub>s</sub>', unit: '' },
    slope_deg: { label: 'Wire slope', sym: 'θ', unit: '°', hint: 'Positive when the wire rises in the direction of travel.' },
    misalign_deg: { label: 'Jet angle to wire', sym: 'α', unit: '°', hint: 'A drooping neck tilts the jet and presses the straw on the wire.' },
    wire_m: { label: 'Usable wire length', sym: 'L', unit: 'm', hint: 'Leave blank for no limit.', placeholder: 'no limit' },
    t_end: { label: 'Time limit', unit: 's' }
  };

  var UNC_ROWS = [
    { key: 'mass_g', label: 'Empty mass', unit: 'g', sd: 0.2 },
    { key: 'd0_mm', label: 'Unstretched diameter', unit: 'mm', sd: 1 },
    { key: 'wall_mm', label: 'Wall thickness', unit: 'mm', sd: 0.03 },
    { key: 'infl_cm', label: 'Inflated size', unit: 'cm', sd: 0.5 },
    { key: 'C1_kPa', label: 'C₁', unit: 'kPa', sd: 7.5, mode: 'mr' },
    { key: 'C2_kPa', label: 'C₂', unit: 'kPa', sd: 1, mode: 'mr' },
    { key: 'mu_kPa', label: 'Shear modulus μ', unit: 'kPa', sd: 26, mode: 'gent' },
    { key: 'Jm', label: 'Locking limit J_m', unit: '', sd: 10, mode: 'gent' },
    { key: 'pv_scale', label: 'Pressure readings (scale)', unit: '× reading', sd: 0.03, mode: 'measured' },
    { key: 'nozzle_mm', label: 'Exit diameter', unit: 'mm', sd: 0.2 },
    { key: 'Cd', label: 'Discharge coefficient C_d', unit: '', sd: 0.05, max: 1 },
    { key: 'Cv', label: 'Velocity coefficient C_v', unit: '', sd: 0.03, max: 1 },
    { key: 'C_D', label: 'Drag coefficient C_D', unit: '', sd: 0.05 },
    { key: 'CdA_cm2', label: 'Minimum drag area', unit: 'cm²', sd: 3 },
    { key: 'C_add', label: 'Added-mass coefficient', unit: '', sd: 0.05 },
    { key: 'mu_k', label: 'Kinetic friction μ_k', unit: '', sd: 0.02 },
    { key: 'T_C', label: 'Room temperature', unit: '°C', sd: 1, signed: true },
    { key: 'P_kPa', label: 'Air pressure', unit: 'kPa', sd: 0.3 },
    { key: 'slope_deg', label: 'Wire slope', unit: '°', sd: 0.5, signed: true }
  ];
  var UNC_LABEL = {};
  UNC_ROWS.forEach(function (u) { UNC_LABEL[u.key] = u.label; });

  var FIT_KEYS = [
    { key: 'C_D', label: 'Drag coefficient C<sub>D</sub>' },
    { key: 'mu_k', label: 'Kinetic friction μ<sub>k</sub>' },
    { key: 'CdA_min', label: 'Minimum drag area' },
    { key: 'Cv', label: 'Velocity coefficient C<sub>v</sub>' },
    { key: 'Cd', label: 'Discharge coefficient C<sub>d</sub>' },
    { key: 't0', label: 'Release time t<sub>0</sub>', small: 'When the video clock started before release' }
  ];

  var SENS_KEYS_BASE = ['mass_g', 'd0_mm', 'wall_mm', 'infl_cm', 'nozzle_mm', 'Cd', 'Cv', 'C_D', 'CdA_cm2', 'C_add', 'mu_k'];

  /* ================================================================ */
  /* State                                                            */
  /* ================================================================ */
  function defaultUnc() { var u = {}; UNC_ROWS.forEach(function (r) { u[r.key] = r.sd; }); return u; }
  function defaultState() {
    return {
      inputs: Object.assign({}, EXAMPLE),
      run: { text: EXAMPLE_RUN, tUnit: 's', xUnit: 'm', fps: 30, t0: 0 },
      fitKeys: ['C_D', 'mu_k'], unc: defaultUnc(), mcN: 300, seed: 2026, showBand: true, tab: 'position'
    };
  }
  var state = defaultState();
  var R = { conv: null, sim: null, errors: [], run: null, fit: null, fitStale: false, mc: null, mcStale: false, sens: null, sensStale: false };
  var fieldEls = {};

  /* ================================================================ */
  /* Utilities                                                        */
  /* ================================================================ */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c === null || c === undefined || c === false) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svgUse(id, cls) { return '<svg class="' + (cls || 'ic') + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtAuto(v) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 100) return fmt(v, 1);
    if (a >= 10) return fmt(v, 2);
    if (a >= 1) return fmt(v, 3);
    if (a >= 0.01) return fmt(v, 4);
    return v.toExponential(2);
  }
  function fmtSci(v, d) {
    if (!isFinite(v)) return '–';
    if (v === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(v))), m = v / Math.pow(10, e);
    if (e >= -2 && e <= 3) return fmt(v, d);
    return fmt(m, d) + ' × 10' + String(e).replace('-', '⁻').replace(/[0-9]/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]; });
  }
  function debounce(fn, ms) { var t = 0; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function toast(msg) {
    var root = $('toast-root');
    root.innerHTML = '';
    var t = el('div', { class: 'toast', text: msg });
    root.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }
  function numOr(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  /* ================================================================ */
  /* Persistence (per-viewer draft in this browser)                   */
  /* ================================================================ */
  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      applyImported(JSON.parse(raw), true);
    } catch (e) { /* storage unavailable: keep the example */ }
  }
  var saveState = debounce(function () {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(exportObject())); } catch (e) { /* ignore */ }
  }, 400);
  function exportObject() {
    return { app: 'balloon-rocket-simulator', version: 1, inputs: state.inputs, run: state.run, fitKeys: state.fitKeys,
             uncertainty: state.unc, mcRuns: state.mcN, seed: state.seed, showBand: state.showBand, tab: state.tab };
  }
  function applyImported(obj, quiet) {
    if (!obj || obj.app !== 'balloon-rocket-simulator') { if (!quiet) toast('That file is not a Balloon Rocket Simulator export.'); return false; }
    var k;
    var base = defaultState();
    if (obj.inputs) for (k in base.inputs) if (obj.inputs[k] !== undefined) base.inputs[k] = obj.inputs[k];
    if (obj.run) for (k in base.run) if (obj.run[k] !== undefined) base.run[k] = obj.run[k];
    if (Array.isArray(obj.fitKeys)) base.fitKeys = obj.fitKeys.filter(function (x) { return FIT_KEYS.some(function (f) { return f.key === x; }); });
    if (obj.uncertainty) for (k in base.unc) if (isFinite(Number(obj.uncertainty[k]))) base.unc[k] = Number(obj.uncertainty[k]);
    if (obj.mcRuns) base.mcN = Number(obj.mcRuns) || 300;
    if (obj.seed !== undefined) base.seed = Number(obj.seed) || 2026;
    if (obj.showBand !== undefined) base.showBand = !!obj.showBand;
    if (obj.tab) base.tab = obj.tab;
    state = base;
    return true;
  }

  /* ================================================================ */
  /* Measurement sheet                                                */
  /* ================================================================ */
  function isExampleValue(key) {
    var a = state.inputs[key], b = EXAMPLE[key];
    if (typeof b === 'boolean' || typeof a === 'boolean') return a === b;
    if (key === 'pv_text') return String(a).trim() === String(b).trim();
    var na = Number(a), nb = Number(b);
    if (a === '' || b === '') return a === b;
    if (isFinite(na) && isFinite(nb)) return Math.abs(na - nb) <= 1e-12 * Math.max(1, Math.abs(nb));
    return a === b;
  }
  function markSet(key) {
    var f = fieldEls[key];
    if (!f) return;
    var set = !isExampleValue(key);
    if (key === 'infl_cm' && state.inputs.infl_mode !== EXAMPLE.infl_mode) set = true;
    f.row.classList.toggle('is-set', set);
  }

  function labelFor(key, id) {
    var f = FIELDS[key];
    return el('label', { for: id }, [el('i', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', { html: f.label + (f.sym ? ' <span class="sym">' + f.sym + '</span>' : '') })]);
  }
  function msgEls(id) {
    return [el('p', { class: 'err', id: id + '-err', hidden: true }), el('p', { class: 'warnmsg', id: id + '-warn', hidden: true })];
  }
  function numberField(key) {
    var f = FIELDS[key], id = 'in-' + key;
    var input = el('input', { id: id, type: 'number', step: 'any', inputmode: 'decimal', placeholder: f.placeholder || null,
      'aria-describedby': f.hint ? id + '-hint' : null });
    input.value = state.inputs[key];
    input.addEventListener('input', function () { state.inputs[key] = input.value; changed(key); });
    var kids = [labelFor(key, id), el('div', { class: 'ctl' }, [input, f.unit ? el('span', { class: 'unit', text: f.unit }) : null])];
    if (f.hint) kids.push(el('p', { class: 'hint', id: id + '-hint', html: f.hint }));
    var row = el('div', { class: 'field', 'data-key': key }, kids.concat(msgEls(id)));
    fieldEls[key] = { row: row, input: input };
    return row;
  }
  function inflField() {
    var id = 'in-infl_cm', f = FIELDS.infl_cm;
    var sel = el('select', { id: 'in-infl_mode', 'aria-label': 'Inflated size measured as' }, [
      el('option', { value: 'diameter', text: 'Diameter' }), el('option', { value: 'circumference', text: 'Circumference' })]);
    sel.value = state.inputs.infl_mode;
    var input = el('input', { id: id, type: 'number', step: 'any', inputmode: 'decimal', 'aria-describedby': id + '-hint' });
    input.value = state.inputs.infl_cm;
    sel.addEventListener('change', function () {
      var v = Number(state.inputs.infl_cm);
      if (isFinite(v) && v > 0) {
        v = sel.value === 'circumference' ? v * Math.PI : v / Math.PI;
        state.inputs.infl_cm = String(Math.round(v * 100) / 100);
        input.value = state.inputs.infl_cm;
      }
      state.inputs.infl_mode = sel.value;
      changed('infl_cm', true);
    });
    input.addEventListener('input', function () { state.inputs.infl_cm = input.value; changed('infl_cm'); });
    var row = el('div', { class: 'field', 'data-key': 'infl_cm' }, [
      el('label', { for: id }, [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: f.label })]),
      el('div', { class: 'ctl' }, [input, el('span', { class: 'unit', text: 'cm' })]),
      el('div', { class: 'ctl', style: 'grid-column: 1 / -1' }, [sel]),
      el('p', { class: 'hint', id: id + '-hint', text: 'Diameter or circumference, measured just before release.' })
    ].concat(msgEls(id)));
    fieldEls.infl_cm = { row: row, input: input, sel: sel };
    return row;
  }
  function selectField(key, label, options, hint) {
    var id = 'in-' + key;
    var sel = el('select', { id: id }, options.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    sel.value = state.inputs[key];
    sel.addEventListener('change', function () { state.inputs[key] = sel.value; changed(key, true); });
    var row = el('div', { class: 'field', 'data-key': key }, [
      el('label', { for: id }, [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: label })]),
      el('div', { class: 'ctl' }, [sel]), hint ? el('p', { class: 'hint', text: hint }) : null]);
    fieldEls[key] = { row: row, input: sel };
    return row;
  }
  function checkField(key, label, small) {
    var id = 'in-' + key;
    var cb = el('input', { type: 'checkbox', id: id });
    cb.checked = !!state.inputs[key];
    cb.addEventListener('change', function () { state.inputs[key] = cb.checked; changed(key, true); });
    var row = el('div', { class: 'field', 'data-key': key, style: 'grid-template-columns: 1fr' }, [
      el('label', { class: 'check', for: id }, [cb, el('span', {}, [label, small ? el('small', { text: small }) : null])])]);
    fieldEls[key] = { row: row, input: cb };
    return row;
  }
  function section(id, title, bodyKids, open) {
    var det = el('details', { class: 'sec', id: 'sec-' + id, open: open !== false });
    det.appendChild(el('summary', {}, [el('span', { text: title }), el('span', { class: 'tally', id: 'tally-' + id }),
      el('span', { html: '<svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>' })]));
    det.appendChild(el('div', { class: 'sec-body' }, bodyKids));
    return det;
  }

  var SECTION_KEYS = {
    balloon: ['mass_g', 'd0_mm', 'wall_mm', 'infl_cm'],
    rubber: ['membrane', 'C1_kPa', 'C2_kPa', 'mu_kPa', 'Jm', 'pv_text'],
    nozzle: ['nozzle_mm', 'Cd', 'Cv'],
    air: ['T_C', 'P_kPa', 'thermal'],
    drag: ['C_D', 'CdA_cm2', 'C_add', 'recovery', 'buoyancy'],
    wire: ['mu_k', 'mu_s', 'slope_deg', 'misalign_deg', 'wire_m'],
    sim: ['t_end', 'accuracy']
  };

  function buildSheet() {
    var host = $('sheet-sections');
    host.innerHTML = '';
    fieldEls = {};
    host.appendChild(section('balloon', 'Balloon and payload', [numberField('mass_g'), numberField('d0_mm'), numberField('wall_mm'), inflField()]));
    host.appendChild(section('rubber', 'Rubber pressure curve', buildRubber()));
    host.appendChild(section('nozzle', 'Nozzle', [numberField('nozzle_mm'), numberField('Cd'), numberField('Cv'), buildStrawHelper()]));
    host.appendChild(section('air', 'Room air', [numberField('T_C'), numberField('P_kPa'), buildAltitudeHelper(),
      selectField('thermal', 'Gas temperature', [['isothermal', 'Isothermal'], ['adiabatic', 'Adiabatic']],
        'Isothermal holds the air at room temperature; adiabatic lets it cool as it expands. The two limits bracket reality and differ by under 1 % here.')]));
    host.appendChild(section('drag', 'Drag and added mass', [numberField('C_D'), numberField('CdA_cm2'), numberField('C_add'),
      checkField('recovery', 'Include added-mass recovery', 'The forward push as the shrinking balloon hands back the air it set moving.'),
      checkField('buoyancy', 'Include buoyancy', 'Reduces the load on the wire, and so the friction.')]));
    host.appendChild(section('wire', 'Wire and friction', [numberField('mu_k'), numberField('mu_s'), numberField('slope_deg'), numberField('misalign_deg'), numberField('wire_m')]));
    host.appendChild(section('sim', 'Simulation settings', [numberField('t_end'),
      selectField('accuracy', 'Accuracy', [['standard', 'Standard'], ['high', 'High']], 'Standard: relative tolerance 10⁻⁸, step ≤ 0.01 s. High: 10⁻¹⁰, step ≤ 0.002 s, finer tables.')], false));
    if (window.matchMedia && window.matchMedia('(max-width: 1119px)').matches) {
      ['rubber', 'nozzle', 'air', 'drag', 'wire', 'sim'].forEach(function (s) { var d = $('sec-' + s); if (d) d.open = false; });
    }
    Object.keys(fieldEls).forEach(markSet);
    updateTallies();
    syncMembraneUI();
  }

  function buildRubber() {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Pressure model' });
    [['mr', 'Mooney–Rivlin'], ['gent', 'Gent'], ['measured', 'Measured curve']].forEach(function (o) {
      seg.appendChild(el('button', { type: 'button', 'data-mode': o[0], 'aria-pressed': String(state.inputs.membrane === o[0]), text: o[1],
        onclick: function () { state.inputs.membrane = o[0]; syncMembraneUI(); changed('membrane', true); } }));
    });
    fieldEls.membrane = { row: seg, input: seg };
    var mr = el('div', { id: 'grp-mr', class: 'stack' }, [numberField('C1_kPa'), numberField('C2_kPa')]);
    var gent = el('div', { id: 'grp-gent', class: 'stack' }, [numberField('mu_kPa'), numberField('Jm')]);
    var ta = el('textarea', { class: 'data', id: 'in-pv_text', spellcheck: 'false', rows: '8', 'aria-describedby': 'pv-status' });
    ta.value = state.inputs.pv_text;
    ta.addEventListener('input', function () { state.inputs.pv_text = ta.value; changed('pv_text'); });
    var sizeSel = el('select', { id: 'in-pv_size_unit', 'aria-label': 'Size column' }, [
      el('option', { value: 'diameter_cm', text: 'Diameter (cm)' }), el('option', { value: 'circumference_cm', text: 'Circumference (cm)' }),
      el('option', { value: 'volume_L', text: 'Volume (L)' })]);
    sizeSel.value = state.inputs.pv_size_unit;
    sizeSel.addEventListener('change', function () { state.inputs.pv_size_unit = sizeSel.value; changed('pv_text', true); });
    var pSel = el('select', { id: 'in-pv_p_unit', 'aria-label': 'Pressure column' }, [
      el('option', { value: 'cmH2O', text: 'Pressure (cm H₂O)' }), el('option', { value: 'kPa', text: 'Pressure (kPa)' }),
      el('option', { value: 'Pa', text: 'Pressure (Pa)' }), el('option', { value: 'mmHg', text: 'Pressure (mmHg)' }), el('option', { value: 'inH2O', text: 'Pressure (in H₂O)' })]);
    pSel.value = state.inputs.pv_p_unit;
    pSel.addEventListener('change', function () { state.inputs.pv_p_unit = pSel.value; changed('pv_text', true); });
    fieldEls.pv_text = { row: el('div', { class: 'field', 'data-key': 'pv_text', style: 'grid-template-columns:1fr' }, [
      el('label', { for: 'in-pv_text' }, [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: 'Measured deflation curve: size, then gauge pressure' })]),
      ta].concat(msgEls('in-pv_text'))), input: ta };
    var pvDet = el('details', { class: 'helper', id: 'pv-block' }, [
      el('summary', { class: 'note', style: 'cursor:pointer', html: '<b>Measured deflation curve</b> <span class="tag example" id="pv-example-tag">Example data (synthetic)</span>' }),
      el('div', { class: 'stack', style: 'margin-top:8px' }, [
        el('p', { class: 'note', text: 'Record pressure while the balloon deflates, with a water U-tube manometer (1 cm H₂O = 98 Pa). Use the deflation curve: rubber pushes back less on the way down.' }),
        fieldEls.pv_text.row,
        el('div', { class: 'units-row' }, [sizeSel, pSel]),
        el('p', { class: 'note muted', id: 'pv-status' }),
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn', type: 'button', id: 'btn-fit-mr', text: 'Fit Mooney–Rivlin', onclick: function () { fitCurve('mr'); } }),
          el('button', { class: 'btn', type: 'button', id: 'btn-fit-gent', text: 'Fit Gent', onclick: function () { fitCurve('gent'); } })
        ]),
        el('div', { id: 'pv-fit-result' })
      ])
    ]);
    var readout = el('p', { class: 'readout-line', id: 'rubber-readout' });
    return [seg, mr, gent, pvDet, readout];
  }

  function syncMembraneUI() {
    var m = state.inputs.membrane;
    var seg = fieldEls.membrane && fieldEls.membrane.row;
    if (seg) Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m)); });
    var gm = $('grp-mr'), gg = $('grp-gent'), pv = $('pv-block');
    if (gm) gm.hidden = m !== 'mr';
    if (gg) gg.hidden = m !== 'gent';
    if (pv && m === 'measured') pv.open = true;
    var tag = $('pv-example-tag');
    if (tag) tag.hidden = !isExampleValue('pv_text');
    renderUncTable();
  }

  function buildStrawHelper() {
    var len = el('input', { id: 'straw-len', type: 'number', step: 'any', value: '15', 'aria-label': 'Straw length in centimetres' });
    var out = el('p', { id: 'straw-out', text: 'Enter the length of the exit straw to estimate the losses from pipe friction.' });
    var useBtn = el('button', { class: 'btn', type: 'button', id: 'straw-use', hidden: true, text: 'Use these values' });
    var est = null;
    function estimate() {
      var sim = R.sim, L = Number(len.value) / 100;
      if (!sim || !(L > 0)) { out.textContent = 'Needs a valid simulation and a straw length.'; return; }
      var p = sim.p, D = p.D_nozzle, dPm = 0.8 * sim.summary.dP0;
      var rho = (p.P_atm + dPm) / (p.R_air * p.T_amb);
      est = E.strawCv(L, D, dPm, rho, E.muAir(p.T_amb));
      out.textContent = 'At a typical ' + fmt(dPm / 1000, 1) + ' kPa: jet ≈ ' + fmt(est.v, 0) + ' m/s, Re ≈ ' + fmtSci(est.Re, 1) + ', friction factor ' + fmt(est.f, 3) +
        '. Estimated C_v ≈ ' + fmt(est.Cv, 2) + '; a straw runs full, so C_d ≈ C_v.';
      useBtn.hidden = false;
    }
    useBtn.addEventListener('click', function () {
      if (!est) return;
      var v = String(Math.round(est.Cv * 100) / 100);
      state.inputs.Cv = v; state.inputs.Cd = v;
      fieldEls.Cv.input.value = v; fieldEls.Cd.input.value = v;
      changed('Cv', true); markSet('Cd');
      toast('C_v and C_d set to ' + v);
    });
    return el('details', { class: 'helper' }, [
      el('summary', { class: 'note', style: 'cursor:pointer', html: '<b>Air leaves through a straw?</b> Estimate C<sub>v</sub>' }),
      el('div', { class: 'stack', style: 'margin-top:8px' }, [
        el('div', { class: 'helper-row' }, [el('label', { class: 'note', for: 'straw-len', text: 'Straw length' }),
          el('div', { class: 'ctl' }, [len, el('span', { class: 'unit', text: 'cm' })]),
          el('button', { class: 'btn', type: 'button', text: 'Estimate', onclick: estimate })]),
        out, useBtn])
    ]);
  }

  function buildAltitudeHelper() {
    var alt = el('input', { id: 'alt-m', type: 'number', step: 'any', value: '0', 'aria-label': 'Altitude in metres' });
    return el('div', { class: 'helper-row' }, [
      el('label', { class: 'note', for: 'alt-m', text: 'Altitude' }),
      el('div', { class: 'ctl' }, [alt, el('span', { class: 'unit', text: 'm' })]),
      el('button', { class: 'btn', type: 'button', text: 'Set pressure', onclick: function () {
        var h = Number(alt.value);
        if (!isFinite(h) || h < -400 || h > 6000) { toast('Enter an altitude between −400 and 6000 m.'); return; }
        var P = E.pressureFromAltitude(h) / 1000;
        state.inputs.P_kPa = String(Math.round(P * 100) / 100);
        fieldEls.P_kPa.input.value = state.inputs.P_kPa;
        changed('P_kPa', true);
        toast('Air pressure set to ' + state.inputs.P_kPa + ' kPa (standard atmosphere at ' + h + ' m)');
      } })
    ]);
  }

  function updateTallies() {
    Object.keys(SECTION_KEYS).forEach(function (sec) {
      var keys = SECTION_KEYS[sec].filter(function (k) { return fieldEls[k] && k !== 'membrane'; });
      var mine = keys.filter(function (k) { return !isExampleValue(k); }).length;
      var t = $('tally-' + sec);
      if (t) t.textContent = mine ? mine + ' of ' + keys.length + ' yours' : 'example values';
    });
  }

  var recomputeSoon = debounce(recompute, 140);
  function changed(key, now) {
    markSet(key);
    updateTallies();
    if (key === 'pv_text' || key === 'membrane') { var tag = $('pv-example-tag'); if (tag) tag.hidden = !isExampleValue('pv_text'); }
    if (now) recompute(); else recomputeSoon();
    saveState();
  }

  function showFieldMessages(conv) {
    Object.keys(fieldEls).forEach(function (k) {
      var f = fieldEls[k], id = 'in-' + k;
      var err = $(id + '-err'), warn = $(id + '-warn');
      if (err) { err.hidden = true; err.textContent = ''; }
      if (warn) { warn.hidden = true; warn.textContent = ''; }
      if (f.row && f.row.classList) { f.row.classList.remove('has-err'); f.row.classList.remove('has-warn'); }
    });
    var keyMap = { infl_mode: 'infl_cm' };
    (conv ? conv.errors : []).forEach(function (e) {
      var k = keyMap[e.key] || e.key, err = $('in-' + k + '-err');
      if (err) { err.hidden = false; err.textContent = e.msg; fieldEls[k].row.classList.add('has-err'); }
    });
    (conv ? conv.warnings : []).forEach(function (w) {
      var k = keyMap[w.key] || w.key, wm = $('in-' + k + '-warn');
      if (wm) { wm.hidden = false; wm.textContent = w.msg; fieldEls[k].row.classList.add('has-warn'); }
    });
  }

  /* ================================================================ */
  /* Simulation                                                       */
  /* ================================================================ */
  function recompute() {
    var conv = E.fromInputs(state.inputs);
    R.conv = conv;
    showFieldMessages(conv);
    renderPvStatus(conv);
    R.run = parseRunData();
    if (conv.errors.length) {
      R.errors = conv.errors;
      document.body.classList.add('has-errors');
      setBusy(true);
      renderStatus();
      renderChecks();
      return;
    }
    var sim;
    try { sim = E.simulate(conv.p); }
    catch (e) {
      R.errors = [{ key: e.code || 'engine', msg: e.message }];
      setBusy(true);
      renderStatus();
      renderChecks();
      return;
    }
    R.errors = [];
    setBusy(false);
    R.sim = sim;
    if (R.mc) R.mcStale = true;
    if (R.sens) R.sensStale = true;
    if (R.fit) R.fitStale = true;
    renderAll();
  }
  function setBusy(b) {
    ['kpis', 'flight', 'charts'].forEach(function (id) { var n = $(id); if (n) n.classList.toggle('busy', b); });
  }

  function parseRunData() {
    var r = state.run;
    var d = E.parseRun(r.text, r.tUnit, r.xUnit, Number(r.fps) || 30);
    var t0 = Number(r.t0) || 0;
    return { t: d.t, x: d.x, t0: t0, tSim: d.t.map(function (t) { return t - t0; }) };
  }

  /* ================================================================ */
  /* Rendering: summary                                               */
  /* ================================================================ */
  function renderAll() {
    renderKPIs();
    renderStatus();
    resetFlight();
    renderChart();
    renderRunStatus();
    renderChecks();
    renderUncTable();
    renderMcResult();
    renderFitResult();
    renderRubberReadout();
  }

  function endPhrase(s, sim) {
    if (s.endedBy === 'stopped') return 'stopped at ' + fmt(s.t_end, 2) + ' s';
    if (s.endedBy === 'wire') return 'reached the wire end at ' + fmt(s.t_end, 2) + ' s';
    if (s.endedBy === 'never_moved') return 'never started moving';
    if (s.endedBy === 'time') return 'still moving at the ' + fmt(s.t_end, 0) + ' s limit';
    return 'run ended at ' + fmt(s.t_end, 2) + ' s';
  }

  function renderKPIs() {
    if (!R.sim) return;
    var sim = R.sim, s = sim.summary, host = $('kpis');
    host.innerHTML = '';
    var mc = (R.mc && !R.mcStale && state.showBand) ? R.mc : null;
    var finite = isFinite(sim.p.L_wire);
    var tiles = [
      { label: finite && s.endedBy === 'wire' ? 'Distance (wire end)' : 'Final distance', value: fmt(s.x_end, s.x_end >= 10 ? 1 : 2), unit: 'm', sub: endPhrase(s),
        unc: mc ? '95 %: ' + fmt(mc.stats.x_end.p025, 1) + '–' + fmt(mc.stats.x_end.p975, 1) + ' m' : null },
      { label: 'Peak speed', value: fmt(s.v_max, 2), unit: 'm/s', sub: 'at ' + fmt(s.t_vmax, 2) + ' s, stretch λ ' + fmt(s.lam_vmax, 2),
        unc: mc ? '95 %: ' + fmt(mc.stats.v_max.p025, 2) + '–' + fmt(mc.stats.v_max.p975, 2) + ' m/s' : null },
      { label: 'Burn time', value: (s.burnComplete ? '' : '&gt; ') + fmt(s.t_burn, 2), unit: 's', sub: s.burnComplete ? 'until thrust falls below 2 % of peak' : 'still thrusting when the run ended',
        unc: mc ? '95 %: ' + fmt(mc.stats.t_burn.p025, 2) + '–' + fmt(mc.stats.t_burn.p975, 2) + ' s' : null },
      { label: 'Peak thrust', value: fmt(s.T_peak, 3), unit: 'N', sub: '≈ ' + fmt(s.T_peak / 9.80665 * 1000, 1) + ' g on a kitchen scale' },
      finite ? { label: 'Time to wire end', value: s.endedBy === 'wire' ? fmt(s.t_end, 2) : '–', unit: s.endedBy === 'wire' ? 's' : '', sub: s.endedBy === 'wire' ? 'arrives at ' + fmt(s.v_end, 2) + ' m/s' : 'stops ' + fmt(sim.p.L_wire - s.x_end, 2) + ' m short' }
        : { label: 'Time to cover 5 m', value: s.t_5m !== null ? fmt(s.t_5m, 2) : '–', unit: s.t_5m !== null ? 's' : '', sub: s.t_5m !== null ? 'from release' : 'never reaches 5 m' }
    ];
    tiles.forEach(function (t) {
      host.appendChild(el('div', { class: 'kpi' }, [
        el('span', { class: 'label', text: t.label }),
        el('span', { class: 'value', html: t.value + (t.unit ? '<small>' + t.unit + '</small>' : '') }),
        el('span', { class: 'sub', text: t.sub }),
        t.unc ? el('span', { class: 'unc', text: t.unc }) : null
      ]));
    });
  }

  function renderStatus() {
    var checks = buildChecks();
    R.checks = checks;
    var counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    checks.forEach(function (c) { counts[c.status]++; });
    var worst = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
    var parts = [];
    if (counts.fail) parts.push(counts.fail + ' failed');
    if (counts.warn) parts.push(counts.warn + ' to review');
    parts.push(counts.pass + ' passed');
    $('check-pill').innerHTML = svgUse('i-' + worst) + '<span></span>';
    $('check-pill').querySelector('span').textContent = 'Model checks: ' + parts.join(' · ');
    var info = $('runinfo');
    if (R.errors.length) info.textContent = 'Fix the highlighted inputs to run the simulation.';
    else if (R.sim) info.textContent = 'Solved in ' + fmt(R.sim.ms, 0) + ' ms · ' + fmt(R.sim.steps, 0) + ' steps · ' + fmt(R.sim.nfev, 0) + ' force evaluations';
  }

  function renderRubberReadout() {
    var o = $('rubber-readout');
    if (!o || !R.sim) return;
    var s = R.sim.summary;
    o.innerHTML = 'At release: gauge pressure <b>' + fmt(s.dP0 / 1000, 2) + ' kPa</b> (' + fmt(s.dP0 / 98.0665, 1) + ' cm H₂O), stretch λ₀ <b>' + fmt(s.lam0, 2) + '</b>, air <b>' + fmt(s.m0 * 1000, 2) + ' g</b>.';
  }

  function renderPvStatus(conv) {
    var st = $('pv-status');
    if (!st) return;
    var R0 = Number(state.inputs.d0_mm) / 2000;
    if (!(R0 > 0)) { st.textContent = ''; return; }
    var pv = E.parsePV(state.inputs.pv_text, state.inputs.pv_size_unit, state.inputs.pv_p_unit, R0);
    if (pv.raw.V.length < 3) { st.textContent = 'Enter at least three rows: size, then gauge pressure.'; return; }
    var vmin = pv.raw.V[0] * 1000, vmax = pv.raw.V[pv.raw.V.length - 1] * 1000, pmax = Math.max.apply(null, pv.raw.dP) / 1000;
    var msg = pv.raw.V.length + ' points, ' + fmt(vmin, 2) + '–' + fmt(vmax, 2) + ' L, up to ' + fmt(pmax, 2) + ' kPa.';
    if (pv.notes.indexOf('added') >= 0) msg += ' A zero-pressure point was added at the unstretched size (' + fmt(pv.Vrest * 1000, 3) + ' L).';
    st.textContent = msg;
  }

  /* ================================================================ */
  /* Flight view (canvas)                                             */
  /* ================================================================ */
  var flight = { t: 0, playing: false, raf: 0, last: 0 };
  function strobeDt(tEnd) {
    var v = $('strobe').value;
    if (v !== 'auto') return Number(v);
    var target = tEnd / 18, opts = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
    for (var i = 0; i < opts.length; i++) if (opts[i] >= target) return opts[i];
    return 5;
  }
  function resetFlight() {
    stopFlight();
    flight.t = R.sim ? R.sim.summary.t_end : 0;
    $('scrub').value = 1000;
    drawFlight();
  }
  function gridAt(key, t) {
    var G = R.sim.grid;
    return E.interp1(t, G.t, G[key]);
  }
  function drawFlight() {
    var sim = R.sim, cv = $('flight-canvas');
    if (!sim || !cv) return;
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var C = { surface: cssVar('--surface'), wire: cssVar('--wire'), muted: cssVar('--muted'), ink2: cssVar('--ink-2'), ink: cssVar('--ink'),
      balloon: cssVar('--balloon'), hi: cssVar('--balloon-hi'), jet: cssVar('--jet'), grid: cssVar('--grid'), axis: cssVar('--axis'), s2: cssVar('--s2'), hair: cssVar('--hair') };
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);
    var s = sim.summary, G = sim.grid, L = sim.p.L_wire, run = R.run;
    var xMax = Math.max(s.x_end, isFinite(L) ? L : 0, 1);
    if (run && run.x.length) xMax = Math.max(xMax, Math.max.apply(null, run.x));
    xMax *= 1.03;
    var padL = 34, padR = 22, wireY = 58, plotW = w - padL - padR;
    var X = function (x) { return padL + x / xMax * plotW; };
    var Rmax = sim.tab.R[sim.tab.n - 1], Rmin = sim.tab.R[0];
    var rv = function (R) { return 7 + 21 * (R - Rmin) / Math.max(Rmax - Rmin, 1e-9); };
    // ruler
    var rulerY = h - 26;
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, rulerY + 0.5); ctx.lineTo(padL + plotW, rulerY + 0.5); ctx.stroke();
    var step = niceStep(xMax / Math.max(3, Math.floor(plotW / 70)));
    ctx.fillStyle = C.muted; ctx.font = '12px ' + cssVar('--font-ui'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var xv = 0; xv <= xMax + 1e-9; xv += step) {
      var px = Math.round(X(xv)) + 0.5;
      ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(px, rulerY - 4); ctx.lineTo(px, rulerY + 4); ctx.stroke();
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(px, wireY + 6); ctx.lineTo(px, rulerY - 6); ctx.stroke();
      ctx.fillText(fmtTick(xv, step) + (xv === 0 ? ' m' : ''), px, rulerY + 7);
    }
    // wire
    ctx.strokeStyle = C.wire; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, wireY); ctx.lineTo(w - 8, wireY); ctx.stroke();
    if (isFinite(L)) {
      var ex = X(L);
      ctx.fillStyle = C.ink2; ctx.fillRect(ex - 2, wireY - 16, 4, 32);
      ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('wire end', Math.min(ex, w - 30), rulerY - 6);
    }
    // measured positions (ticks above the wire)
    if (run && run.x.length) {
      for (var i = 0; i < run.x.length; i++) {
        var mx = X(run.x[i]), past = run.tSim[i] <= flight.t + 1e-9;
        ctx.globalAlpha = past ? 1 : 0.28;
        ctx.fillStyle = C.s2;
        ctx.beginPath(); ctx.moveTo(mx, wireY - 5); ctx.lineTo(mx - 4, wireY - 12); ctx.lineTo(mx + 4, wireY - 12); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // strobe images
    var dt = strobeDt(s.t_end), tEnd = s.t_end;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var lastLabelX = -1e9;
    for (var k = 0; k * dt <= tEnd + 1e-9; k++) {
      var tk = k * dt;
      if (tk > flight.t + 1e-9) break;
      var xk = X(gridAt('x', tk)), rk = rv(gridAt('R', tk));
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = C.balloon;
      ctx.beginPath(); ctx.ellipse(xk, wireY + 5 + rk * 1.08, rk * 0.94, rk * 1.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = C.balloon; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xk, wireY - 3); ctx.lineTo(xk, wireY + 3); ctx.stroke();
      ctx.globalAlpha = 1;
      var isWhole = Math.abs(tk - Math.round(tk)) < 1e-9 && tk > 0;
      if (isWhole && xk - lastLabelX > 30) {
        ctx.fillStyle = C.muted;
        ctx.fillText(fmt(tk, 0) + ' s', xk, wireY - 17);
        lastLabelX = xk;
      }
    }
    // current balloon
    var tc = Math.min(flight.t, tEnd);
    var xc = X(gridAt('x', tc)), Rc = gridAt('R', tc), rc = rv(Rc), Tc = gridAt('T', tc), Tpk = Math.max(s.T_peak, 1e-9);
    var cy = wireY + 5 + rc * 1.08;
    ctx.fillStyle = C.ink2; ctx.fillRect(xc - 13, wireY - 3, 26, 6);
    if (Tc > 0.01 * Tpk) {
      var jl = 14 + 60 * Tc / Tpk;
      var grad = ctx.createLinearGradient(xc - rc * 0.94 - 6, 0, xc - rc * 0.94 - 6 - jl, 0);
      grad.addColorStop(0, C.jet); grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(xc - rc * 0.94 - 5, cy - 2.5);
      ctx.lineTo(xc - rc * 0.94 - 6 - jl, cy - 9);
      ctx.lineTo(xc - rc * 0.94 - 6 - jl, cy + 9);
      ctx.lineTo(xc - rc * 0.94 - 5, cy + 2.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = C.balloon;
    ctx.beginPath(); ctx.ellipse(xc, cy, rc * 0.94, rc * 1.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(xc - rc * 0.9, cy - 3); ctx.lineTo(xc - rc * 0.94 - 6, cy - 4.5); ctx.lineTo(xc - rc * 0.94 - 6, cy + 4.5); ctx.lineTo(xc - rc * 0.9, cy + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.hi; ctx.globalAlpha = 0.65;
    ctx.beginPath(); ctx.ellipse(xc - rc * 0.32, cy - rc * 0.38, rc * 0.2, rc * 0.28, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    renderReadouts(tc);
  }
  function renderReadouts(t) {
    var sim = R.sim, host = $('readouts');
    var items = [['t', fmt(t, 2) + ' s'], ['x', fmt(gridAt('x', t), 2) + ' m'], ['v', fmt(gridAt('v', t), 2) + ' m/s'],
      ['balloon Ø', fmt(2 * gridAt('R', t) * 100, 1) + ' cm'], ['ΔP', fmt(gridAt('dP', t) / 1000, 2) + ' kPa'], ['thrust', fmt(gridAt('T', t), 3) + ' N']];
    host.innerHTML = '';
    items.forEach(function (it) { host.appendChild(el('span', {}, [it[0] + ' ', el('b', { text: it[1] })])); });
    var dt = strobeDt(sim.summary.t_end);
    $('flight-note').textContent = 'Strobe view: one balloon image every ' + String(+dt.toFixed(2)) + ' s' +
      (R.run && R.run.x.length ? '; triangles mark your measured positions' : '') + '. Balloon drawn larger than scale.';
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function fmtTick(v, step) {
    var d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return fmt(v, d);
  }
  function stopFlight() {
    flight.playing = false;
    cancelAnimationFrame(flight.raf);
    var b = $('btn-play');
    if (b) { b.innerHTML = '<svg><use href="#i-play"/></svg><span>Play</span>'; b.setAttribute('aria-label', 'Play the flight'); }
  }
  function playFlight() {
    if (!R.sim) return;
    var tEnd = R.sim.summary.t_end;
    if (flight.t >= tEnd - 1e-9) flight.t = 0;
    flight.playing = true;
    flight.last = performance.now();
    var b = $('btn-play');
    b.innerHTML = '<svg><use href="#i-pause"/></svg><span>Pause</span>';
    b.setAttribute('aria-label', 'Pause the flight');
    var tick = function (now) {
      if (!flight.playing) return;
      var dtReal = Math.min((now - flight.last) / 1000, 0.1);
      flight.last = now;
      flight.t = Math.min(flight.t + dtReal * Number($('speed').value), tEnd);
      $('scrub').value = Math.round(flight.t / tEnd * 1000);
      drawFlight();
      if (flight.t >= tEnd) { stopFlight(); return; }
      flight.raf = requestAnimationFrame(tick);
    };
    flight.raf = requestAnimationFrame(tick);
  }

  /* ================================================================ */
  /* Charts (SVG)                                                     */
  /* ================================================================ */
  function niceTicks(min, max, count) {
    if (!(max > min)) max = min + 1;
    var step = niceStep((max - min) / Math.max(count, 1));
    var start = Math.ceil(min / step - 1e-9) * step, ticks = [];
    for (var v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { ticks: ticks, step: step };
  }
  function decimate(xs, ys, maxN) {
    var n = xs.length;
    if (n <= maxN) return [xs, ys];
    var stride = Math.ceil(n / maxN), ox = [], oy = [];
    for (var i = 0; i < n; i += stride) { ox.push(xs[i]); oy.push(ys[i]); }
    if (ox[ox.length - 1] !== xs[n - 1]) { ox.push(xs[n - 1]); oy.push(ys[n - 1]); }
    return [ox, oy];
  }
  function interpSeries(xs, ys, x) {
    var n = xs.length;
    if (!n) return NaN;
    if (x < xs[0] || x > xs[n - 1]) return NaN;
    return E.interp1(x, xs, ys);
  }

  /* spec: {aria, x:{label,unit,min,max,fmt}, y:{label,unit,min,max,fmt}, lines:[{name,color,x,y,dash}],
            bands:[{name,color,x,lo,hi}], points:[{name,color,x,y}], vrules:[{x,label}], hrules:[{y,label}], height, tableStep} */
  function drawLineChart(host, spec) {
    host.innerHTML = '';
    var lines = spec.lines || [], bands = spec.bands || [], points = spec.points || [];
    var items = [];
    lines.forEach(function (l) { items.push({ kind: 'line', color: l.color, name: l.name }); });
    points.forEach(function (p) { items.push({ kind: 'dot', color: p.color, name: p.name }); });
    bands.forEach(function (b) { items.push({ kind: 'band', color: b.color, name: b.name }); });
    if (items.length >= 2) {
      var lg = el('div', { class: 'chart-legend' });
      items.forEach(function (it) {
        var sw = el('i', { class: it.kind === 'dot' ? 'sw-dot' : it.kind === 'band' ? 'sw-band' : '' });
        sw.style.background = it.color;
        lg.appendChild(el('span', {}, [sw, it.name]));
      });
      host.appendChild(lg);
    }
    var wrap = el('div', { class: 'chart-wrap', tabindex: '0', role: 'img', 'aria-label': spec.aria || '' });
    host.appendChild(wrap);
    var W = Math.max(280, Math.floor(host.clientWidth || 600)), H = spec.height || 290;
    var m = { t: 24, r: 18, b: 40, l: 56 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var xs = [], ys = [];
    lines.forEach(function (l) { xs = xs.concat([l.x[0], l.x[l.x.length - 1]]); for (var i = 0; i < l.y.length; i++) if (isFinite(l.y[i])) ys.push(l.y[i]); });
    bands.forEach(function (b) { xs = xs.concat([b.x[0], b.x[b.x.length - 1]]); b.hi.forEach(function (v) { ys.push(v); }); b.lo.forEach(function (v) { ys.push(v); }); });
    points.forEach(function (p) { p.x.forEach(function (v) { xs.push(v); }); p.y.forEach(function (v) { ys.push(v); }); });
    (spec.hrules || []).forEach(function (r) { ys.push(r.y); });
    var xmin = spec.x.min !== undefined ? spec.x.min : Math.min.apply(null, xs), xmax = spec.x.max !== undefined ? spec.x.max : Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (spec.y.min !== undefined) ymin = Math.min(spec.y.min, ymin);
    if (!(ymax > ymin)) ymax = ymin + 1;
    var ystep = niceTicks(ymin, ymax, 5).step;
    if (ymin < 0) ymin = Math.floor(ymin / ystep - 1e-9) * ystep;
    ymax = Math.ceil(ymax / ystep - 1e-9) * ystep;
    if (!(ymax > ymin)) ymax = ymin + ystep;
    var yt = niceTicks(ymin, ymax, Math.round((ymax - ymin) / ystep));
    var xt = niceTicks(xmin, xmax, Math.max(3, Math.floor(pw / 80)));
    var sx = function (v) { return m.l + (v - xmin) / (xmax - xmin || 1) * pw; };
    var sy = function (v) { return m.t + ph - (v - ymin) / (ymax - ymin || 1) * ph; };
    var fx = spec.x.fmt || function (v) { return fmtTick(v, xt.step); }, fy = spec.y.fmt || function (v) { return fmtTick(v, yt.step); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">';
    yt.ticks.forEach(function (v) {
      if (v < ymin - 1e-12 || v > ymax + 1e-12) return;
      var y = Math.round(sy(v)) + 0.5;
      svg += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(' + (Math.abs(v) < 1e-12 ? '--axis' : '--grid') + ')" stroke-width="1"/>';
      svg += '<text x="' + (m.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtTick(v, yt.step) + '</text>';
    });
    xt.ticks.forEach(function (v) {
      if (v < xmin - 1e-12 || v > xmax + 1e-12) return;
      var x = Math.round(sx(v)) + 0.5;
      svg += '<line x1="' + x + '" x2="' + x + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph + 4) + '" style="stroke:var(--axis)"/>';
      svg += '<text x="' + x + '" y="' + (m.t + ph + 18) + '" text-anchor="middle">' + fmtTick(v, xt.step) + '</text>';
    });
    svg += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + (Math.round(sy(ymin)) + 0.5) + '" y2="' + (Math.round(sy(ymin)) + 0.5) + '" style="stroke:var(--axis)"/>';
    svg += '<text class="ttl" x="' + m.l + '" y="13">' + escapeXml(spec.y.label + (spec.y.unit ? ' (' + spec.y.unit + ')' : '')) + '</text>';
    svg += '<text class="ttl" x="' + (m.l + pw) + '" y="' + (H - 4) + '" text-anchor="end">' + escapeXml(spec.x.label + (spec.x.unit ? ' (' + spec.x.unit + ')' : '')) + '</text>';
    bands.forEach(function (b) {
      var d = decimate(b.x, b.hi, 600), dl = decimate(b.x, b.lo, 600);
      var path = 'M' + d[0].map(function (x, i) { return sx(x).toFixed(1) + ',' + sy(d[1][i]).toFixed(1); }).join('L');
      for (var i = dl[0].length - 1; i >= 0; i--) path += 'L' + sx(dl[0][i]).toFixed(1) + ',' + sy(dl[1][i]).toFixed(1);
      svg += '<path d="' + path + 'Z" style="fill:' + b.color + '" fill-opacity="0.16" stroke="none"/>';
    });
    (spec.hrules || []).forEach(function (r) {
      var y = Math.round(sy(r.y)) + 0.5;
      svg += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--ink-2)" stroke-width="1" stroke-dasharray="4 3"/>';
      svg += '<text class="rule-label" x="' + (m.l + 4) + '" y="' + (y - 5) + '">' + escapeXml(r.label) + '</text>';
    });
    (spec.vrules || []).forEach(function (r) {
      if (r.x < xmin || r.x > xmax) return;
      var x = Math.round(sx(r.x)) + 0.5;
      svg += '<line x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" style="stroke:var(--ink-2)" stroke-width="1" stroke-dasharray="4 3"/>';
      svg += '<text class="rule-label" x="' + (x + 5) + '" y="' + (m.t + 11) + '">' + escapeXml(r.label) + '</text>';
    });
    lines.forEach(function (l) {
      var d = decimate(l.x, l.y, 1500), path = '', pen = false;
      for (var i = 0; i < d[0].length; i++) {
        if (!isFinite(d[1][i])) { pen = false; continue; }
        path += (pen ? 'L' : 'M') + sx(d[0][i]).toFixed(1) + ',' + sy(d[1][i]).toFixed(1);
        pen = true;
      }
      svg += '<path d="' + path + '" fill="none" style="stroke:' + l.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (l.dash ? ' stroke-dasharray="6 4"' : '') + '/>';
    });
    points.forEach(function (p) {
      for (var i = 0; i < p.x.length; i++) {
        svg += '<circle cx="' + sx(p.x[i]).toFixed(1) + '" cy="' + sy(p.y[i]).toFixed(1) + '" r="4" style="fill:' + p.color + ';stroke:var(--surface)" stroke-width="2"/>';
      }
    });
    svg += '<g class="xh" style="display:none"><line y1="' + m.t + '" y2="' + (m.t + ph) + '" style="stroke:var(--ink-2)" stroke-width="1"/></g>';
    svg += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
    svg += '</svg>';
    wrap.innerHTML = svg;
    var tip = el('div', { class: 'tooltip', hidden: true });
    wrap.appendChild(tip);
    var svgEl = wrap.querySelector('svg'), xh = svgEl.querySelector('.xh'), xhLine = xh.querySelector('line');
    var dots = lines.map(function (l) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '4'); c.setAttribute('style', 'fill:' + l.color + ';stroke:var(--surface)'); c.setAttribute('stroke-width', '2');
      xh.appendChild(c);
      return c;
    });
    var curX = null;
    function show(xv) {
      xv = Math.max(xmin, Math.min(xmax, xv));
      curX = xv;
      var px = sx(xv);
      xh.style.display = '';
      xhLine.setAttribute('x1', px); xhLine.setAttribute('x2', px);
      tip.innerHTML = '';
      tip.appendChild(el('div', { class: 'tt-head', text: spec.x.label + ' ' + fx(xv) + (spec.x.unit ? ' ' + spec.x.unit : '') }));
      lines.forEach(function (l, i) {
        var yv = interpSeries(l.x, l.y, xv);
        if (isFinite(yv)) { dots[i].style.display = ''; dots[i].setAttribute('cx', px); dots[i].setAttribute('cy', sy(yv)); }
        else dots[i].style.display = 'none';
        var key = el('i'); key.style.background = l.color;
        tip.appendChild(el('div', { class: 'tt-row' }, [key, el('b', { text: isFinite(yv) ? fy(yv) + (spec.y.unit ? ' ' + spec.y.unit : '') : '–' }), el('span', { text: l.name })]));
      });
      bands.forEach(function (b) {
        var lo = interpSeries(b.x, b.lo, xv), hi = interpSeries(b.x, b.hi, xv);
        if (!isFinite(lo)) return;
        var key = el('i'); key.style.background = b.color; key.style.height = '8px'; key.style.opacity = '0.4';
        tip.appendChild(el('div', { class: 'tt-row' }, [key, el('b', { text: fy(lo) + '–' + fy(hi) }), el('span', { text: b.name })]));
      });
      points.forEach(function (p) {
        var best = -1, bd = Infinity;
        for (var i = 0; i < p.x.length; i++) { var d = Math.abs(p.x[i] - xv); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd <= (xmax - xmin) * 0.02) {
          var key = el('i'); key.style.background = p.color; key.style.height = '8px'; key.style.width = '8px'; key.style.borderRadius = '50%';
          tip.appendChild(el('div', { class: 'tt-row' }, [key, el('b', { text: fy(p.y[best]) + (spec.y.unit ? ' ' + spec.y.unit : '') }),
            el('span', { text: p.name + ' at ' + fx(p.x[best]) + (spec.x.unit ? ' ' + spec.x.unit : '') })]));
        }
      });
      tip.hidden = false;
      var scale = svgEl.getBoundingClientRect().width / W;
      var left = px * scale + 14, tw = tip.offsetWidth;
      if (left + tw > wrap.clientWidth) left = px * scale - tw - 14;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = (m.t * scale) + 'px';
    }
    function hide() { xh.style.display = 'none'; tip.hidden = true; }
    var hit = svgEl.querySelector('.hit');
    hit.addEventListener('pointermove', function (ev) {
      var rect = svgEl.getBoundingClientRect(), scale = rect.width / W;
      var px = (ev.clientX - rect.left) / scale;
      show(xmin + (px - m.l) / pw * (xmax - xmin));
    });
    hit.addEventListener('pointerleave', hide);
    wrap.addEventListener('keydown', function (ev) {
      var stepK = (xmax - xmin) / 100;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        show((curX === null ? xmin : curX) + (ev.key === 'ArrowRight' ? stepK : -stepK));
      } else if (ev.key === 'Home') { ev.preventDefault(); show(xmin); }
      else if (ev.key === 'End') { ev.preventDefault(); show(xmax); }
      else if (ev.key === 'Escape') hide();
    });
    wrap.addEventListener('blur', hide);
    // table view
    var tblWrap = el('div', { class: 'data-table-wrap', hidden: true });
    var toggle = el('button', { class: 'btn btn-quiet table-toggle', type: 'button', 'aria-expanded': 'false', text: 'Show table' });
    toggle.addEventListener('click', function () {
      var open = tblWrap.hidden;
      if (open && !tblWrap.firstChild) tblWrap.appendChild(buildTable(spec));
      tblWrap.hidden = !open;
      toggle.textContent = open ? 'Hide table' : 'Show table';
      toggle.setAttribute('aria-expanded', String(open));
    });
    host.appendChild(el('div', { class: 'btn-row', style: 'margin-top:4px' }, [toggle]));
    host.appendChild(tblWrap);
  }
  function escapeXml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function buildTable(spec) {
    var lines = spec.lines || [], bands = spec.bands || [], points = spec.points || [];
    var frag = document.createDocumentFragment();
    if (lines.length) {
      var xs0 = lines[0].x, xmaxT = xs0[xs0.length - 1], step = spec.tableStep || niceStep(xmaxT / 120);
      var tbl = el('table', { class: 'data' });
      var head = [spec.x.label + (spec.x.unit ? ' (' + spec.x.unit + ')' : '')];
      lines.forEach(function (l) { head.push(l.name + (spec.y.unit ? ' (' + spec.y.unit + ')' : '')); });
      bands.forEach(function (b) { head.push(b.name + ' low'); head.push(b.name + ' high'); });
      tbl.appendChild(el('thead', {}, [el('tr', {}, head.map(function (hh) { return el('th', { text: hh, scope: 'col' }); }))]));
      var tb = el('tbody');
      var xsList = [];
      for (var x = xs0[0]; x <= xmaxT + 1e-9; x += step) xsList.push(x);
      if (xsList[xsList.length - 1] < xmaxT - 1e-9) xsList.push(xmaxT);
      var fx = spec.x.fmt || function (v) { return fmtAuto(v); }, fy = spec.y.fmt || function (v) { return fmtAuto(v); };
      xsList.forEach(function (xv) {
        var cells = [el('td', { text: fx(xv) })];
        lines.forEach(function (l) { var yv = interpSeries(l.x, l.y, xv); cells.push(el('td', { text: isFinite(yv) ? fy(yv) : '–' })); });
        bands.forEach(function (b) { var lo = interpSeries(b.x, b.lo, xv), hi = interpSeries(b.x, b.hi, xv); cells.push(el('td', { text: isFinite(lo) ? fy(lo) : '–' })); cells.push(el('td', { text: isFinite(hi) ? fy(hi) : '–' })); });
        tb.appendChild(el('tr', {}, cells));
      });
      tbl.appendChild(tb);
      frag.appendChild(tbl);
    }
    points.forEach(function (p) {
      var t2 = el('table', { class: 'data' });
      t2.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: p.name + ': ' + spec.x.label + (spec.x.unit ? ' (' + spec.x.unit + ')' : '') }), el('th', { text: spec.y.label + (spec.y.unit ? ' (' + spec.y.unit + ')' : '') })])]));
      var tb2 = el('tbody');
      for (var i = 0; i < p.x.length; i++) tb2.appendChild(el('tr', {}, [el('td', { text: fmtAuto(p.x[i]) }), el('td', { text: fmtAuto(p.y[i]) })]));
      t2.appendChild(tb2);
      frag.appendChild(t2);
    });
    return frag;
  }

  /* Horizontal bars: items [{label, value, text}], diverging when some values are negative. */
  function drawBars(host, items, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var W = Math.max(280, Math.floor(host.clientWidth || 500)), rowH = 26, labelW = Math.min(190, Math.floor(W * 0.42)), valW = 58;
    var H = items.length * rowH + 8;
    var maxAbs = 0, hasNeg = false;
    items.forEach(function (it) { maxAbs = Math.max(maxAbs, Math.abs(it.value)); if (it.value < 0) hasNeg = true; });
    maxAbs = maxAbs || 1;
    var x0 = labelW + (hasNeg ? (W - labelW - valW * 2) / 2 + valW : 4), span = hasNeg ? (W - labelW - valW * 2) / 2 : (W - labelW - valW - 8);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escapeXml(opts.aria || '') + '">';
    svg += '<line x1="' + (x0 + 0.5) + '" x2="' + (x0 + 0.5) + '" y1="0" y2="' + H + '" style="stroke:var(--axis)"/>';
    items.forEach(function (it, i) {
      var y = 4 + i * rowH, len = Math.abs(it.value) / maxAbs * span, bh = 14, by = y + (rowH - bh) / 2 - 2;
      var neg = it.value < 0, bx = neg ? x0 - len : x0 + 1;
      var color = opts.color || (neg ? 'var(--neg)' : 'var(--s1)');
      svg += '<text x="' + (labelW - 10) + '" y="' + (y + rowH / 2 + 2) + '" text-anchor="end" style="fill:var(--ink-2)">' + escapeXml(it.label) + '</text>';
      if (len > 0.5) svg += '<rect x="' + bx.toFixed(1) + '" y="' + by + '" width="' + Math.max(len - 1, 1).toFixed(1) + '" height="' + bh + '" rx="3" style="fill:' + color + '"/>';
      var tx = neg ? bx - 6 : x0 + len + 6;
      svg += '<text x="' + tx.toFixed(1) + '" y="' + (y + rowH / 2 + 2) + '" text-anchor="' + (neg ? 'end' : 'start') + '" style="fill:var(--ink)">' + escapeXml(it.text) + '</text>';
    });
    svg += '</svg>';
    host.innerHTML = '<div class="chart-wrap">' + svg + '</div>';
  }

  /* ---------- chart tabs ---------- */
  var TABS = [
    { id: 'position', label: 'Position' }, { id: 'speed', label: 'Speed' }, { id: 'forces', label: 'Forces' },
    { id: 'pressure', label: 'Pressure' }, { id: 'size', label: 'Balloon size' }, { id: 'pv', label: 'Pressure curve' }, { id: 'momentum', label: 'Momentum budget' }
  ];
  function buildTabs() {
    var host = $('chart-tabs');
    host.innerHTML = '';
    TABS.forEach(function (t) {
      var b = el('button', { type: 'button', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(state.tab === t.id), 'aria-controls': 'chart-panel', tabindex: state.tab === t.id ? '0' : '-1', text: t.label });
      b.addEventListener('click', function () { selectTab(t.id); });
      b.addEventListener('keydown', function (ev) {
        var i = TABS.findIndex(function (x) { return x.id === state.tab; });
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          ev.preventDefault();
          var j = (i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
          selectTab(TABS[j].id);
          $('tab-' + TABS[j].id).focus();
        }
      });
      host.appendChild(b);
    });
  }
  function selectTab(id) {
    state.tab = id;
    TABS.forEach(function (t) { var b = $('tab-' + t.id); b.setAttribute('aria-selected', String(t.id === id)); b.tabIndex = t.id === id ? 0 : -1; });
    $('chart-panel').setAttribute('aria-labelledby', 'tab-' + id);
    renderChart();
    saveState();
  }

  function chartHeader(host, title, sub) {
    host.appendChild(el('div', { class: 'chart-meta' }, [el('div', {}, [el('p', { class: 'chart-title', text: title }), sub ? el('p', { class: 'chart-sub', text: sub }) : null])]));
  }

  function renderChart() {
    var panel = $('chart-panel');
    if (!R.sim) return;
    panel.innerHTML = '';
    var sim = R.sim, G = sim.grid, s = sim.summary, id = state.tab;
    var S1 = 'var(--s1)', S2 = 'var(--s2)', S3 = 'var(--s3)';
    var mc = (R.mc && !R.mcStale && state.showBand) ? R.mc : null;
    var burnRule = [{ x: s.t_burn, label: 'burnout ' + fmt(s.t_burn, 2) + ' s' }];
    var host = el('div');
    panel.appendChild(host);
    var chartHost = el('div');
    if (id === 'position') {
      chartHeader(host, 'Distance along the wire', R.run && R.run.x.length ? 'Model against your measured positions.' : 'Model prediction.');
      host.appendChild(chartHost);
      var spec = { aria: 'Distance along the wire against time', x: { label: 'Time', unit: 's', min: 0 }, y: { label: 'Distance', unit: 'm', min: 0 },
        lines: [{ name: 'Model', color: S1, x: G.t, y: G.x }], points: [], bands: [], vrules: burnRule, hrules: [] };
      if (R.run && R.run.x.length) spec.points.push({ name: isExampleRun() ? 'Measured (example data)' : 'Measured', color: S2, x: R.run.tSim, y: R.run.x });
      if (mc) spec.bands.push({ name: '95 % range', color: S1, x: mc.bands.t, lo: mc.bands.x.lo, hi: mc.bands.x.hi });
      if (isFinite(sim.p.L_wire)) spec.hrules.push({ y: sim.p.L_wire, label: 'wire end' });
      if (mc) spec.x.max = Math.max(G.t[G.t.length - 1], mc.bands.t[mc.bands.t.length - 1]);
      drawLineChart(chartHost, spec);
    } else if (id === 'speed') {
      chartHeader(host, 'Speed', 'The balloon cruises near its terminal speed, which rises as it shrinks.');
      host.appendChild(chartHost);
      var sp = { aria: 'Speed against time', x: { label: 'Time', unit: 's', min: 0 }, y: { label: 'Speed', unit: 'm/s', min: 0 },
        lines: [{ name: 'Model', color: S1, x: G.t, y: G.v }], bands: [], vrules: burnRule };
      if (mc) { sp.bands.push({ name: '95 % range', color: S1, x: mc.bands.t, lo: mc.bands.v.lo, hi: mc.bands.v.hi }); sp.x.max = Math.max(G.t[G.t.length - 1], mc.bands.t[mc.bands.t.length - 1]); }
      drawLineChart(chartHost, sp);
    } else if (id === 'forces') {
      var wireF = G.Ff.map(function (f, i) { return f + G.Fg[i]; });
      var hasSlope = sim.p.theta_deg !== 0;
      chartHeader(host, 'Forces along the wire', 'Thrust along the wire, air drag, and ' + (hasSlope ? 'wire friction plus the slope component of weight.' : 'wire friction.'));
      host.appendChild(chartHost);
      drawLineChart(chartHost, { aria: 'Thrust, drag and wire force against time', x: { label: 'Time', unit: 's', min: 0 }, y: { label: 'Force', unit: 'N', min: 0, fmt: function (v) { return fmt(v, 3); } },
        lines: [{ name: 'Thrust', color: S1, x: G.t, y: G.Tax }, { name: 'Drag', color: S2, x: G.t, y: G.D },
          { name: hasSlope ? 'Friction + slope' : 'Wire friction', color: S3, x: G.t, y: wireF }], vrules: burnRule });
    } else if (id === 'pressure') {
      chartHeader(host, 'Gauge pressure inside the balloon', 'Set by the rubber; the thrust follows it closely.');
      host.appendChild(chartHost);
      drawLineChart(chartHost, { aria: 'Gauge pressure against time', x: { label: 'Time', unit: 's', min: 0 }, y: { label: 'Gauge pressure', unit: 'kPa', min: 0, fmt: function (v) { return fmt(v, 2); } },
        lines: [{ name: 'Gauge pressure', color: S1, x: G.t, y: G.dP.map(function (v) { return v / 1000; }) }], vrules: burnRule });
    } else if (id === 'size') {
      chartHeader(host, 'Balloon diameter', 'Equal-volume sphere diameter as the balloon empties.');
      host.appendChild(chartHost);
      drawLineChart(chartHost, { aria: 'Balloon diameter against time', x: { label: 'Time', unit: 's', min: 0 }, y: { label: 'Diameter', unit: 'cm', min: 0, fmt: function (v) { return fmt(v, 1); } },
        lines: [{ name: 'Diameter', color: S1, x: G.t, y: G.R.map(function (r) { return 200 * r; }) }], vrules: burnRule });
    } else if (id === 'pv') {
      var tab = sim.tab, n = tab.n, stride = Math.max(1, Math.floor(n / 400)), Vx = [], Py = [];
      for (var i = 0; i < n; i += stride) { Vx.push(tab.V[i] * 1000); Py.push(tab.dP[i] / 1000); }
      Vx.push(tab.V[n - 1] * 1000); Py.push(tab.dP[n - 1] / 1000);
      var modelName = { mr: 'Mooney–Rivlin', gent: 'Gent', measured: 'Measured curve (as used)' }[sim.p.membrane];
      chartHeader(host, 'Pressure–volume curve', 'Gauge pressure against balloon volume; the flight runs from right to left.');
      host.appendChild(chartHost);
      var pvSpec = { aria: 'Gauge pressure against balloon volume', height: 290, x: { label: 'Volume', unit: 'L', min: 0, fmt: function (v) { return fmt(v, 2); } },
        y: { label: 'Gauge pressure', unit: 'kPa', min: 0, fmt: function (v) { return fmt(v, 2); } },
        lines: [{ name: modelName, color: S1, x: Vx, y: Py }], points: [], vrules: [{ x: tab.V[n - 1] * 1000, label: 'release' }] };
      var pvp = E.parsePV(state.inputs.pv_text, state.inputs.pv_size_unit, state.inputs.pv_p_unit, sim.p.R0);
      if (pvp.raw.V.length) pvSpec.points.push({ name: isExampleValue('pv_text') ? 'Measured points (example data)' : 'Measured points', color: S2,
        x: pvp.raw.V.map(function (v) { return v * 1000; }), y: pvp.raw.dP.map(function (v) { return v / 1000; }) });
      pvSpec.tableStep = niceStep(Vx[Vx.length - 1] / 60);
      drawLineChart(chartHost, pvSpec);
    } else if (id === 'momentum') {
      renderMomentum(host);
    }
  }

  function renderMomentum(host) {
    var b = R.sim.budget, sim = R.sim;
    chartHeader(host, 'Where the thrust impulse goes', 'Thrust along the wire delivers ' + fmt(b.thrust, 4) + ' N·s. Everything it pays for is listed below; the budget closes to ' + fmt(Math.abs(b.relResidual) * 100, 3) + ' %.');
    var parts = [
      { key: 'drag', label: 'Air drag', v: b.drag, color: 'var(--s1)' },
      { key: 'exhaust', label: 'Forward momentum carried off in the exhaust', v: b.exhaust, color: 'var(--s2)' },
      { key: 'friction', label: 'Wire friction', v: b.friction, color: 'var(--s3)' }
    ];
    if (Math.abs(b.gravity) > 1e-9) parts.push({ key: 'gravity', label: 'Slope (weight along the wire)', v: b.gravity, color: 'var(--s4, #eda100)' });
    if (Math.abs(b.final) > 1e-9) parts.push({ key: 'final', label: 'Momentum left at the wire end', v: b.final, color: 'var(--s5, #e87ba4)' });
    if (Math.abs(b.amLost) > 1e-9) parts.push({ key: 'amLost', label: 'Added-mass momentum not recovered', v: b.amLost, color: 'var(--s6, #008300)' });
    var W = Math.max(280, Math.floor(host.clientWidth || 600)), H = 44, total = parts.reduce(function (a, p) { return a + Math.max(p.v, 0); }, 0) || 1;
    var legend = el('div', { class: 'chart-legend' });
    parts.forEach(function (p) { var sw = el('i', { class: 'sw-rect' }); sw.style.background = p.color; legend.appendChild(el('span', {}, [sw, p.label])); });
    host.appendChild(legend);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Stacked bar of the momentum budget">';
    var x = 0;
    parts.forEach(function (p) {
      var w = Math.max(p.v, 0) / total * W;
      if (w > 0.5) svg += '<rect x="' + x.toFixed(1) + '" y="8" width="' + Math.max(w - 2, 1).toFixed(1) + '" height="24" rx="3" style="fill:' + p.color + '"/>';
      x += w;
    });
    svg += '</svg>';
    host.appendChild(el('div', { class: 'chart-wrap', html: svg }));
    var tbl = el('table', { class: 'data' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, ['Destination', 'Impulse (N·s)', 'Share of thrust'].map(function (hh) { return el('th', { text: hh, scope: 'col' }); }))]));
    var tb = el('tbody');
    parts.forEach(function (p) { tb.appendChild(el('tr', {}, [el('td', { class: 'txt', text: p.label }), el('td', { text: fmt(p.v, 4) }), el('td', { text: fmt(p.v / b.thrust * 100, 1) + ' %' })])); });
    tb.appendChild(el('tr', {}, [el('td', { class: 'txt', text: 'Thrust impulse along the wire' }), el('td', { text: fmt(b.thrust, 4) }), el('td', { text: '100 %' })]));
    tb.appendChild(el('tr', {}, [el('td', { class: 'txt', text: 'Unaccounted (numerical error)' }), el('td', { text: b.residual.toExponential(1) }), el('td', { text: fmt(b.relResidual * 100, 4) + ' %' })]));
    tbl.appendChild(tb);
    host.appendChild(el('div', { class: 'data-table-wrap' }, [tbl]));
    host.appendChild(el('p', { class: 'note muted', style: 'margin-top:8px', text: 'Added-mass recovery returned ' + fmt(b.amr, 4) + ' N·s during the burn; over a flight that ends at rest the added-mass force nets to zero.' }));
    void sim;
  }

  /* ================================================================ */
  /* Measured run and calibration                                     */
  /* ================================================================ */
  function isExampleRun() { return String(state.run.text).trim() === EXAMPLE_RUN.trim(); }
  function renderRunStatus() {
    var st = $('run-status'), run = R.run, sim = R.sim;
    if (!run || run.t.length === 0) { st.textContent = 'No measured positions yet. Paste rows of time and distance, e.g. from Tracker or a frame-by-frame video.'; return; }
    if (run.t.length < 3) { st.textContent = 'Enter at least three rows to compare and fit.'; return; }
    var rmse = null;
    if (sim) {
      var ss = 0;
      for (var i = 0; i < run.t.length; i++) { var ts = run.tSim[i]; var xs = ts <= 0 ? 0 : sim.xAt(ts); ss += (xs - run.x[i]) * (xs - run.x[i]); }
      rmse = Math.sqrt(ss / run.t.length);
    }
    st.textContent = (isExampleRun() ? 'Example data (synthetic video track). ' : '') + run.t.length + ' points from ' + fmt(run.t[0], 2) + ' to ' + fmt(run.t[run.t.length - 1], 2) +
      ' s, reaching ' + fmt(Math.max.apply(null, run.x), 2) + ' m. Current model misses them by ' + (rmse === null ? '–' : (rmse < 1 ? fmt(rmse * 100, 1) + ' cm' : fmt(rmse, 2) + ' m')) + ' (root-mean-square).';
  }

  function buildFitKeys() {
    var host = $('fitkeys');
    host.innerHTML = '';
    FIT_KEYS.forEach(function (f) {
      var id = 'fit-' + f.key, cb = el('input', { type: 'checkbox', id: id });
      cb.checked = state.fitKeys.indexOf(f.key) >= 0;
      cb.addEventListener('change', function () {
        state.fitKeys = FIT_KEYS.map(function (x) { return x.key; }).filter(function (k) { var c = $('fit-' + k); return c && c.checked; });
        saveState();
      });
      host.appendChild(el('label', { class: 'check', for: id }, [cb, el('span', { html: f.label + (f.small ? '<small>' + f.small + '</small>' : '') })]));
    });
  }

  function fitParamValue(key, conv) {
    if (key === 't0') return Number(state.run.t0) || 0;
    return conv.p[key];
  }
  function fmtFitVal(key, v) {
    if (key === 'CdA_min') return fmt(v * 1e4, 2) + ' cm²';
    if (key === 't0') return fmt(v, 3) + ' s';
    return fmt(v, 4);
  }

  function runFit() {
    var conv = R.conv, run = R.run;
    if (!conv || conv.errors.length || !R.sim) { toast('Fix the inputs first.'); return; }
    if (!run || run.t.length < 3) { toast('Enter at least three measured positions.'); return; }
    var keys = state.fitKeys.slice();
    if (!keys.length) { toast('Choose at least one value to fit.'); return; }
    if (run.t.length <= keys.length + 1) { toast('Fitting ' + keys.length + ' values needs more than ' + (keys.length + 1) + ' points.'); return; }
    var data = { t: run.t.map(function (t) { return t - (Number(state.run.t0) || 0); }), x: run.x };
    var before = {};
    keys.forEach(function (k) { before[k] = fitParamValue(k, conv); });
    var btn = $('btn-fit'), prog = $('fit-progress');
    btn.disabled = true; prog.hidden = false; prog.firstChild.style.width = '4%';
    $('fit-status').textContent = 'Fitting…';
    var limit = 150 * keys.length;
    runTask('fit', { p: stripP(conv.p), data: data, keys: keys }, function (msg) {
      var pct = Math.min(96, 4 + 92 * (msg.done || 0) / limit);
      prog.firstChild.style.width = pct + '%';
      $('fit-status').textContent = 'Fitting… ' + (msg.done || 0) + ' simulations';
    }).then(function (res) {
      res.beforeVals = before;
      res.t0base = Number(state.run.t0) || 0;
      R.fit = res; R.fitStale = false;
      renderFitResult();
      $('btn-apply-fit').hidden = false;
      $('fit-status').textContent = 'Done in ' + res.evals + ' simulations.';
    }).catch(function (e) {
      $('fit-status').textContent = 'The fit failed: ' + (e && e.message ? e.message : e);
    }).then(function () { btn.disabled = false; prog.hidden = true; });
  }

  function stripP(p) {
    var o = {}, k;
    for (k in p) if (k !== 'pvInfo') o[k] = p[k];
    if (o.L_wire === Infinity) o.L_wire = Infinity;
    return o;
  }

  function renderFitResult() {
    var host = $('fit-result');
    host.innerHTML = '';
    var f = R.fit;
    if (!f) return;
    if (R.fitStale) host.appendChild(el('p', { class: 'note muted', text: 'Inputs changed since this fit; the table shows the fit as it was run.' }));
    var tbl = el('table', { class: 'data' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, ['Value', 'Before', 'Fitted', '± 1 SD'].map(function (hh) { return el('th', { text: hh, scope: 'col' }); }))]));
    var tb = el('tbody');
    f.keys.forEach(function (k, i) {
      var spec = FIT_KEYS.filter(function (x) { return x.key === k; })[0];
      var nameCell = el('td', { class: 'txt', html: spec ? spec.label : k });
      var bv = f.beforeVals[k], fv = k === 't0' ? f.values.t0 + f.t0base : f.values[k];
      var se = f.se ? f.se[i] : null;
      tb.appendChild(el('tr', {}, [nameCell, el('td', { text: fmtFitVal(k, bv) }), el('td', { text: fmtFitVal(k, fv) }),
        el('td', { text: se === null ? '–' : (k === 'CdA_min' ? fmt(se * 1e4, 2) + ' cm²' : k === 't0' ? fmt(se, 3) + ' s' : fmt(se, 4)) })]));
    });
    tbl.appendChild(tb);
    host.appendChild(el('div', { class: 'data-table-wrap', style: 'margin-top:4px' }, [tbl]));
    var rm = function (v) { return v < 1 ? fmt(v * 100, 1) + ' cm' : fmt(v, 2) + ' m'; };
    host.appendChild(el('div', { class: 'metric-row', style: 'margin-top:8px' }, [
      el('span', {}, ['RMS miss ', el('b', { text: rm(f.rmse) }), ' (was ' + rm(f.rmse0) + ')']),
      el('span', {}, ['R² ', el('b', { text: f.r2 === null ? '–' : fmt(f.r2, 5) })]),
      el('span', {}, [el('b', { text: String(f.n) }), ' points, ' + f.keys.length + ' fitted'])
    ]));
    var notes = [];
    if (f.corr) {
      for (var a = 0; a < f.keys.length; a++) for (var b = a + 1; b < f.keys.length; b++) {
        var r = f.corr[a][b];
        if (Math.abs(r) >= 0.95) notes.push({ st: 'warn', text: capital(nameOf(f.keys[a])) + ' and ' + nameOf(f.keys[b]) + ' are strongly correlated in this fit (r = ' + fmt(r, 2) + '). The run pins down a combination of them better than each one; add a coast phase or a separate measurement to separate them.' });
      }
    } else notes.push({ st: 'warn', text: 'The fit could not estimate uncertainties: the data barely constrain at least one of the chosen values.' });
    if (!f.converged) notes.push({ st: 'warn', text: 'The optimiser stopped at its iteration limit; the result may not be the best fit. Try fitting fewer values.' });
    if (f.se) f.keys.forEach(function (k, i) {
      var v = k === 't0' ? null : f.values[k];
      if (v !== null && f.se[i] > 0.5 * Math.abs(v)) notes.push({ st: 'warn', text: capital(nameOf(k)) + ' is poorly determined (± ' + fmt(f.se[i] / Math.abs(v) * 100, 0) + ' %).' });
    });
    var resid = f.residuals.r.map(function (v) { return v * 100; });
    var runs = 1;
    for (var i2 = 1; i2 < resid.length; i2++) if ((resid[i2] > 0) !== (resid[i2 - 1] > 0)) runs++;
    var npos = resid.filter(function (v) { return v > 0; }).length, nneg = resid.length - npos;
    if (npos > 1 && nneg > 1) {
      var mu = 2 * npos * nneg / (npos + nneg) + 1, varr = (mu - 1) * (mu - 2) / (npos + nneg - 1), z = (runs - mu) / Math.sqrt(varr || 1);
      if (z < -2.5) notes.push({ st: 'warn', text: 'The misses run in long same-sign streaks (' + runs + ' sign changes where about ' + fmt(mu, 0) + ' are expected), so the model shape does not fully match your run. Check the drag, the rubber curve and the release time.' });
      else notes.push({ st: 'pass', text: 'The misses change sign about as often as random noise would (' + runs + ' runs, about ' + fmt(mu, 0) + ' expected), so no systematic misfit shows.' });
    }
    notes.forEach(function (nt) { host.appendChild(el('div', { class: 'callout', style: 'margin-top:8px', html: svgUse('i-' + nt.st) + '<span></span>' })); host.lastChild.querySelector('span').textContent = nt.text; });
    var rh = el('div', { style: 'margin-top:10px' });
    host.appendChild(el('p', { class: 'chart-title', style: 'margin-top:12px', text: 'Misses after the fit' }));
    host.appendChild(rh);
    requestAnimationFrame(function () {
      drawLineChart(rh, { aria: 'Fit residuals against time', height: 200, x: { label: 'Time', unit: 's' }, y: { label: 'Model − measured', unit: 'cm', fmt: function (v) { return fmt(v, 1); } },
        lines: [], points: [{ name: 'Miss at each measured point', color: 'var(--s2)', x: f.residuals.t, y: resid }], hrules: [{ y: 0, label: '' }] });
    });
  }
  var PLAIN = { C_D: 'the drag coefficient', mu_k: 'the kinetic friction', CdA_min: 'the minimum drag area', Cv: 'the velocity coefficient', Cd: 'the discharge coefficient', t0: 'the release time' };
  function nameOf(k) { return PLAIN[k] || k; }
  function capital(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  function applyFit() {
    var f = R.fit;
    if (!f) return;
    f.keys.forEach(function (k) {
      if (k === 't0') { state.run.t0 = Math.round((f.values.t0 + f.t0base) * 1000) / 1000; $('run-t0').value = state.run.t0; return; }
      var formKey = k === 'CdA_min' ? 'CdA_cm2' : k, v = f.values[k];
      if (k === 'CdA_min') v = v * 1e4;
      var str = String(Number(v.toPrecision(4)));
      state.inputs[formKey] = str;
      if (fieldEls[formKey]) fieldEls[formKey].input.value = str;
      markSet(formKey);
      if (k === 'mu_k' && Number(state.inputs.mu_s) < v) { state.inputs.mu_s = str; fieldEls.mu_s.input.value = str; markSet('mu_s'); }
    });
    updateTallies();
    saveState();
    recompute();
    R.fitStale = false;
    renderFitResult();
    toast('Fitted values applied to your measurements.');
  }

  /* ================================================================ */
  /* Pressure-curve fits                                              */
  /* ================================================================ */
  function fitCurve(model) {
    var conv = R.conv, host = $('pv-fit-result');
    var R0 = Number(state.inputs.d0_mm) / 2000, w0 = Number(state.inputs.wall_mm) / 1000;
    host.innerHTML = '';
    if (!(R0 > 0 && w0 > 0)) { host.textContent = 'Enter the unstretched diameter and wall thickness first.'; return; }
    var pv = E.parsePV(state.inputs.pv_text, state.inputs.pv_size_unit, state.inputs.pv_p_unit, R0);
    var res = model === 'mr' ? E.fitMR(pv.raw, R0, w0) : E.fitGent(pv.raw, R0, w0, { mu: Number(state.inputs.mu_kPa) * 1000, Jm: Number(state.inputs.Jm) });
    if (!res) { host.textContent = 'Need at least three points above the unstretched size to fit.'; return; }
    var text, apply;
    if (model === 'mr') {
      text = 'Mooney–Rivlin fit: C₁ = ' + fmt(res.C1 / 1000, 1) + ' kPa, C₂ = ' + fmt(res.C2 / 1000, 2) + ' kPa; RMS miss ' + fmt(res.rmse / 1000, 3) + ' kPa, R² ' + fmt(res.r2, 4) + ' on ' + res.n + ' points.';
      if (res.C2 < 0) text += ' C₂ came out negative, which Mooney–Rivlin allows but real latex rarely shows; the Gent law may suit this curve better.';
      apply = function () { setInputs({ membrane: 'mr', C1_kPa: String(Number((res.C1 / 1000).toPrecision(4))), C2_kPa: String(Number((res.C2 / 1000).toPrecision(4))) }); };
    } else {
      text = 'Gent fit: μ = ' + fmt(res.mu / 1000, 1) + ' kPa, J_m = ' + fmt(res.Jm, 1) + '; RMS miss ' + fmt(res.rmse / 1000, 3) + ' kPa, R² ' + fmt(res.r2, 4) + ' on ' + res.n + ' points.';
      apply = function () { setInputs({ membrane: 'gent', mu_kPa: String(Number((res.mu / 1000).toPrecision(4))), Jm: String(Number(res.Jm.toPrecision(4))) }); };
    }
    host.appendChild(el('p', { class: 'note', text: text }));
    if (res.r2 !== null && res.r2 < 0.9) host.appendChild(el('div', { class: 'callout', style: 'margin:6px 0', html: svgUse('i-warn') + '<span>This law does not describe your curve well: its best fit misses by more than the spread of your readings. Use the measured curve directly, or try the other law.</span>' }));
    host.appendChild(el('button', { class: 'btn', type: 'button', text: model === 'mr' ? 'Use in the Mooney–Rivlin model' : 'Use in the Gent model', onclick: apply }));
    void conv;
  }
  function setInputs(obj) {
    Object.keys(obj).forEach(function (k) {
      state.inputs[k] = obj[k];
      if (fieldEls[k] && fieldEls[k].input && fieldEls[k].input.tagName !== 'DIV') fieldEls[k].input.value = obj[k];
      markSet(k);
    });
    syncMembraneUI();
    updateTallies();
    saveState();
    recompute();
    toast('Pressure model updated.');
  }

  /* ================================================================ */
  /* Uncertainty (Monte Carlo) and sensitivity                        */
  /* ================================================================ */
  function uncRowsForMode() {
    var m = state.inputs.membrane;
    return UNC_ROWS.filter(function (u) { return !u.mode || u.mode === m; });
  }
  function renderUncTable() {
    var tbl = $('unc-table');
    if (!tbl) return;
    tbl.innerHTML = '';
    tbl.appendChild(el('thead', {}, [el('tr', {}, ['Measurement', 'Value', '± 1 SD'].map(function (hh) { return el('th', { text: hh, scope: 'col' }); }))]));
    var tb = el('tbody');
    uncRowsForMode().forEach(function (u) {
      var id = 'unc-' + u.key, inp = el('input', { id: id, type: 'number', step: 'any', min: '0', 'aria-label': 'Uncertainty of ' + u.label });
      inp.value = state.unc[u.key];
      inp.addEventListener('input', function () { var v = Number(inp.value); state.unc[u.key] = isFinite(v) && v >= 0 ? v : 0; saveState(); });
      var val = u.key === 'pv_scale' ? '1' : String(state.inputs[u.key]);
      var unit = u.key === 'infl_cm' ? 'cm' : u.unit;
      var lab = (u.key === 'infl_cm' ? (state.inputs.infl_mode === 'circumference' ? 'Inflated circumference' : 'Inflated diameter') : u.label) + (unit ? ' (' + unit + ')' : '');
      tb.appendChild(el('tr', {}, [el('td', { class: 'txt' }, [el('label', { for: id, text: lab })]), el('td', { text: val }), el('td', {}, [inp])]));
    });
    tbl.appendChild(tb);
  }

  function runMC() {
    var conv = R.conv;
    if (!conv || conv.errors.length) { toast('Fix the inputs first.'); return; }
    var unc = uncRowsForMode().filter(function (u) { return state.unc[u.key] > 0; }).map(function (u) {
      return { key: u.key, sd: state.unc[u.key], positive: !u.signed, max: u.max };
    });
    if (!unc.length) { toast('Give at least one measurement a non-zero uncertainty.'); return; }
    var N = Number($('mc-n').value) || 300, seed = Math.floor(Number($('mc-seed').value) || 1);
    state.mcN = N; state.seed = seed; saveState();
    var inputs = Object.assign({}, state.inputs, { pv_scale: 1 });
    var btn = $('btn-mc'), prog = $('mc-progress');
    btn.disabled = true; prog.hidden = false; prog.firstChild.style.width = '2%';
    runTask('mc', { inputs: inputs, unc: unc, N: N, seed: seed }, function (msg) {
      prog.firstChild.style.width = Math.min(98, 100 * (msg.done || 0) / (msg.total || N)) + '%';
    }).then(function (res) {
      R.mc = res; R.mcStale = false;
      renderMcResult(); renderKPIs(); renderChart();
    }).catch(function (e) { toast('Uncertainty analysis failed: ' + (e && e.message ? e.message : e)); })
      .then(function () { btn.disabled = false; prog.hidden = true; });
  }

  function renderMcResult() {
    var host = $('mc-result');
    if (!host) return;
    host.innerHTML = '';
    if (!R.mc && !R.sens) { host.appendChild(el('p', { class: 'note muted', text: 'Results appear here: the 95 % range of each output and which uncertainties drive it.' })); return; }
    if (R.mc) {
      var mc = R.mc;
      if (R.mcStale) host.appendChild(el('div', { class: 'callout', html: svgUse('i-info') + '<span>Inputs changed since this analysis; rerun it to update the ranges. The bands are hidden until then.</span>' }));
      host.appendChild(el('p', { class: 'chart-title', text: 'Spread of the prediction (' + mc.used + ' runs' + (mc.failures ? ', ' + mc.failures + ' invalid draws skipped' : '') + ', seed ' + mc.seed + ')' }));
      var tbl = el('table', { class: 'data' });
      tbl.appendChild(el('thead', {}, [el('tr', {}, ['Output', 'Median', '95 % range', 'Mean ± SD'].map(function (hh) { return el('th', { text: hh, scope: 'col' }); }))]));
      var tb = el('tbody');
      [['x_end', 'Final distance', 'm', 2], ['v_max', 'Peak speed', 'm/s', 2], ['t_burn', 'Burn time', 's', 2], ['t_end', 'Run time', 's', 2]].forEach(function (r) {
        var st = mc.stats[r[0]];
        tb.appendChild(el('tr', {}, [el('td', { class: 'txt', text: r[1] + ' (' + r[2] + ')' }), el('td', { text: fmt(st.p50, r[3]) }),
          el('td', { text: fmt(st.p025, r[3]) + '–' + fmt(st.p975, r[3]) }), el('td', { text: fmt(st.mean, r[3]) + ' ± ' + fmt(st.sd, r[3]) })]));
      });
      tbl.appendChild(tb);
      host.appendChild(el('div', { class: 'data-table-wrap', style: 'max-height:none' }, [tbl]));
      host.appendChild(el('p', { class: 'chart-title', style: 'margin-top:10px', text: 'What drives the spread in final distance' }));
      host.appendChild(el('p', { class: 'note muted', text: 'Approximate share of the variance, from the squared correlation of each input with the output.' }));
      var bh = el('div');
      host.appendChild(bh);
      var items = mc.shares.x_end.filter(function (s) { return s.share > 0.001; }).slice(0, 8).map(function (s) {
        return { label: UNC_LABEL[s.key] || s.key, value: s.share * 100, text: fmt(s.share * 100, 0) + ' %' };
      });
      requestAnimationFrame(function () { drawBars(bh, items, { color: 'var(--s1)', aria: 'Share of variance in final distance by input' }); });
    }
    if (R.sens) {
      var sens = R.sens;
      host.appendChild(el('p', { class: 'chart-title', style: 'margin-top:12px', text: 'Local sensitivity of final distance' }));
      if (R.sensStale) host.appendChild(el('p', { class: 'note muted', text: 'Inputs changed since this was computed.' }));
      host.appendChild(el('p', { class: 'note muted', text: 'Elasticity: % change in final distance for a 1 % increase in each input (central difference, ±5 %). Blue raises the distance, red lowers it.' }));
      var th = el('div');
      host.appendChild(th);
      var rows = sens.rows.filter(function (r) { return r.el.x_end !== null; }).sort(function (a, b) { return Math.abs(b.el.x_end) - Math.abs(a.el.x_end); });
      var items2 = rows.map(function (r) { return { label: sensLabel(r.key), value: r.el.x_end, text: (r.el.x_end >= 0 ? '+' : '') + fmt(r.el.x_end, 2) }; });
      requestAnimationFrame(function () { drawBars(th, items2, { aria: 'Elasticity of final distance by input' }); });
      host.appendChild(el('p', { class: 'chart-title', style: 'margin-top:12px', text: 'Local sensitivity of peak speed' }));
      var th2 = el('div');
      host.appendChild(th2);
      var rows2 = sens.rows.filter(function (r) { return r.el.v_max !== null; }).sort(function (a, b) { return Math.abs(b.el.v_max) - Math.abs(a.el.v_max); });
      var items3 = rows2.map(function (r) { return { label: sensLabel(r.key), value: r.el.v_max, text: (r.el.v_max >= 0 ? '+' : '') + fmt(r.el.v_max, 2) }; });
      requestAnimationFrame(function () { drawBars(th2, items3, { aria: 'Elasticity of peak speed by input' }); });
    }
  }
  function sensLabel(k) {
    var map = { mass_g: 'Empty mass', d0_mm: 'Unstretched diameter', wall_mm: 'Wall thickness', infl_cm: 'Inflated size', nozzle_mm: 'Exit diameter',
      Cd: 'C_d', Cv: 'C_v', C_D: 'Drag coefficient', CdA_cm2: 'Min. drag area', C_add: 'Added-mass coef.', mu_k: 'Kinetic friction',
      C1_kPa: 'C₁', C2_kPa: 'C₂', mu_kPa: 'Shear modulus μ', Jm: 'Locking limit J_m' };
    return map[k] || k;
  }
  function runSens() {
    var conv = R.conv;
    if (!conv || conv.errors.length) { toast('Fix the inputs first.'); return; }
    var keys = SENS_KEYS_BASE.slice();
    if (state.inputs.membrane === 'mr') keys.push('C1_kPa', 'C2_kPa');
    if (state.inputs.membrane === 'gent') keys.push('mu_kPa', 'Jm');
    var btn = $('btn-sens'), prog = $('mc-progress');
    btn.disabled = true; prog.hidden = false; prog.firstChild.style.width = '2%';
    runTask('sens', { inputs: state.inputs, keys: keys }, function (msg) {
      prog.firstChild.style.width = Math.min(98, 100 * (msg.done || 0) / (msg.total || keys.length)) + '%';
    }).then(function (res) { R.sens = res; R.sensStale = false; renderMcResult(); })
      .catch(function (e) { toast('Sensitivity failed: ' + (e && e.message ? e.message : e)); })
      .then(function () { btn.disabled = false; prog.hidden = true; });
  }

  /* ================================================================ */
  /* Model checks                                                     */
  /* ================================================================ */
  function buildChecks() {
    var out = [], conv = R.conv, sim = R.sim;
    if (R.errors && R.errors.length) {
      R.errors.forEach(function (e) { out.push({ status: 'fail', title: 'Input problem', detail: e.msg }); });
      return out;
    }
    if (!sim) return out;
    var p = sim.p, d = sim.diag, s = sim.summary;
    out.push({ status: 'pass', title: 'Nozzle losses are consistent', detail: 'Contraction coefficient C_d/C_v = ' + fmt(p.Cd / p.Cv, 2) + ' (must not exceed 1); thrust factor C_d·C_v = ' + fmt(p.Cd * p.Cv, 2) + '.' });
    if (d.choked) out.push({ status: 'fail', title: 'The jet would choke', detail: 'The balloon pressure exceeds the choking ratio (' + fmt(d.pcritRatio, 3) + '), where the subsonic thrust formula no longer applies.' });
    else out.push({ status: 'pass', title: 'Jet stays subsonic', detail: 'Peak balloon pressure is ' + fmt((d.PbRatioMax - 1) * 100, 1) + ' % above room pressure; choking needs ' + fmt((d.pcritRatio - 1) * 100, 0) + ' %. Exit Mach number up to ' + fmt(d.MeMax, 2) + ', so exit pressure equals room pressure and there is no pressure thrust.' });
    out.push(d.thinWall <= 0.1 ? { status: 'pass', title: 'Thin-wall membrane assumption holds', detail: 'Wall thickness is ' + fmt(d.thinWall * 100, 1) + ' % of the radius before inflation, and thinner still when inflated.' }
      : { status: 'warn', title: 'Wall is thick for a membrane model', detail: 'H₀/R₀ = ' + fmt(d.thinWall, 2) + '; the thin-shell pressure law loses accuracy above about 0.1.' });
    if (p.membrane === 'mr') {
      if (d.lam0 > 4) out.push({ status: 'warn', title: 'Mooney–Rivlin is stretched past its usual range', detail: 'Release stretch λ₀ = ' + fmt(d.lam0, 2) + '. Mooney–Rivlin is usually fitted to λ ≈ 3–4; real latex stiffens beyond that and deflates along a lower curve (hysteresis). Use the Gent law or, better, a measured deflation curve.' });
      else out.push({ status: 'pass', title: 'Stretch within the Mooney–Rivlin range', detail: 'Release stretch λ₀ = ' + fmt(d.lam0, 2) + '.' });
    } else if (p.membrane === 'gent') {
      out.push(d.gentFraction < 0.9 ? { status: 'pass', title: 'Gent law away from its locking limit', detail: '(I₁ − 3)/J_m = ' + fmt(d.gentFraction, 2) + ' at release (must stay below 1).' }
        : { status: 'warn', title: 'Gent law close to its locking limit', detail: '(I₁ − 3)/J_m = ' + fmt(d.gentFraction, 2) + ' at release; the pressure rises very steeply there, so small errors in J_m matter a lot.' });
    } else {
      var info = conv.p.pvInfo;
      out.push({ status: 'pass', title: 'Using your measured pressure curve', detail: (info ? info.raw.V.length : 0) + ' measured points, linearly interpolated' + (info && info.notes.indexOf('added') >= 0 ? ', with a zero-pressure point added at the unstretched size' : '') + '.' });
      if (conv.warnings.some(function (w) { return w.key === 'infl_cm'; })) out.push({ status: 'warn', title: 'Inflated size is beyond the measured curve', detail: 'The run starts from the largest measured point instead of your inflated size.' });
    }
    out.push(d.ReMax < 2e5 ? { status: 'pass', title: 'Drag regime is steady', detail: 'Reynolds number stays below ' + fmtSci(Math.max(d.ReMax, 1), 1) + ', under the drag crisis near 3 × 10⁵, so a constant drag coefficient is reasonable.' }
      : { status: 'warn', title: 'Near the drag crisis', detail: 'Reynolds number reaches ' + fmtSci(d.ReMax, 1) + '; a smooth sphere\'s drag can drop sharply near 3 × 10⁵, so C_D may not be constant.' });
    if (!d.startsMoving) out.push({ status: 'fail', title: 'The balloon never starts', detail: 'Thrust along the wire at release (' + fmt(d.drive0, 3) + ' N) does not beat static friction (' + fmt(d.staticLimit, 4) + ' N) plus the slope.' });
    else out.push({ status: 'pass', title: 'The balloon starts moving', detail: 'Driving force at release ' + fmt(d.drive0, 3) + ' N against a static friction limit of ' + fmt(d.staticLimit, 4) + ' N.' });
    if (s.endedBy === 'time') out.push({ status: 'warn', title: 'Run hit the time limit', detail: 'The balloon was still moving at ' + fmt(s.t_end, 0) + ' s; raise the time limit in Simulation settings.' });
    else if (s.endedBy === 'wire') out.push({ status: 'info', title: 'Run ended at the wire end', detail: 'The balloon reached the end of the usable wire at ' + fmt(s.t_end, 2) + ' s, moving at ' + fmt(s.v_end, 2) + ' m/s.' });
    else if (s.endedBy === 'steplimit') out.push({ status: 'fail', title: 'Solver step limit reached', detail: 'The integrator could not finish; check for extreme inputs.' });
    else out.push({ status: 'pass', title: 'Run finished cleanly', detail: 'The balloon ' + (s.endedBy === 'never_moved' ? 'never moved' : 'stopped at ' + fmt(s.x_end, 2) + ' m after ' + fmt(s.t_end, 2) + ' s') + '.' });
    var rel = Math.abs(sim.budget.relResidual);
    out.push(rel < 0.005 ? { status: 'pass', title: 'Momentum budget closes', detail: 'Thrust impulse equals drag, friction, slope, exhaust momentum and final momentum to within ' + fmt(rel * 100, 4) + ' %, an independent check on the integration.' }
      : { status: 'warn', title: 'Momentum budget does not close', detail: 'Residual ' + fmt(rel * 100, 2) + ' % of the thrust impulse; try the high-accuracy setting.' });
    var placeholders = ['C1_kPa', 'C2_kPa', 'Cd', 'Cv', 'C_D', 'CdA_cm2', 'mu_k', 'mu_s'].filter(function (k) {
      if ((k === 'C1_kPa' || k === 'C2_kPa') && p.membrane !== 'mr') return false;
      return isExampleValue(k);
    });
    var basic = ['mass_g', 'd0_mm', 'wall_mm', 'infl_cm', 'nozzle_mm'].filter(isExampleValue);
    if (basic.length) out.push({ status: 'warn', title: 'Measured geometry still uses example values', detail: 'Replace ' + basic.map(labelOf).join(', ') + ' with your measurements; the prediction depends strongly on them.' });
    if (placeholders.length) out.push({ status: 'info', title: placeholders.length + ' hard-to-measure values are still placeholders', detail: placeholders.map(labelOf).join(', ') + '. Fit them to a measured run (Calibration) or a measured pressure curve.' });
    if (p.membrane !== 'measured' && s.t_vmax > 0.9 * s.t_burn) out.push({ status: 'info', title: 'Peak speed comes at the very end of the burn', detail: 'At λ ≈ ' + fmt(s.lam_vmax, 2) + ', where the rubber law is least reliable; a measured deflation curve makes this part of the flight trustworthy.' });
    if (R.run && R.run.x.length >= 3) {
      var lastT = R.run.tSim[R.run.tSim.length - 1];
      if (lastT > s.t_end + 0.05) out.push({ status: 'warn', title: 'Your run lasts longer than the model\'s', detail: 'Measured positions continue to ' + fmt(lastT, 2) + ' s but the model stops at ' + fmt(s.t_end, 2) + ' s.' });
    }
    return out;
  }
  function labelOf(k) {
    var f = FIELDS[k];
    if (!f) return k;
    return f.label.replace(/<[^>]+>/g, '');
  }
  function renderChecks() {
    var host = $('checks-list');
    host.innerHTML = '';
    var checks = buildChecks();
    R.checks = checks;
    var order = { fail: 0, warn: 1, info: 2, pass: 3 };
    checks.slice().sort(function (a, b) { return order[a.status] - order[b.status]; }).forEach(function (c) {
      var li = el('li', {}, [el('span', { html: svgUse('i-' + c.status) }), el('div', {}, [
        el('span', { class: 'ck-title', text: c.title }),
        el('span', { class: 'ck-status st-' + c.status, text: { pass: 'Passed', warn: 'Review', fail: 'Failed', info: 'Note' }[c.status] }),
        el('p', { class: 'ck-detail', text: c.detail })])]);
      host.appendChild(li);
    });
  }

  /* ================================================================ */
  /* Background tasks (Web Worker with a main-thread fallback)        */
  /* ================================================================ */
  var WORKER_MAIN = [
    'self.onmessage = function (ev) {',
    '  var m = ev.data, E = self.BalloonEngine, id = m.id;',
    '  function prog(d, t) { self.postMessage({ id: id, kind: "progress", done: d, total: t }); }',
    '  try {',
    '    var r;',
    '    if (m.type === "fit") r = E.calibrate(m.payload.p, m.payload.data, m.payload.keys, { onProgress: function (n) { prog(n, null); } });',
    '    else if (m.type === "mc") r = E.monteCarlo(m.payload.inputs, m.payload.unc, m.payload.N, m.payload.seed, { onProgress: prog });',
    '    else if (m.type === "sens") r = E.sensitivity(m.payload.inputs, m.payload.keys, { onProgress: prog });',
    '    self.postMessage({ id: id, kind: "done", result: r });',
    '  } catch (e) { self.postMessage({ id: id, kind: "error", message: (e && e.message) || String(e) }); }',
    '};'
  ].join('\n');
  var worker = null, workerBroken = false, taskSeq = 0, pending = {};
  function getWorker() {
    if (worker || workerBroken) return worker;
    try {
      var src = $('engine-src').textContent + '\n' + WORKER_MAIN;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = function (ev) {
        var m = ev.data, job = pending[m.id];
        if (!job) return;
        if (m.kind === 'progress') { if (job.onProgress) job.onProgress(m); return; }
        delete pending[m.id];
        if (m.kind === 'done') job.resolve(m.result); else job.reject(new Error(m.message));
      };
      worker.onerror = function () {
        workerBroken = true;
        Object.keys(pending).forEach(function (id) { var job = pending[id]; delete pending[id]; runLocal(job.type, job.payload, job.onProgress).then(job.resolve, job.reject); });
        worker = null;
      };
    } catch (e) { workerBroken = true; worker = null; }
    return worker;
  }
  function runLocal(type, payload, onProgress) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var r;
          if (type === 'fit') r = E.calibrate(payload.p, payload.data, payload.keys, {});
          else if (type === 'mc') r = E.monteCarlo(payload.inputs, payload.unc, payload.N, payload.seed, {});
          else if (type === 'sens') r = E.sensitivity(payload.inputs, payload.keys, {});
          resolve(r);
        } catch (e) { reject(e); }
      }, 30);
      void onProgress;
    });
  }
  function runTask(type, payload, onProgress) {
    var w = getWorker();
    if (!w) return runLocal(type, payload, onProgress);
    return new Promise(function (resolve, reject) {
      var id = ++taskSeq;
      pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress, type: type, payload: payload };
      try { w.postMessage({ id: id, type: type, payload: payload }); }
      catch (e) { delete pending[id]; runLocal(type, payload, onProgress).then(resolve, reject); }
    });
  }

  /* ================================================================ */
  /* Files: export, import, CSV                                       */
  /* ================================================================ */
  var downloads = null;
  function initDownloads() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        window.claude.use('downloads').then(function (d) { downloads = d || null; }).catch(function () { downloads = null; });
      }
    } catch (e) { downloads = null; }
  }
  function offerFile(filename, text) {
    if (downloads) {
      downloads.save({ filename: filename, data: text }).then(function () { toast('Saved ' + filename); }).catch(function (e) {
        var code = e && e.code;
        if (code === 'declined') toast('Download cancelled.');
        else if (code === 'rate_limited') toast('A save prompt is already open.');
        else showTextModal(filename, text);
      });
      return;
    }
    if (!window.claude) {
      // opened as a standalone file: an ordinary browser download works here
      try {
        var type = /\.csv$/i.test(filename) ? 'text/csv' : 'application/json';
        var url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
        var a = el('a', { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Downloaded ' + filename);
        return;
      } catch (e) { /* fall back to copying */ }
    }
    showTextModal(filename, text);
  }
  function showTextModal(filename, text) {
    var root = $('modal-root');
    root.innerHTML = '';
    var ta = el('textarea', { class: 'data', readonly: true, 'aria-label': 'Contents of ' + filename });
    ta.value = text;
    var close = function () { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    var copyBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Copy to clipboard' });
    copyBtn.addEventListener('click', function () {
      var done = function () { toast('Copied. Paste it into a file named ' + filename + '.'); };
      try {
        navigator.clipboard.writeText(text).then(done, function () { ta.focus(); ta.select(); toast('Press Ctrl+C (or ⌘C) to copy the selected text.'); });
      } catch (e) { ta.focus(); ta.select(); toast('Press Ctrl+C (or ⌘C) to copy the selected text.'); }
    });
    var bg = el('div', { class: 'modal-bg', onclick: function (ev) { if (ev.target === bg) close(); } }, [
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' }, [
        el('h3', { id: 'modal-title', text: filename }),
        el('p', { class: 'note', text: 'Downloads are not available in this view, so here is the file content to copy.' }),
        ta,
        el('div', { class: 'btn-row' }, [copyBtn, el('button', { class: 'btn', type: 'button', text: 'Close', onclick: close })])
      ])
    ]);
    root.appendChild(bg);
    copyBtn.focus();
  }
  function csvText() {
    var sim = R.sim, G = sim.grid;
    var head = ['t_s', 'x_m', 'v_m_s', 'a_m_s2', 'air_mass_g', 'diameter_cm', 'stretch', 'gauge_pressure_kPa', 'thrust_N', 'thrust_along_wire_N', 'drag_N', 'friction_N', 'slope_force_N', 'added_mass_recovery_N', 'jet_speed_m_s', 'mass_flow_g_s'];
    var lines = [head.join(',')];
    for (var i = 0; i < G.t.length; i++) {
      lines.push([G.t[i].toFixed(4), G.x[i].toFixed(5), G.v[i].toFixed(5), G.a[i].toFixed(5), (G.m[i] * 1000).toFixed(5), (200 * G.R[i]).toFixed(4), G.lam[i].toFixed(5),
        (G.dP[i] / 1000).toFixed(5), G.T[i].toFixed(6), G.Tax[i].toFixed(6), G.D[i].toFixed(6), G.Ff[i].toFixed(6), G.Fg[i].toFixed(6), G.Famr[i].toFixed(6), G.vjet[i].toFixed(4), (G.mdot[i] * 1000).toFixed(5)].join(','));
    }
    return lines.join('\n') + '\n';
  }

  /* ================================================================ */
  /* Wiring                                                           */
  /* ================================================================ */
  function wire() {
    $('btn-play').addEventListener('click', function () { if (flight.playing) stopFlight(); else playFlight(); });
    $('scrub').addEventListener('input', function () {
      if (!R.sim) return;
      stopFlight();
      flight.t = Number($('scrub').value) / 1000 * R.sim.summary.t_end;
      drawFlight();
    });
    $('strobe').addEventListener('change', drawFlight);
    var runChanged = debounce(function () { R.run = parseRunData(); renderRunStatus(); renderChart(); drawFlight(); R.checks = buildChecks(); renderChecks(); renderStatus(); saveState(); }, 200);
    $('run-text').addEventListener('input', function () { state.run.text = $('run-text').value; runChanged(); });
    $('run-tunit').addEventListener('change', function () { state.run.tUnit = $('run-tunit').value; $('fps-wrap').hidden = state.run.tUnit !== 'frames'; runChanged(); });
    $('run-xunit').addEventListener('change', function () { state.run.xUnit = $('run-xunit').value; runChanged(); });
    $('run-fps').addEventListener('input', function () { state.run.fps = Number($('run-fps').value) || 30; runChanged(); });
    $('run-t0').addEventListener('input', function () { state.run.t0 = Number($('run-t0').value) || 0; runChanged(); });
    $('btn-fit').addEventListener('click', runFit);
    $('btn-apply-fit').addEventListener('click', applyFit);
    $('btn-mc').addEventListener('click', runMC);
    $('btn-sens').addEventListener('click', runSens);
    $('show-band').addEventListener('change', function () { state.showBand = $('show-band').checked; renderKPIs(); renderChart(); saveState(); });
    $('btn-csv').addEventListener('click', function () { if (!R.sim || R.errors.length) { toast('Fix the inputs first.'); return; } offerFile('balloon-flight.csv', csvText()); });
    $('btn-export').addEventListener('click', function () { offerFile('balloon-inputs.json', JSON.stringify(exportObject(), null, 2)); });
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function () {
      var file = $('file-import').files && $('file-import').files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (applyImported(JSON.parse(String(reader.result)), false)) { rebuild(); toast('Imported ' + file.name); }
        } catch (e) { toast('Could not read that file as JSON.'); }
        $('file-import').value = '';
      };
      reader.readAsText(file);
    });
    var resetArmed = false, resetTimer = 0;
    $('btn-reset').addEventListener('click', function () {
      var label = $('btn-reset').querySelector('span');
      if (!resetArmed) {
        resetArmed = true; label.textContent = 'Click again to replace all inputs';
        resetTimer = setTimeout(function () { resetArmed = false; label.textContent = 'Load example'; }, 4000);
        return;
      }
      clearTimeout(resetTimer); resetArmed = false; label.textContent = 'Load example';
      state = defaultState(); R.fit = null; R.mc = null; R.sens = null;
      rebuild(); saveState(); toast('Example inputs loaded.');
    });
    var lastW = -1;
    var onResize = debounce(function () {
      var w = $('chart-panel').clientWidth;
      drawFlight();
      if (w === lastW) return;
      lastW = w;
      renderChart(); if (R.fit) renderFitResult(); if (R.mc || R.sens) renderMcResult();
    }, 150);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($('chart-panel'));
    window.addEventListener('resize', onResize);
    var redrawTheme = function () { drawFlight(); };
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawTheme); } catch (e) { /* old browsers */ }
    try { new MutationObserver(redrawTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }); } catch (e) { /* ignore */ }
  }

  function syncRunControls() {
    $('run-text').value = state.run.text;
    $('run-tunit').value = state.run.tUnit;
    $('run-xunit').value = state.run.xUnit;
    $('run-fps').value = state.run.fps;
    $('run-t0').value = state.run.t0;
    $('fps-wrap').hidden = state.run.tUnit !== 'frames';
    $('mc-n').value = String(state.mcN);
    $('mc-seed').value = state.seed;
    $('show-band').checked = state.showBand;
  }

  function rebuild() {
    buildSheet();
    buildFitKeys();
    buildTabs();
    syncRunControls();
    renderUncTable();
    recompute();
    if (!R.sim) { renderChecks(); }
  }

  function boot() {
    loadState();
    initDownloads();
    wire();
    rebuild();
    if (!state.tab || !TABS.some(function (t) { return t.id === state.tab; })) state.tab = 'position';
    selectTab(state.tab);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && R.sim) { flight.t = R.sim.summary.t_end; drawFlight(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
