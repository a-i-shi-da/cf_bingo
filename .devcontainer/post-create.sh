#!/usr/bin/env bash
set -euo pipefail

echo "==> Fixing ownership of persisted volumes"
# 名前付きボリュームは root 所有で作られるため node ユーザーに渡す
sudo chown node:node /home/node/.config
sudo chown -R node:node /home/node/.claude /home/node/.config/.wrangler /commandhistory

echo "==> Persisting bash history"
touch /commandhistory/.bash_history
if ! grep -q "commandhistory" ~/.bashrc; then
  cat >> ~/.bashrc <<'EOF'

# devcontainer: コンテナ再作成後もシェル履歴を保持
export HISTFILE=/commandhistory/.bash_history
export PROMPT_COMMAND="history -a${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
EOF
fi

echo "==> Enabling corepack (pnpm / yarn を使う場合に備えて)"
sudo corepack enable || true

if [ -f package.json ]; then
  echo "==> Installing dependencies"
  if [ -f pnpm-lock.yaml ]; then
    pnpm install --frozen-lockfile
  elif [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  echo "==> Installing Playwright Chromium and its system libraries (E2E tests)"
  pnpm exec playwright install --with-deps chromium || echo "Playwright のインストールに失敗しました（E2E テストの前に再実行してください）"
else
  echo "==> package.json not found; skipping dependency install"
fi

echo "==> Versions"
node --version
npm --version
claude --version || echo "claude: not found"
gh --version | head -n 1 || true

echo "==> Done"
