# ─── Build stage ────────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-slim AS builder

WORKDIR /app

COPY enclave/package.json enclave/package-lock.json* ./
RUN npm install

COPY enclave/tsconfig.json ./
COPY enclave/src ./src

RUN npm run build

# ─── Runtime stage ──────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# EigenCloud TDX requirement: run as root
USER root

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
