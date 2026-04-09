FROM node:24-slim

# Instalar dependencias del sistema en una sola capa
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    curl \
    ca-certificates \
    libvips-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libgif-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copiar package*.json PRIMERO (separate layer para caché de dependencias)
COPY package*.json ./

# Instalar dependencias con npm install en lugar de npm ci
# Usa caché local si existe, con timeouts extendidos
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps \
    --network-timeout=60000 \
    --fetch-timeout=60000 \
    --fetch-retries=5 \
    2>&1 | tee npm-install.log

# Copiar código fuente (se cachea independientemente)
COPY api/ ./api/
COPY public/ ./public/

# Preparar directorios y permisos
RUN mkdir -p /tmp/compress_cache && \
    chmod 755 /tmp/compress_cache && \
    chown -R node:node /tmp/compress_cache && \
    chown -R node:node /app

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=7860
ENV LOCAL_EFFORT=6
ENV LOCAL_QUALITY=40
ENV COMPRESSION_TIMEOUT_MS=45000
ENV REQUEST_TIMEOUT_MS=60000
ENV MAX_SIZE_BYTES=102400
ENV ENABLE_CACHE=true
ENV ENABLE_DISK_CACHE=true
ENV CACHE_SIZE=2000
ENV MAX_CACHE_SIZE=53687091200
ENV MAX_CONCURRENT_JOBS=8
ENV CACHE_DIR=/tmp/compress_cache
ENV SHARP_CONCURRENCY=4
ENV MEMORY_LIMIT=15032385536
ENV BATCH_SIZE=10
ENV PARALLEL_FETCHES=6
ENV MAX_DISK_CACHE_ITEMS=50000
ENV DISK_CACHE_CLEANUP_THRESHOLD=45000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

EXPOSE 7860

# Usuario no-root
USER node

# Start command
CMD ["node", "--max-old-space-size=12288", "--max-new-space-size=2048", "--optimize-for-size", "api/server.js"]
