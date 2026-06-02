# ---- dependencies ----------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# @napi-rs/canvas ships prebuilt Skia binaries — no compiler/native libs needed.
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000

# Fonts for deterministic, brand-true server-side text rendering.
# (Liberation Sans ≈ the sans stack, DejaVu Sans Mono ≈ the mono stack.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY lib ./lib
COPY public ./public
COPY fonts ./fonts

# Run as the unprivileged user that the node image ships with.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
