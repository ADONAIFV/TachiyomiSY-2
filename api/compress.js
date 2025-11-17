import fetch from 'node-fetch';
import sharp from 'sharp';
// NOTA: Se eliminó la dependencia 'abort-controller' porque es nativa en Node.js 18+.

// --- CONFIGURACIÓN FINAL DE PRODUCCIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024; // Límite de 30MB
const FETCH_TIMEOUT_MS = 20000; // 20 segundos para el timeout de la petición de imagen
const MAX_IMAGE_WIDTH = 600; // Ancho máximo para la compresión
const WEBP_QUALITY = 5; // Calidad WEBP muy agresiva

// --- HEADERS "LLAVE MAESTRA" ---
// Establecer headers de forma dinámica y robusta.
function getHeaders(req) {
  const refererHeader = req.headers.referer || req.headers['x-forwarded-host'];
  let domain = 'https://www.google.com/';

  if (refererHeader) {
      try {
          // Intentar parsear el dominio desde el referer
          const url = new URL(refererHeader.startsWith('http') ? refererHeader : `https://${refererHeader}`);
          domain = url.origin;
      } catch (e) {
          // Si falla, usar el valor por defecto
      }
  }

  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': domain,
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };
}

export default async function handler(req, res) {
  if (req.url.includes('favicon')) {
    return res.status(204).send(null);
  }
  
  const { url: imageUrl } = req.query;

  // 1. Manejo de URL y errores 400
  if (!imageUrl) {
    return res.status(400).send('Error 400: Parámetro "url" faltante.');
  }

  // 2. Control de Aborto y Timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Nota: Si el 'imageUrl' no es una URL válida (por los caracteres extra de Tachiyomi), 
  // esta línea fallará y enviará la URL al bloque 'catch' para el Fallback Inteligente.
  const domain = new URL(imageUrl).origin; 

  try {
    // 3. Obtener cabeceras y realizar la petición
    const headers = getHeaders(req);
    const fetchOptions = {
        method: 'GET',
        headers: headers,
        signal: controller.signal // Usar el signal para el timeout nativo
    };

    const response = await fetch(imageUrl, fetchOptions);

    // 4. Chequeo de estado y manejo de redirecciones
    if (!response.ok) {
        // Si la imagen no se puede obtener, redirigir inmediatamente a la original (Fallback Inteligente)
        return redirectToOriginal(res, imageUrl, `URL no accesible (HTTP ${response.status})`);
    }

    const originalContentTypeHeader = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    // 5. Validaciones de Contenido
    if (!originalContentTypeHeader || !originalContentTypeHeader.startsWith('image/')) {
        // En esta versión original, esta es la única validación fuerte contra "Ads/HTML"
        return redirectToOriginal(res, imageUrl, 'Contenido no es una imagen');
    }

    if (contentLength && parseInt(contentLength, 10) > MAX_INPUT_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, 'Imagen demasiado grande');
    }

    // 6. Carga de la imagen en memoria y chequeo de tamaño
    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;

    if (originalSize > MAX_INPUT_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, 'Imagen demasiado grande (después de la carga)');
    }
    
    // 7. Compresión con Sharp
    const compressedBuffer = await sharp(originalBuffer)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true }) // Redimensionar si es necesario
      .trim() // Eliminar bordes vacíos
      .webp({ quality: WEBP_QUALITY, effort: 6 }) // Calidad 5 (Máximo ahorro)
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    // 8. Validación de Ahorro y Envío
    if (compressedSize < originalSize) {
      // Si la compresión es efectiva, enviar la imagen comprimida
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize);
    } else {
      // Si la compresión no ahorra espacio, enviar la imagen original
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    // 9. Manejo de errores de red, timeout o URL inválida
    if (error.name === 'AbortError') {
        return redirectToOriginal(res, imageUrl, 'Petición cancelada por timeout');
    }
    // Para cualquier otro error (incluyendo si new URL(imageUrl) falló), activa la redirección.
    return redirectToOriginal(res, imageUrl, error.message);
  } finally {
    // 10. Limpieza
    clearTimeout(timeoutId);
  }
}

// --- FUNCIONES HELPER ---

/**
 * Redirige al cliente a la URL de la imagen original (Fallback Inteligente).
 */
function redirectToOriginal(res, imageUrl, reason) {
    console.error(`[FALLBACK INTELIGENTE ACTIVADO] para ${imageUrl}. Razón: ${reason}`);
    res.setHeader('Location', imageUrl);
    res.status(302).end(); 
}

/**
 * Envía la imagen comprimida.
 */
function sendCompressed(res, buffer, originalSize, compressedSize) {
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate'); 
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Original-Size', originalSize);
  res.setHeader('X-Compressed-Size', compressedSize);
  res.send(buffer);
}

/**
 * Envía la imagen original.
 */
function sendOriginal(res, buffer, contentType) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); 
  res.setHeader('Content-Type', contentType);
  res.send(buffer);
}
