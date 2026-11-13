# Multi-stage build — run from the repo root:
#   docker build -f server/Dockerfile .

# Stage 1: build the client bundle for SAME-ORIGIN serving.
# VITE_SERVER_URL is deliberately unset so socket.io and /api calls
# target the origin that serves this bundle (the Cloud Run URL).
FROM node:25-alpine AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run pwa-assets && npm run build

# Stage 2: server runtime + the bundled client at ./public,
# which src/app.js serves when present.
FROM node:25-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client-build /build/client/dist ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]
