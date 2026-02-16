#!/bin/bash
# Claude Code (Gemini 3) Launcher
# Starts the proxy and launches Claude Code CLI connected to it.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure Node.js is available
if ! command -v node &> /dev/null; then
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        export NVM_DIR="$HOME/.nvm"
        . "$NVM_DIR/nvm.sh"
    fi
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js."
    exit 1
fi

# Kill any existing proxy on port 51200 to ensure fresh start
kill -9 $(lsof -t -i :51200) 2>/dev/null || true
# sleep 0.2

# Start proxy in background
PROXY_LOG="$HOME/.claude-code-proxy.log"
node "$SCRIPT_DIR/proxy.js" >> "$PROXY_LOG" 2>&1 &
PROXY_PID=$!

# Wait for proxy to bind port
echo "Waiting for proxy to start..."
for i in {1..50}; do
    if ! kill -0 $PROXY_PID 2>/dev/null; then
        echo "❌ Proxy failed to start!"
        exit 1
    fi
    if lsof -i :51200 >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

echo "✅ Proxy connected."
echo "🚀 Model: Gemini 3 Pro (High Reasoning)"
echo "💡 Note: Automatically falls back to Flash if rate limited."

# Configure Claude Code to use local proxy
export ANTHROPIC_BASE_URL=http://localhost:51200
export ANTHROPIC_API_KEY=claude-code-gym-key

# Launch Claude Code
# Using --dangerously-skip-permissions to avoid constant approval prompts for read/write
claude --model gemini-3-pro --dangerously-skip-permissions

# Cleanup when Claude exits
kill $PROXY_PID 2>/dev/null
echo "Proxy stopped."
