# 2 · The interactive simulator

> Part of [balloon-rocket-physics](../README.md). Previous: [1 · Physics model](01-physics-model.md) · next: [3 · Video analysis](03-video-analysis.md)

[`simulator/balloon-rocket-simulator.html`](../simulator/balloon-rocket-simulator.html) is a single, self-contained web page. You enter the measurements of your own balloon rocket and it simulates the flight with the same physics as [`model/balloon_v3.py`](../model/balloon_v3.py), shows where the momentum goes, fits the model to a measured run and propagates measurement uncertainty.

**To open it:** download the file and double-click it. It needs no installation or server and works offline; only the web fonts need a connection, and without one the page falls back to system fonts. To give it a public link, turn on GitHub Pages for this repository; the page is then served at `https://<user>.github.io/<repo>/simulator/balloon-rocket-simulator.html`.

## What you enter

The left-hand sheet has seven sections. Every field shows whether it still holds the example value (hollow dot) or your own measurement (filled dot).

| Section | Inputs |
| --- | --- |
| Balloon and payload | Empty mass (rubber, tape, straw), unstretched diameter, wall thickness, inflated size (diameter or circumference) |
| Rubber pressure curve | Mooney–Rivlin constants, the Gent law (shear modulus and locking limit), or **your own measured deflation curve** (size and pressure readings, with a built-in fit of either law to your data) |
| Nozzle | Exit diameter, discharge coefficient C_d, velocity coefficient C_v, and a helper that estimates the losses of an exit straw from pipe friction |
| Room air | Temperature, pressure (with an altitude helper), isothermal or adiabatic gas |
| Drag and added mass | Drag coefficient, minimum drag area, added-mass coefficient, and switches for added-mass recovery and buoyancy |
| Wire and friction | Kinetic and static friction, wire slope, jet angle to the wire, usable wire length |
| Simulation settings | Time limit and accuracy |

## What you get

- **Headline numbers:** final distance, peak speed, burn time, peak thrust (also shown as the reading on a kitchen scale) and the time to cover 5 m.
- **Flight along the wire:** an animated strobe picture of the balloon on the wire, with play, scrub and speed controls. Measured positions appear as markers once you paste a run.
- **Seven charts:** position, speed, forces, pressure, balloon size, the pressure curve and the momentum budget. Each chart has hover read-outs, keyboard navigation and a table view.
- **Model checks:** a live list that re-runs on every change. It flags a choked jet, a wall too thick for the membrane model, stretch beyond the range where Mooney–Rivlin is valid, the Gent locking limit, the drag crisis, a balloon too weak to overcome static friction, a momentum budget that does not close, and inputs still at their example values.
- **Files:** a CSV of the full simulated time series, plus JSON export and import of everything you entered.

## Tools for real measurements

| Tool | What it does | How |
| --- | --- | --- |
| Calibration | Fits up to six quantities (C_D, μ_k, drag-area floor, C_v, C_d, release time) to a measured x(t) track | Nelder–Mead least squares on transformed parameters. ± values come from the Jacobian at the optimum, with the correlation matrix and a residual runs test so that fits which cannot separate two parameters are flagged |
| Pressure-curve fit | Fits Mooney–Rivlin (linear least squares) or Gent (Nelder–Mead) to a measured deflation curve | Feeds straight into the simulation |
| Uncertainty | Monte Carlo propagation of independent Gaussian input uncertainties (the GUM Supplement 1 method) | Gives 95 % bands on x(t) and v(t), output distributions, and an approximate share of the variance for each input |
| Sensitivity | Local elasticities: the % change in each output per % change in each input | Central differences, ±5 % |

The calibration panel assumes the balloon is **released from rest** at the release time. It therefore cannot fit a clip that starts mid-flight, which is the situation in our own video (see [3 · Video analysis](03-video-analysis.md)). That analysis is done in Python, in [`analysis/`](../analysis/).

The example run and pressure curve that the page opens with are **synthetic**, generated from the model with known values, and they are labelled as examples in the page.

## How it works

- **Engine** ([`simulator/src/engine.js`](../simulator/src/engine.js)): a line-by-line port of `balloon_v3.py`, plus the Gent law, measured curves, calibration, Monte Carlo and sensitivity tools. It contains pure functions with no access to the page, so it also runs in Node for testing.
- **Integrator:** adaptive Dormand–Prince Runge–Kutta 5(4) with SciPy's step-size control and error norm, rtol 10⁻⁸, atol 10⁻¹⁰ and a maximum step of 0.01 s. Stops and wire ends are located by root-finding on the dense-output interpolant, as `solve_ivp` does.
- **Interface** ([`app.js`](../simulator/src/app.js), [`body.html`](../simulator/src/body.html), [`styles.css`](../simulator/src/styles.css)): vanilla JavaScript with no framework. Charts are hand-drawn SVG and the flight is drawn on a canvas. Calibration, Monte Carlo and sensitivity run in a background Web Worker, falling back to the main thread if workers are unavailable. Light and dark themes are supported.
- **Build:** `python simulator/build.py` inlines the four sources into the single HTML file.

## Verification

[`tests/test_js_engine.js`](../tests/test_js_engine.js) runs nine cases through both engines. They cover the defaults, adiabatic gas, slope + jet angle + high friction, a short wire, a wide nozzle without added mass, an elongated balloon without drag floor or buoyancy, no added-mass recovery, a measured pressure curve, and the Gent law.

```text
python tests/make_js_reference.py && node tests/test_js_engine.js
```

The final distance, stop time and thrust impulse agree to better than 0.01 %, and the peak speed and peak thrust to within 0.06 %. Burn time and burnout distance are sampled on the output grid, so they agree to within 0.05 %. The page was also checked in a headless browser: it loads with no errors, its headline numbers match the Python model (39.1 m, 11.32 m/s, 4.81 s, 0.211 N) and its downloads work.

One definition to note: the page's momentum budget integrates the thrust component **along the wire**, T cos α. `balloon_v3.py`'s `impulse_thrust` integrates the full thrust T. The two differ only when the jet is tilted (α ≠ 0), and the test compares like with like.
