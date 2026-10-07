"""
Run the whole video analysis in order (about 1 minute):

    python analysis/run_all.py

Each step prints its findings, writes numbers to analysis/results/ and figures to
docs/figures/. The steps can also be run one at a time, in the same order.
"""
import runpy
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["01_data_quality.py", "02_kinematics.py", "03_deflation_test.py", "04_motion_tests.py",
         "05_force_balance.py", "06_identifiability.py"]

sys.path.insert(0, str(HERE))
t0 = time.time()
for step in STEPS:
    print("\n" + "=" * 100 + f"\n{step}\n" + "=" * 100)
    runpy.run_path(str(HERE / step), run_name="__main__")
print(f"\nAll steps finished in {time.time() - t0:.0f} s. Results: analysis/results/  Figures: docs/figures/")
