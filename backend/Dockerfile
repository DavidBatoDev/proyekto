# syntax=docker/dockerfile:1.7

# --- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 8080

CMD ["node", "dist/server"]
