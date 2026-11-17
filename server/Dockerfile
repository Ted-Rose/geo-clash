# Multi-stage build — run from the repo root:
#   docker build -f server/Dockerfile .

# Stage 1: build the client bundle for SAME-ORIGIN serving.
# VITE_SERVER_URL is deliberately unset so socket.io and /api calls
# target the origin that serves this bundle (the Cloud Run URL).
# VITE_SENTRY_DSN is optional — a public-by-design client key passed
# via --build-arg; unset means the bundled SPA reports nothing.
FROM node:20-alpine AS client-build
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run pwa-assets && npm run build

# Stage 2: server runtime + the bundled client at ./public,
# which src/app.js serves when present.
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client-build /build/client/dist ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]
