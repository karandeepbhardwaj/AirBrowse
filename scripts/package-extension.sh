#!/bin/bash
set -e

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET} $1"; }
success() { echo -e "${GREEN}[done]${RESET} $1"; }
fail()    { echo -e "${RED}[fail]${RESET} $1"; exit 1; }

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VSCODE_DIR="$ROOT/vscode-extension"
BROWSER_DIR="$ROOT/browser-extension"
DIST_DIR="$ROOT/dist"

echo -e "\n${BOLD}AirBrowse — Package All${RESET}\n"

# 1. Clean dist
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
success "Cleaned dist/ directory"

# 2. Install dependencies
info "Installing dependencies..."
cd "$ROOT"
npm install
success "Dependencies installed"

# 3. Compile TypeScript
info "Compiling TypeScript..."
cd "$VSCODE_DIR"
npx tsc -p tsconfig.json
success "TypeScript compiled"

# 4. Bundle with webpack
info "Bundling with webpack..."
npx webpack --mode production
success "Webpack bundle created"

# 5. Package .vsix
info "Packaging .vsix..."
npx @vscode/vsce package --no-dependencies
success ".vsix packaged"

# Move .vsix to dist/
mv "$VSCODE_DIR"/*.vsix "$DIST_DIR/" 2>/dev/null || fail "No .vsix file produced"
success "Moved .vsix to dist/"

# 6. Zip browser extension
info "Zipping browser extension..."
cd "$BROWSER_DIR"
zip -r "$DIST_DIR/airbrowse-chrome.zip" . -x "node_modules/*" "*.DS_Store"
success "Browser extension zipped"

# Done
echo -e "\n${BOLD}${GREEN}Build complete!${RESET}"
echo -e "Output files in dist/:\n"
ls -lh "$DIST_DIR"
echo
