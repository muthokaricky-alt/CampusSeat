# CampusSeat: one image with the API and the built React app (Express serves frontend/dist).
# Build:  docker build -t campusseat .
# Run:    docker run -p 4000:4000 --env-file backend/.env campusseat

# 1. Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. Production dependencies of the API
FROM node:22-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3. Runtime image: no build tools, runs as the unprivileged "node" user
FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules backend/node_modules
COPY backend/package.json backend/
COPY backend/src backend/src
COPY backend/scripts backend/scripts
COPY backend/migrations backend/migrations
COPY --from=frontend /app/frontend/dist frontend/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "backend/src/server.js"]
