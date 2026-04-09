FROM node:24-slim

# Layer 1: System dependencies (rarely changes)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    curl \
    ca-certificates \
    git \
    libvips-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libgif-dev && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean && \
    apt-get autoclean

WORKDIR /app

# Layer 2: NPM configuration and package files
COPY .npmrc ./
COPY package*.json ./

# Layer 3: Install dependencies with detailed logging
RUN echo "Starting npm install..." && \
    npm install --omit=dev 2>&1 | tail -100 && \
    echo "npm install completed successfully" && \
    npm list --depth=0 2>/dev/null || true

# Layer 4: Copy and verify source files
COPY api/ ./api/
COPY public/ ./public/
RUN ls -la api/ public/ && \
    echo "Files copied successfully"

# Layer 5: Setup directories and permissions
RUN mkdir -p /tmp/compress_cache && \
    chmod 755 /tmp/compress_cache && \
    chown -R node:node /tmp/compress_cache && \
    chown -R node:node /app && \
    echo "Permissions set successfully"

# Variables de entorno optimizadas para MÁXIMA VELOCIDAD con calidad de texto
ENV NODE_ENV=production
ENV PORT=7860
ENV LOCAL_EFFORT=1
ENV LOCAL_QUALITY=25
ENV COMPRESSION_TIMEOUT_MS=20000
ENV REQUEST_TIMEOUT_MS=30000
ENV MAX_SIZE_BYTES=102400
ENV ENABLE_CACHE=true
ENV ENABLE_DISK_CACHE=true
ENV CACHE_SIZE=1000
ENV MAX_CACHE_SIZE=53687091200
ENV MAX_CONCURRENT_JOBS=12
ENV CACHE_DIR=/tmp/compress_cache
ENV SHARP_CONCURRENCY=4
ENV MEMORY_LIMIT=10737418240
ENV BATCH_SIZE=20
ENV PARALLEL_FETCHES=12
ENV MAX_DISK_CACHE_ITEMS=20000
ENV DISK_CACHE_CLEANUP_THRESHOLD=15000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

EXPOSE 7860

# Usuario no-root
USER node

# Start command optimizado para MÁXIMA VELOCIDAD
CMD ["node", "--max-old-space-size=10240", "--optimize-for-size", "--memory-reducer", "--max-semi-space-size=256", "--optimize-for-size"]
