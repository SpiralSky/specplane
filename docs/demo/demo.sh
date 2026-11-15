#!/bin/sh
# A 30-second Specplane demo in a throwaway repository. Run it in a terminal you are recording:
#   sh docs/demo/demo.sh
# It needs `specplane` on your PATH, git and Node.js 22+. It changes nothing outside a temporary folder.
set -e
if [ -n "${SPECPLANE_ACTOR:-}" ]; then
  echo "This shell is marked as an LLM session (SPECPLANE_ACTOR is set), so Specplane would turn the approval into a request." >&2
  echo "Run the demo in a normal terminal window instead." >&2
  exit 1
fi
pause() { sleep "${DEMO_PAUSE:-1.5}"; }
run() { printf '\n$ %s\n' "$*"; pause; "$@"; pause; }

dir=$(mktemp -d)
cd "$dir"
git init -q -b main
git config user.name "Demo" && git config user.email "demo@example.com"
mkdir -p docs/requirements docs/specifications/features

cat > docs/requirements/product-requirements.md <<'EOF'
# Product requirements

**R1: Sign in**
A user can sign in with an email address and a password.
EOF

cat > docs/specifications/features/login.md <<'EOF'
---
id: feature/login
title: Login
authors:
  - human: you
    contribution: drafted
covers: [R1]
references: []
---

# Login

A user signs in with an email address and a password.
EOF

git add -A && git commit -q -m "add requirements and a login spec"

run specplane init
git add -A && git commit -q -m "init specplane"
run specplane spec list
run specplane spec approve feature/login
run specplane spec list

printf '\n# Someone edits the spec...\n'
pause
printf '\nA failed attempt locks the account for 15 minutes.\n' >> docs/specifications/features/login.md
git commit -qam "lock the account after a failed attempt"
run specplane spec list
printf '\n# ...so it is back in review until you approve the new text.\n'
pause
