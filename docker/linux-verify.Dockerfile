# Linux verification harness — runs the suite the way a Debian/Ubuntu x64 host
# would, so Linux support can be checked from a Windows workstation with no
# distro installed.
#
#   docker build -f docker/linux-verify.Dockerfile -t oxespace-linux-verify .
#   docker run --rm oxespace-linux-verify
#
# What this proves: the native-module toolchain, every POSIX code path
# (migration 046, safe-join, script commands, shell-profile defaults), the
# renderer/main build, and the E2E smoke with a real Electron window under Xvfb.
#
# What it cannot prove: how the app actually looks and feels. For that use WSL2
# — see docs/DEVELOPMENT_GUIDE.md.
FROM node:22-bookworm

# Split in two layers on purpose: the toolchain is what better-sqlite3/node-pty
# compile against, the runtime libs are what Electron dynamically links at
# launch. A missing member of the second group only shows up as a silent
# start-up failure, which is exactly the class of bug this image is here to catch.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 make g++ \
 && apt-get install -y --no-install-recommends \
      libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
      libxshmfence1 libnotify4 xvfb xauth \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so edits to src/ do not invalidate the install layer.
# .dockerignore keeps the Windows-built node_modules out — they must be rebuilt
# for Linux here, which is half the point of this image.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Electron refuses to run as root without this, and the container has no
# unprivileged user set up for the bind-mounted workspace.
ENV ELECTRON_DISABLE_SANDBOX=1

# The renderer bundle pulls in Monaco (~8 MB of output). Node sizes its old
# space from the cgroup budget and lands around 2 GB here, which the Rollup pass
# exhausts — the build dies with "Ineffective mark-compacts near heap limit".
# Nothing to do with Linux; the same build succeeds on a Windows host with a
# larger default heap. Give Docker Desktop at least 6 GB for this to hold.
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY docker/linux-verify.sh /usr/local/bin/linux-verify
RUN chmod +x /usr/local/bin/linux-verify

CMD ["linux-verify"]
