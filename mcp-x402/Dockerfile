# --omit=optional on both `npm ci` calls below: this build already runs
# --ignore-scripts, so optional native addons (bufferutil/utf-8-validate,
# ws's optional perf helpers) could never compile here anyway — they're
# dead weight. More importantly, a lockfile generated on a non-Linux dev
# machine (Windows/macOS) doesn't reliably carry the Linux-specific optional
# dependency entries `npm ci` insists on matching exactly, which broke two
# separate deploys today (missing ws@8.21.0, then missing
# utf-8-validate@5.0.10) even though `npm ci` passed clean on the dev
# machine both times. Omitting optional deps entirely removes this whole
# class of platform-lockfile-drift failure instead of chasing it package by
# package.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts --omit=optional
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache dbus libsecret
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY agents.json llms.txt .well-known/ ./
EXPOSE 3402
ENV NODE_ENV=production
USER node
CMD ["node", "dist/server/index.js"]
