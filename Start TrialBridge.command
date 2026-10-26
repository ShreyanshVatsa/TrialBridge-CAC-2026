#!/bin/bash
# Double-click to start the full TrialBridge app on this Mac (port 8787, real AI when .dev.vars has a key or a local
# model). Opens your browser when everything checks out. The demo has its own launcher: "Start TrialBridge Demo.command".
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

pause_and_exit() {
  echo
  echo "This window will stay open so you can read the message above."
  echo "Press Return to close it."
  read -r _
  exit "${1:-1}"
}
fail() { # fail "what happened" "what to do next"
  echo
  echo "==============================================================="
  echo "TrialBridge could not start."
  echo "What happened: $1"
  echo "What to do:    $2"
  echo "==============================================================="
  pause_and_exit 1
}

echo "Starting TrialBridge..."

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed (or not on your PATH)." "Install Node 22 or newer from https://nodejs.org (or run: brew install node), then double-click this file again."
fi
NODE_OUT=$(node --version 2>&1)
if [ $? -ne 0 ]; then
  if echo "$NODE_OUT" | grep -qi -E "simdjson|dyld|Library not loaded"; then
    fail "Node is installed but broken (a library it needs is missing: $(echo "$NODE_OUT" | head -c 160))." "Open Terminal and run: brew reinstall node   Then double-click this file again."
  fi
  fail "Node would not run: $(echo "$NODE_OUT" | head -c 200)" "Reinstall Node 22 or newer (brew reinstall node, or https://nodejs.org), then double-click this file again."
fi
NODE_MAJOR=$(echo "$NODE_OUT" | sed -E 's/^v([0-9]+).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ] 2>/dev/null; then
  fail "Node $NODE_OUT is too old (TrialBridge needs 22 or newer)." "Update Node (brew upgrade node, or https://nodejs.org), then double-click this file again."
fi
command -v npm >/dev/null 2>&1 || fail "npm was not found next to Node." "Reinstall Node from https://nodejs.org, then double-click this file again."

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies once (this can take a few minutes)..."
  npm install || fail "npm install did not finish." "Check your internet connection, then double-click this file again."
fi

npm run local -- --open "$@"
CODE=$?
if [ $CODE -ne 0 ] && [ $CODE -ne 130 ] && [ $CODE -ne 143 ]; then
  fail "TrialBridge stopped with an error (code $CODE). The lines just above explain which step failed." "Fix that step and double-click this file again. If the page looks out of date, run in Terminal: npm run local -- --rebuild. See README.md."
fi
echo "TrialBridge stopped."
pause_and_exit 0
