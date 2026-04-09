FROM node:24-slim

WORKDIR /app

# Instalar dependencias del sistema para Sharp
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copiar archivos del proyecto
COPY package*.json ./
RUN npm ci --only=production

COPY api/ ./api/
COPY public/ ./public/

# Exponer puerto 7860 (default HuggingFace Spaces)
EXPOSE 7860

# Variable de entorno para puerto
ENV PORT=7860

# Comando para ejecutar
CMD ["node", "api/server.js"]
