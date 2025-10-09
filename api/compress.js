import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';

// --- CONFIGURACIÓN DE FUSIÓN (Original + Mejoras) ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
// --- LA FILOSOFÍA ORIGINAL: RESOLUCIÓN AGRESIVA ---
const MAX_IMAGE_WIDTH = 600;
// --- LA FILOSOFÍA ORIGINAL: CALIDAD EXTREMA ---
const WEBP_QUALITY = 5;

// --- HEADERS DE TU SCRIPT ORIGINAL (LA LLAVE MAESTRA) ---
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

    if (!response.ok) throw new Error(`Error al obtener la imagen: ${response.status} ${response.statusText}`);

    const originalContentTypeHeader = response.headers.get('content-type');
    if (!originalContentTypeHeader || !originalContentTypeHeader.startsWith('image/')) {
      throw new Error(`La URL no devolvió una imagen válida. Content-Type: ${originalContentTypeHeader || 'ninguno'}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    
    const originalSize = originalBuffer.length;
    if (originalSize === 0) throw new Error("La imagen descargada está vacía (0 bytes).");
    if (originalSize > MAX_INPUT_SIZE_BYTES) throw new Error(`La imagen excede el límite de tamaño.`);

    const metadata = await sharp(originalBuffer).metadata();
    if (metadata.pages && metadata.pages > 1) {
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
    // --- PIPELINE DE HYPER-COMPRESSION MEJORADO ---
    const compressedBuffer = await sharp(originalBuffer)
      .trim() // Mejora: Eliminar bordes innecesarios.
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true }) // Filosofía Original: 600px.
      // --- NUESTRA ARMA SECRETA: QUANTIZATION ---
      .png({ colours: 256 }) // Mejora: Reduce la paleta antes de comprimir.
      .webp({ quality: WEBP_QUALITY, effort: 6 }) // Filosofía Original: Calidad 5 + Máximo esfuerzo.
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    // Solo servimos nuestra versión si es realmente más pequeña.
    if (compressedSize < originalSize) {
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize, 'image/webp');
    } else {
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    console.error("[FALLBACK ACTIVADO]", { url: imageUrl, errorMessage: error.message });
    res.setHeader('Location', imageUrl);
    res.status(302).send('Redireccionando a la fuente original por un error.');
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- FUNCIONES HELPER ---
function sendCompressed(res, buffer, originalSize, compressedSize, contentType) {
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate');
  res.setHeader('Content-Type', contentType);
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
