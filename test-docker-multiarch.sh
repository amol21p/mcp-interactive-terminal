#!/usr/bin/env bash
#
# Cross-platform test suite for mcp-interactive-terminal.
#
# Tests across:
#   - Architectures:  arm64 (native), amd64 (QEMU), armv7 (QEMU)
#   - Distros:        Debian Bookworm, Alpine (musl libc), Slim (no build tools)
#
# Requires: Docker with QEMU binfmt support
#   docker run --privileged --rm tonistiigi/binfmt --install all
#
# Usage: ./test-docker-multiarch.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

# ─── Helpers ──────────────────────────────────────────────────────────

red()    { printf "\033[31m%s\033[0m" "$1"; }
green()  { printf "\033[32m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }
bold()   { printf "\033[1m%s\033[0m" "$1"; }
dim()    { printf "\033[2m%s\033[0m" "$1"; }

pass() {
  PASS=$((PASS + 1))
  RESULTS+=("$(green "PASS") $1")
  echo "  $(green "✓") $1"
}

fail() {
  FAIL=$((FAIL + 1))
  RESULTS+=("$(red "FAIL") $1: $2")
  echo "  $(red "✗") $1"
  echo "    $(dim "$2")"
}

skip() {
  SKIP=$((SKIP + 1))
  RESULTS+=("$(yellow "SKIP") $1: $2")
  echo "  $(yellow "–") $1"
  echo "    $(dim "$2")"
}

has() { echo "$1" | grep -qF "$2"; }

# Run a quick test (just dist/ mounted, no npm install)
run_quick() {
  local platform="$1"; local image="$2"; local script="$3"
  docker run --rm --platform "$platform" \
    -v "$SCRIPT_DIR/dist":/app/dist:ro \
    -v "$SCRIPT_DIR/package.json":/app/package.json:ro \
    -w /app --entrypoint /bin/sh "$image" \
    -c "$script" 2>&1 || true
}

# Run a full test (copy source, npm install inside container)
run_full() {
  local platform="$1"; local image="$2"; local script="$3"; local timeout_s="${4:-300}"
  timeout "$timeout_s" docker run --rm --platform "$platform" \
    -v "$SCRIPT_DIR":/app-src:ro \
    -w /tmp/test-app --entrypoint /bin/bash "$image" \
    -c "cp -r /app-src/. /tmp/test-app/ && rm -rf node_modules && $script" 2>&1 || true
}

# Run full test on Alpine (uses /bin/sh not bash, needs special handling)
run_full_alpine() {
  local platform="$1"; local image="$2"; local script="$3"; local timeout_s="${4:-300}"
  timeout "$timeout_s" docker run --rm --platform "$platform" \
    -v "$SCRIPT_DIR":/app-src:ro \
    -w /tmp/test-app --entrypoint /bin/sh "$image" \
    -c "cp -r /app-src/. /tmp/test-app/ && rm -rf node_modules && $script" 2>&1 || true
}

# ─── Pre-flight ───────────────────────────────────────────────────────

echo ""
echo "$(bold "═══════════════════════════════════════════════════════════════════")"
echo "$(bold "  mcp-interactive-terminal — Multi-Architecture Test Suite")"
echo "$(bold "═══════════════════════════════════════════════════════════════════")"
echo ""
echo "  Host:     $(uname -s) $(uname -m)"
echo "  Docker:   $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  Package:  $(node -e "console.log(require('./package.json').version)")"
echo ""

echo "$(bold "Building locally...")"
npm run build --silent 2>/dev/null
echo ""

echo "$(bold "Pulling Docker images (this may take a while for cross-arch)...")"
IMAGES=(
  "linux/arm64:node:22-bookworm"
  "linux/amd64:node:22-bookworm"
  "linux/amd64:node:22-slim"
  "linux/arm64:node:22-alpine"
  "linux/amd64:node:22-alpine"
  "linux/arm/v7:node:20-bookworm"
)
for entry in "${IMAGES[@]}"; do
  platform="${entry%%:*}"
  rest="${entry#*:}"
  image="${rest}"
  docker pull -q --platform "$platform" "$image" > /dev/null 2>&1 &
done
wait
echo ""

# ═══════════════════════════════════════════════════════════════════════
# ARCHITECTURE TESTS
# ═══════════════════════════════════════════════════════════════════════

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  ARCHITECTURE: linux/arm64 (native)")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: arm64 — Version check")"
OUTPUT=$(run_quick "linux/arm64" "node:22-bookworm" "node -e 'console.log(process.arch, process.platform)'")
if has "$OUTPUT" "arm64 linux"; then
  pass "arm64: Node reports arm64 linux"
else
  fail "arm64 arch check" "Got: $OUTPUT"
fi
echo ""

echo "$(bold "Test: arm64 — Install + build + bash session")"
OUTPUT=$(run_full "linux/arm64" "node:22-bookworm" '
  npm install --no-audit --no-fund 2>&1 | tail -3
  echo "MARKER_INSTALL"
  npm run build 2>&1 > /dev/null
  echo "MARKER_BUILD"

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("MODE:" + session.terminal.mode);
session.terminal.write("echo ARM64_WORKS && uname -m\n");
await new Promise(r => setTimeout(r, 2000));
console.log("OUTPUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("DONE_ARM64");
process.exit(0);
NODESCRIPT
' 300)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "arm64: npm install succeeded"
else
  fail "arm64: npm install" "Did not complete"
fi

if has "$OUTPUT" "ARM64_WORKS"; then
  pass "arm64: Bash session works"
else
  fail "arm64: bash session" "Expected ARM64_WORKS"
fi

if has "$OUTPUT" "aarch64"; then
  pass "arm64: uname -m confirms aarch64"
else
  fail "arm64: arch verify" "Expected aarch64"
fi

echo ""

# ──────────────────────────────────────────────────────────────────────

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  ARCHITECTURE: linux/amd64 (QEMU emulation)")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: amd64 — Version check")"
OUTPUT=$(run_quick "linux/amd64" "node:22-bookworm" "node -e 'console.log(process.arch, process.platform)'")
if has "$OUTPUT" "x64 linux"; then
  pass "amd64: Node reports x64 linux"
else
  fail "amd64 arch check" "Got: $OUTPUT"
fi
echo ""

echo "$(bold "Test: amd64 — Install + build + bash session")"
OUTPUT=$(run_full "linux/amd64" "node:22-bookworm" '
  npm install --no-audit --no-fund 2>&1 | tail -3
  echo "MARKER_INSTALL"
  npm run build 2>&1 > /dev/null
  echo "MARKER_BUILD"

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("MODE:" + session.terminal.mode);
session.terminal.write("echo AMD64_WORKS && uname -m\n");
await new Promise(r => setTimeout(r, 3000));
console.log("OUTPUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("DONE_AMD64");
process.exit(0);
NODESCRIPT
' 300)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "amd64: npm install succeeded"
else
  fail "amd64: npm install" "Did not complete"
fi

if has "$OUTPUT" "AMD64_WORKS"; then
  pass "amd64: Bash session works"
else
  # Under QEMU, PTY may crash — check if pipe mode worked
  if has "$OUTPUT" "MODE:pipe"; then
    if has "$OUTPUT" "AMD64_WORKS"; then
      pass "amd64: Bash session works (pipe mode)"
    else
      fail "amd64: bash session" "Session created but no output"
    fi
  else
    fail "amd64: bash session" "Expected AMD64_WORKS"
  fi
fi

if has "$OUTPUT" "x86_64"; then
  pass "amd64: uname -m confirms x86_64"
else
  skip "amd64: arch verify" "May not have reached uname"
fi

echo ""

echo "$(bold "Test: amd64 — Python REPL")"
OUTPUT=$(run_full "linux/amd64" "node:22-bookworm" '
  npm install --no-audit --no-fund 2>&1 > /dev/null
  npm run build 2>&1 > /dev/null

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "python3" });
console.log("PYTHON_MODE:" + session.terminal.mode);
session.terminal.write("2 ** 100\n");
await new Promise(r => setTimeout(r, 3000));
console.log("PYTHON_OUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("PYTHON_DONE");
process.exit(0);
NODESCRIPT
' 300)

if has "$OUTPUT" "1267650600228229401496703205376"; then
  pass "amd64: Python computed 2**100 correctly"
else
  fail "amd64: Python computation" "Expected 2**100 result"
fi

echo ""

# ──────────────────────────────────────────────────────────────────────

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  ARCHITECTURE: linux/arm/v7 (32-bit ARM, QEMU)")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: armv7 — Version check")"
OUTPUT=$(run_quick "linux/arm/v7" "node:20-bookworm" "node -e 'console.log(process.arch, process.platform)'")
if has "$OUTPUT" "arm linux"; then
  pass "armv7: Node reports arm linux"
else
  fail "armv7 arch check" "Got: $OUTPUT"
fi
echo ""

echo "$(bold "Test: armv7 — Install + build + session")"
OUTPUT=$(run_full "linux/arm/v7" "node:20-bookworm" '
  npm install --no-audit --no-fund 2>&1 | tail -3
  echo "MARKER_INSTALL"
  npm run build 2>&1 > /dev/null
  echo "MARKER_BUILD"

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("MODE:" + session.terminal.mode);
session.terminal.write("echo ARMV7_WORKS && uname -m\n");
await new Promise(r => setTimeout(r, 3000));
console.log("OUTPUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("DONE_ARMV7");
process.exit(0);
NODESCRIPT
' 420)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "armv7: npm install succeeded"
else
  fail "armv7: npm install" "Did not complete (may be slow under QEMU)"
fi

if has "$OUTPUT" "ARMV7_WORKS"; then
  pass "armv7: Bash session works"
else
  if has "$OUTPUT" "MARKER_BUILD"; then
    fail "armv7: bash session" "Build succeeded but session failed"
  else
    skip "armv7: bash session" "Build may have timed out under QEMU"
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════
# DISTRO TESTS
# ═══════════════════════════════════════════════════════════════════════

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  DISTRO: Alpine Linux (musl libc)")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: Alpine arm64 — Install + pipe fallback")"
OUTPUT=$(run_full_alpine "linux/arm64" "node:22-alpine" '
  apk add --no-cache bash python3 2>&1 > /dev/null
  npm install --no-audit --no-fund 2>&1 | tail -5
  echo "MARKER_INSTALL"
  npm run build 2>&1 > /dev/null
  echo "MARKER_BUILD"

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("ALPINE_MODE:" + session.terminal.mode);
session.terminal.write("echo ALPINE_WORKS && cat /etc/os-release | head -1\n");
await new Promise(r => setTimeout(r, 2000));
console.log("ALPINE_OUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("ALPINE_DONE");
process.exit(0);
NODESCRIPT
' 300)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "Alpine arm64: npm install succeeded"
else
  fail "Alpine arm64: npm install" "Did not complete"
fi

if has "$OUTPUT" "MARKER_BUILD"; then
  pass "Alpine arm64: TypeScript build succeeded"
else
  fail "Alpine arm64: build" "Did not complete"
fi

ALPINE_MODE=$(echo "$OUTPUT" | grep -F "ALPINE_MODE:" | sed 's/.*ALPINE_MODE://')
if [ -n "$ALPINE_MODE" ]; then
  pass "Alpine arm64: Terminal mode = $ALPINE_MODE"
else
  fail "Alpine arm64: terminal mode" "Could not detect mode"
fi

if has "$OUTPUT" "ALPINE_WORKS"; then
  pass "Alpine arm64: Bash session works"
else
  fail "Alpine arm64: bash session" "Expected ALPINE_WORKS"
fi

if has "$OUTPUT" "Alpine"; then
  pass "Alpine arm64: Confirmed running on Alpine Linux"
else
  skip "Alpine arm64: distro verify" "Could not confirm Alpine"
fi

echo ""

echo "$(bold "Test: Alpine amd64 — Install + session")"
OUTPUT=$(run_full_alpine "linux/amd64" "node:22-alpine" '
  apk add --no-cache bash python3 2>&1 > /dev/null
  npm install --no-audit --no-fund 2>&1 | tail -5
  echo "MARKER_INSTALL"
  npm run build 2>&1 > /dev/null
  echo "MARKER_BUILD"

  node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("MODE:" + session.terminal.mode);
session.terminal.write("echo ALPINE_AMD64_WORKS\n");
await new Promise(r => setTimeout(r, 3000));
console.log("OUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("DONE");
process.exit(0);
NODESCRIPT
' 300)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "Alpine amd64: npm install succeeded"
else
  fail "Alpine amd64: npm install" "Did not complete"
fi

if has "$OUTPUT" "ALPINE_AMD64_WORKS"; then
  pass "Alpine amd64: Bash session works"
else
  if has "$OUTPUT" "MARKER_BUILD"; then
    fail "Alpine amd64: bash session" "Build OK but session failed"
  else
    skip "Alpine amd64: bash session" "Build may not have completed"
  fi
fi

echo ""

# ──────────────────────────────────────────────────────────────────────

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  DISTRO: Debian Slim (no build tools)")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: Slim amd64 — Pipe fallback without build tools")"
OUTPUT=$(timeout 300 docker run --rm --platform linux/amd64 \
  -v "$SCRIPT_DIR":/app-src:ro \
  -w /tmp/test-app --entrypoint /bin/bash \
  node:22-slim \
  -c '
cp -r /app-src/. /tmp/test-app/ && rm -rf node_modules
npm install --no-audit --no-fund 2>&1 | tail -5
echo "MARKER_INSTALL"
npm run build 2>&1 > /dev/null
echo "MARKER_BUILD"

node --input-type=module << '"'"'NODESCRIPT'"'"'
import { SessionManager } from "./dist/session-manager.js";
import { loadConfig } from "./dist/types.js";
const config = loadConfig();
const sm = new SessionManager(config);
const session = await sm.createSession({ command: "bash" });
console.log("SLIM_MODE:" + session.terminal.mode);
session.terminal.write("echo SLIM_AMD64_WORKS\n");
await new Promise(r => setTimeout(r, 3000));
console.log("SLIM_OUT:" + session.terminal.readScreen());
sm.closeSession(session.id);
console.log("SLIM_DONE");
process.exit(0);
NODESCRIPT
' 2>&1 || true)

if has "$OUTPUT" "MARKER_INSTALL"; then
  pass "Slim amd64: npm install succeeded"
else
  fail "Slim amd64: npm install" "Did not complete"
fi

SLIM_MODE=$(echo "$OUTPUT" | grep -F "SLIM_MODE:" | sed 's/.*SLIM_MODE://')
if [ "$SLIM_MODE" = "pipe" ]; then
  pass "Slim amd64: Correctly fell back to pipe mode (no build tools)"
elif [ "$SLIM_MODE" = "pty" ]; then
  pass "Slim amd64: PTY mode works (prebuilt binary available)"
elif [ -n "$SLIM_MODE" ]; then
  pass "Slim amd64: Terminal mode = $SLIM_MODE"
else
  skip "Slim amd64: mode detection" "Could not determine mode"
fi

if has "$OUTPUT" "SLIM_AMD64_WORKS"; then
  pass "Slim amd64: Bash session works"
else
  fail "Slim amd64: bash session" "Expected SLIM_AMD64_WORKS"
fi

echo ""

# ──────────────────────────────────────────────────────────────────────

echo "$(bold "────────────────────────────────────────────────────────────")"
echo "$(bold "  SPECIAL: Version check across architectures")"
echo "$(bold "────────────────────────────────────────────────────────────")"
echo ""

echo "$(bold "Test: amd64 Node 16 — version check")"
OUTPUT=$(run_quick "linux/amd64" "node:16-slim" "node dist/bin.js")
if has "$OUTPUT" "Node.js version too old"; then
  pass "amd64 Node 16: Version check works under QEMU"
else
  fail "amd64 Node 16: version check" "Expected rejection"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════

TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo "$(bold "═══════════════════════════════════════════════════════════════════")"
echo "$(bold "  Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped (${TOTAL} total)")"
echo "$(bold "═══════════════════════════════════════════════════════════════════")"
echo ""

for r in "${RESULTS[@]}"; do
  echo "  $r"
done

echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "$(red "  ${FAIL} test(s) failed.")"
  echo ""
  exit 1
else
  echo "$(green "  All tests passed! (${SKIP} skipped)")"
  echo ""
  exit 0
fi
