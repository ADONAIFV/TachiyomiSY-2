# HuggingFace Spaces Migration Guide

## Ventajas sobre Vercel Free

| Característica | Vercel Free | HuggingFace Spaces |
|---|---|---|
| **Timeout** | 10 segundos | Sin límite |
| **RAM** | ~512MB | 18GB |
| **vCPU** | Compartido | 2 dedicados |
| **Puerto personalizado** | No | Sí (7860) |
| **Caché** | No | Sí (persistente) |
| **Costo** | Gratis | Gratis |

## Pasos para Migrar a HuggingFace Spaces

### 1. Crear un repositorio en HuggingFace

```bash
# Ir a https://huggingface.co/spaces
# Click en "Create new Space"
# Seleccionar Docker como runtime
# Nombre: tachiyomi-compress (o similar)
```

### 2. Clonar el repositorio HF

```bash
git clone https://huggingface.co/spaces/TU_USUARIO/tachiyomi-compress
cd tachiyomi-compress
```

### 3. Copiar archivos desde GitHub

```bash
# Desde el repo original
git clone https://github.com/ADONAIFV/TachiyomiSY-2
cd TachiyomiSY-2

# Copiar archivos necesarios
cp Dockerfile ../tachiyomi-compress/
cp package.json ../tachiyomi-compress/
cp package-lock.json ../tachiyomi-compress/
cp -r api/ ../tachiyomi-compress/
cp -r public/ ../tachiyomi-compress/
cp .dockerignore ../tachiyomi-compress/ 2>/dev/null || true
cp .gitignore ../tachiyomi-compress/
```

### 4. Crear `.dockerignore`

```bash
cat > .dockerignore << 'EOF'
node_modules
.git
.gitignore
README.md
.env.local
.DS_Store
EOF
```

### 5. Push a HuggingFace

```bash
cd ../tachiyomi-compress
git add .
git commit -m "Initial commit: Tachiyomi compression service"
git push
```

HuggingFace automáticamente creará el contenedor Docker.

## Configurar en Tachiyomi

Una vez deployado en HuggingFace:

```
Original URL: https://huggingface.co/spaces/TU_USUARIO/tachiyomi-compress/file=/api/compress?url=
```

En la configuración de Tachiyomi:
- API Endpoint: `https://[tu-space].hf.space/api/compress`
- Parámetro: `?url=`

## Variables de Entorno en HuggingFace

En la Web de tu Space:
1. Settings → Repository secrets
2. Añadir variables:
   - `LOCAL_QUALITY=30`
   - `LOCAL_EFFORT=2`
   - `COMPRESSION_TIMEOUT_MS=30000` (30 segundos, sin prisa)
   - `MAX_SIZE_BYTES=102400` (100KB, más relajado)

## Monitoreo

Ver logs en tiempo real:
```
https://[tu-space].hf.space/logs
```

## Fallback a Vercel

Si quieres mantener Vercel como respaldo:
1. Configura Tachiyomi para intentar HuggingFace primero
2. Si falla, recurre a Vercel
3. Esto garantiza disponibilidad 24/7

## Pros y Contras

### HuggingFace Spaces ✅
- Sin límite de ejecución
- Excelente para compresión pesada
- Mejor para almacenamiento en caché
- Comunidad activa

### Verificador Vercel ✅
- Súper rápido para imágenes pequeñas (<60KB)
- Fallback de bajo costo
- Mejor latencia para usuarios cercanos

---

**Recomendación**: Usa HuggingFace como principal y Vercel como fallback.
