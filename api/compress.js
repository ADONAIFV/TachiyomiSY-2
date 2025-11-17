import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN FINAL DE PRODUCCIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024; // Límite de 30MB
const MIN_IMAGE_SIZE_BYTES = 5 * 1024;        // Mínimo 5KB
const FETCH_TIMEOUT_MS = 20000; // 20 segundos
const MAX_IMAGE_WIDTH = 600; // Ancho máximo
const WEBP_QUALITY = 5; // Calidad fija (5/100)

// --- HEADERS "LLAVE MAESTRA" ---
function getHeaders(req, domain) {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': domain || 'https://www.google.com/',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };
}

export default async function handler(req, res) {
  if (req.url.includes('favicon')) {
    return res.status(204).send(null);
  }
  
  const { url: rawImageUrl } = req.query;

  // 🚨 DIAGNÓSTICO CLAVE: Imprime la URL tal como la recibe Vercel
  console.error(`[DIAGNÓSTICO] URL BRUTA RECIBIDA: ${rawImageUrl}`); 

  if (!rawImageUrl) {
    return res.status(400).send('Error 400: Parámetro "url" faltante.');
  }

  // --- SOLUCIÓN: EXTRACCIÓN Y LIMPIEZA FORZADA DE URL ---
  let imageUrl = rawImageUrl;
  if (typeof imageUrl === 'string') {
      try {
          imageUrl = decodeURIComponent(imageUrl);
      } catch (e) {}

      // Limpieza forzada: Usa Regex para encontrar la primera ocurrencia de http(s)://
      const match = imageUrl.match(/https?:\/\/.*/i);
      if (match && match[0]) {
          imageUrl = match[0];
          console.warn(`https://www.spanishdict.com/translate/saneada Extracción Regex Exitosa. URL limpia: ${imageUrl.substring(0, 80)}...`);
      } else if (imageUrl.indexOf('http') > 0) {
          // Fallback a la limpieza simple
          imageUrl = imageUrl.substring(imageUrl.indexOf('http'));
      }
  }
  // ----------------------------------------------------------------------

  // Control de Aborto y Timeout (Nativo)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  let domain = 'https://www.google.com/';

  try {
    // ⚠️ Esta línea puede fallar si la limpieza de la URL no fue suficiente
    const urlObject = new URL(imageUrl); 
    domain = urlObject.origin;

    // Obtener cabeceras y realizar la petición
    const headers = getHeaders(req, domain);
    const fetchOptions = {
        method: 'GET',
        headers: headers,
        signal: controller.signal,
        redirect: 'follow' // <--- ¡AÑADIDO! Esto fuerza a 'node-fetch' a seguir el 302.
    };

    const response = await fetch(imageUrl, fetchOptions);

    // Chequeo de estado HTTP y Validaciones de Contenido...
    if (!response.ok) {
        return redirectToOriginal(res, imageUrl, `URL no accesible (HTTP ${response.status})`);
    }

    const originalContentTypeHeader = response.headers.get('content-type');
    
    // VALIDACIÓN CRÍTICA: Bloquear HTML/JSON
    if (!originalContentTypeHeader || originalContentTypeHeader.includes('text/html') || originalContentTypeHeader.includes('application/json')) {
        return redirectToOriginal(res, imageUrl, `Contenido no es imagen: ${originalContentTypeHeader || 'desconocido'}. Posiblemente un login o ad.`);
    }

    if (!originalContentTypeHeader.startsWith('image/')) {
        return redirectToOriginal(res, imageUrl, 'Contenido no es un tipo de imagen válido (e.g., image/*)');
    }

    // Carga de la imagen en memoria y chequeo de tamaño
    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;

    if (originalSize > MAX_INPUT_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, `Imagen demasiado grande (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Bloqueo de imágenes sospechosamente pequeñas
    if (originalSize < MIN_IMAGE_SIZE_BYTES) {
        return redirectToOriginal(res, imageUrl, `Imagen sospechosamente pequeña (${(originalSize / 1024).toFixed(2)}KB), bloqueada como posible ad/error.`);
    }
    
    // Compresión con Sharp
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
    // Manejo de errores de Abort, Sharp, o URL inválida
    if (error.name === 'AbortError') {
        return redirectToOriginal(res, imageUrl, 'Petición cancelada por timeout');
    }
    
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
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate'); 
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Original-Size', originalSize);
  res.setHeader('X-Compressed-Size', compressedSize);
  res.send(buffer);
}

function sendOriginal(res, buffer, contentType) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); 
  res.setHeader('Content-Type', contentType);
  res.send(buffer);
}
