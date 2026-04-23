# ── Base image ────────────────────────────────────────────
FROM node:20-alpine

# ── Working directory ─────────────────────────────────────
WORKDIR /app

# ── Cài dependencies trước (tận dụng Docker layer cache) ──
COPY package.json ./
RUN npm install --omit=dev

# ── Copy source code ──────────────────────────────────────
COPY . .

# ── Port ──────────────────────────────────────────────────
EXPOSE 3000

# ── Start ─────────────────────────────────────────────────
CMD ["node", "server.js"]
