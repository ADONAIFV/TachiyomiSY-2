import fetch from 'node-fetch';
import sharp from 'sharp';
// Nota: 'abort-controller' ha sido eliminado, utilizando la funcionalidad nativa de Node.js 18.

// --- CONFIGURACIÓN FINAL DE PRODUCCIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024; // Límite de 30MB
const MIN_IMAGE_SIZE_BYTES = 5 * 1024;        // Nuevo: Mínimo 5KB para evitar Ads/Placeholders
const FETCH_TIMEOUT_MS = 20000; // 20 segundos para el timeout de la petición
const MAX_IMAGE_WIDTH = 600; // Ancho máximo para la compresión
const WEBP_QUALITY = 5; // Calidad WEBP muy agresiva

// --- HEADERS "LLAVE MAESTRA" ---
function getHeaders(req) {
  const refererHeader = req.headers.referer || req.headers['x-forwarded-host'];
  let domain = 'https://www.google.com/';

  if (refererHeader) {
      try {
          // Intenta crear una URL para obtener el dominio Referer
          const url = new URL(refererHeader.startsWith('http') ? refererHeader : `https://${refererHeader}`);
          domain = url.origin;
      } catch (e) {
          // Si falla, usa el valor por defecto
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

  if (!imageUrl) {
    return res.status(400).send('Error 400: Parámetro "url" faltante.');
  }

  // Control de Aborto y Timeout (Nativo)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Obtener cabeceras y realizar la petición
    const headers = getHeaders(req);
    const fetchOptions = {
        method: 'GET',
        headers: headers,
        signal: controller.signal // Usar el signal para el timeout nativo
    };

    const response = await fetch(imageUrl, fetchOptions);

    // 1. Chequeo de estado HTTP
    if (!response.ok) {
        return redirectToOriginal(res, imageUrl, `URL no accesible (HTTP ${response.status})`);
    }

    const originalContentTypeHeader = response.headers.get('content-type');
    
    // 2. VALIDACIÓN CRÍTICA: Bloquear HTML/JSON (Login, Captcha, Errores)
    if (!originalContentTypeHeader || originalContentTypeHeader.includes('text/html') || originalContentTypeHeader.includes('application/json')) {
        return redirectToOriginal(res, imageUrl, `Contenido no es imagen: ${originalContentTypeHeader || 'desconocido'}. Posiblemente un login o ad.`);
    }

    // 3. Validar que es un tipo de imagen
    if (!originalContentTypeHeader.startsWith('image/')) {
        return redirectToOriginal(res, imageUrl, 'Contenido no es un tipo de imagen válido (e.g., image/*)');
    }

    // Carga de la imagen en memoria y chequeo de tamaño
    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;

    if (originalSize > MAX_INPUT_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, `Imagen demasiado grande (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    // 4. NUEVA OPTIMIZACIÓN: Bloqueo de imágenes sospechosamente pequeñas (Ads, Error, Placeholder)
    if (originalSize < MIN_IMAGE_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, `Imagen sospechosamente pequeña (${(originalSize / 1024).toFixed(2)}KB), bloqueada como posible ad/error.`);
    }
    
    // Compresión con Sharp (Optimización)
    const compressedBuffer = await sharp(originalBuffer)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .trim()
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    // Validación de Ahorro y Envío
    if (compressedSize < originalSize) {
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize);
    } else {
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    // Manejo de errores de Abort, Sharp o red
    if (error.name === 'AbortError') {
        return redirectToOriginal(res, imageUrl, 'Petición cancelada por timeout');
    }
    
    // Para cualquier otro error (Sharp, DNS, SSL), activa la redirección.
    return redirectToOriginal(res, imageUrl, `Error de procesamiento o red: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- FUNCIONES HELPER ---

function redirectToOriginal(res, imageUrl, reason) {
    console.error(`[FALLBACK INTELIGENTE ACTIVADO] para ${imageUrl}. Razón: ${reason}`);
    res.setHeader('Location', imageUrl);
    res.status(302).end(); 
}

function sendCompressed(res, buffer, originalSize, compressedSize) {
  // Caché CDN agresivo para la imagen comprimida
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate'); 
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Original-Size', originalSize);
  res.setHeader('X-Compressed-Size', compressedSize);
  res.send(buffer);
}

function sendOriginal(res, buffer, contentType) {
  // Caché moderado para la imagen original (podría cambiar en la fuente)
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); 
  res.setHeader('Content-Type', contentType);
  res.send(buffer);
}
