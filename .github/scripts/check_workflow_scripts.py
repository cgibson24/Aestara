"""Every `run:` script in the GitHub workflows parses as bash.

A step's script is handed to `bash -e`; a syntax error stops it before any of
its commands run, and an EXIT trap can then end the step with a success. This
check parses each script with `bash -n` so such an error fails CI on its own.
Usage: python .github/scripts/check_workflow_scripts.py
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

import yaml

root = pathlib.Path(__file__).resolve().parents[2]
bash = shutil.which("bash") or "/bin/bash"
failures = 0
checked = 0
for workflow in sorted((root / ".github" / "workflows").glob("*.yml")):
    jobs = yaml.safe_load(workflow.read_text()).get("jobs", {})
    for job_id, job in jobs.items():
        default_shell = job.get("defaults", {}).get("run", {}).get("shell", "bash")
        for index, step in enumerate(job.get("steps", [])):
            script = step.get("run")
            if script is None or not step.get("shell", default_shell).startswith("bash"):
                continue
            with tempfile.NamedTemporaryFile("w", suffix=".sh") as handle:
                handle.write(script)
                handle.flush()
                result = subprocess.run([bash, "-n", handle.name], capture_output=True, text=True)
            checked += 1
            if result.returncode != 0:
                failures += 1
                name = step.get("name", f"step {index + 1}")
                print(f"FAIL  {workflow.name} · {job_id} · {name}: {result.stderr.strip()}")
print(f"{checked} workflow scripts checked · {failures} failing")
sys.exit(1 if failures else 0)
