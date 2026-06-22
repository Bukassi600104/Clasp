#!/usr/bin/env python3
"""Read a Firebase service-account JSON and set the 3 Vercel env vars (production)
without printing the secret. Stores the private key with literal \\n; lib/firebase.ts
converts it back to real newlines at runtime."""
import json, subprocess, sys

path = sys.argv[1]
with open(path) as f:
    d = json.load(f)

env = {
    "FIREBASE_PROJECT_ID": d["project_id"],
    "FIREBASE_CLIENT_EMAIL": d["client_email"],
    "FIREBASE_PRIVATE_KEY": d["private_key"].replace("\n", "\\n"),
}

for name, val in env.items():
    subprocess.run(f"vercel env rm {name} production --yes", shell=True,
                   capture_output=True, text=True)
    p = subprocess.run(f"vercel env add {name} production", shell=True,
                       input=val, capture_output=True, text=True)
    print(f"{name:24} {'OK' if p.returncode == 0 else 'FAIL'}")
    if p.returncode != 0:
        sys.stderr.write((p.stderr or '')[-400:] + "\n")

print("project:", d["project_id"])
