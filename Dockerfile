FROM node:24-slim

# Instalar dependencias del sistema para Sharp y optimizaciones
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    libvips-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libgif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de configuración primero para aprovechar cache de Docker
COPY package*.json ./

# Instalar dependencias con optimizaciones
RUN npm ci --only=production --no-audit --no-fund

# Copiar código fuente
COPY api/ ./api/
COPY public/ ./public/

# Crear directorio de caché con permisos correctos
RUN mkdir -p /tmp/compress_cache && chmod 755 /tmp/compress_cache

# Variables de entorno optimizadas para HF Spaces
ENV NODE_ENV=production
ENV PORT=7860
ENV LOCAL_EFFORT=6
ENV LOCAL_QUALITY=40
ENV COMPRESSION_TIMEOUT_MS=45000
ENV REQUEST_TIMEOUT_MS=60000
ENV MAX_SIZE_BYTES=102400
ENV ENABLE_CACHE=true
ENV ENABLE_DISK_CACHE=true
ENV CACHE_SIZE=200
ENV MAX_CONCURRENT_JOBS=4
ENV CACHE_DIR=/tmp/compress_cache
ENV MAX_CACHE_SIZE=1073741824

# Health check para HF Spaces
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

# Exponer puerto 7860 (requerido por HF Spaces)
EXPOSE 7860

# Usuario no-root para seguridad
USER node

# Comando de inicio optimizado
CMD ["node", "--max-old-space-size=4096", "api/server.js"]
