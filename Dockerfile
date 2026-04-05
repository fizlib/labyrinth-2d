# ─────────────────────────────────────────────────────────────────────────────
# Labyrinth 2D — Server Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Uses Ubuntu 24.04 (glibc 2.39) because uWebSockets.js native binaries
# require glibc ≥ 2.38, which Debian Bookworm (glibc 2.36) does not provide.
# ─────────────────────────────────────────────────────────────────────────────

FROM ubuntu:24.04

# Install Node.js 22
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config first for better Docker layer caching
COPY package.json package-lock.json tsconfig.base.json ./

# Copy workspace package.json files (needed for npm install)
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/server/tsconfig.json packages/server/

# Install all dependencies
RUN npm install

# Copy source code
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src

# Build shared first, then server
RUN npm run build -w packages/shared && npm run build -w packages/server

# Expose the default port (Railway sets PORT via env)
EXPOSE 9001

# Start the server
CMD ["npm", "run", "start", "-w", "packages/server"]
