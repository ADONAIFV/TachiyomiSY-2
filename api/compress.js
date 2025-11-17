import fetch from 'node-fetch';
import sharp from 'sharp';
// --- CONFIGURACIÓN FINAL DE PRODUCCIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000; // 20 segundos es un timeout final y robusto
const MAX_IMAGE_WIDTH = 600;
const WEBP_QUALITY = 5;

// --- HEADERS "LLAVE MAESTRA" ---
function getHeaders(domain) {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': domain ? domain + '/' : 'https://www.google.com/',
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
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const parsedUrl = new URL(imageUrl);
    const domain = parsedUrl.origin;
    
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: getHeaders(domain)
    });

    if (!response.ok) {
        // Si la respuesta no es OK (ej. 401, 403, 521), lanzamos un error para activar el fallback.
        throw new Error(`Respuesta no exitosa del servidor de origen: ${response.status}`);
    }

    const originalContentTypeHeader = response.headers.get('content-type');
    if (!originalContentTypeHeader || !originalContentTypeHeader.startsWith('image/')) {
      throw new Error(`La URL no devolvió una imagen válida. Content-Type: ${originalContentTypeHeader || 'ninguno'}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    
    const originalSize = originalBuffer.length;
    if (originalSize === 0) throw new Error("La imagen descargada está vacía.");
    
    // Verificamos si es una imagen válida antes de continuar
    const metadata = await sharp(originalBuffer).metadata();
    if (metadata.pages && metadata.pages > 1) {
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
    const compressedBuffer = await sharp(originalBuffer)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .trim()
      .png({ colours: 256 }) 
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    if (compressedSize < originalSize) {
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize);
    } else {
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    // Si cualquier paso del 'try' falla, activamos la redirección.
    console.error(`[FALLBACK INTELIGENTE ACTIVADO] para ${imageUrl}. Razón: ${error.message}`);
    res.setHeader('Location', imageUrl);
    res.status(302).end(); // Usamos .end() para una respuesta más limpia.
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- FUNCIONES HELPER ---
function sendCompressed(res, buffer, originalSize, compressedSize) {
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate');
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Original-Size', originalSize);
  res.setHeader('X-Compressed-Size', compressedSize);
  res.send(buffer);
}

function sendOriginal(res, buffer, contentType) {
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Original-Size', buffer.length);
  res.setHeader('X-Compressed-Size', buffer.length);
  res.send(buffer);
      }

