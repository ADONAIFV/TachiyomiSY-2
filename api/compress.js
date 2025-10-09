import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';

// --- CONFIGURACIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25000; // Un timeout generoso pero que no agota los 60s
const MAX_IMAGE_WIDTH = 1080;

// --- LÓGICA DE SELECCIÓN DE FORMATO ---
function getBestFormat(acceptHeader = '') {
  if (acceptHeader && acceptHeader.includes('image/avif')) {
    return { format: 'avif', contentType: 'image/avif', quality: 55 };
  }
  return { format: 'webp', contentType: 'image/webp', quality: 65 };
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
    // --- USANDO LOS HEADERS Y LA LÓGICA DE TU SCRIPT ORIGINAL ---
    const parsedUrl = new URL(imageUrl);
    const domain = parsedUrl.origin;
    
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': domain + '/',
        'Connection': 'keep-alive'
      }
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
      res.setHeader('X-Image-Status', 'Passthrough: Animation detected');
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
    const clientAcceptHeader = req.headers.accept;
    const targetFormat = getBestFormat(clientAcceptHeader);
    
    const compressedBuffer = await sharp(originalBuffer)
      .trim()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      [targetFormat.format]({ quality: targetFormat.quality })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    if (compressedSize < originalSize) {
      res.setHeader('X-Image-Status', `Optimized to ${targetFormat.format.toUpperCase()}`);
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize, targetFormat.contentType);
    } else {
      res.setHeader('X-Image-Status', 'Passthrough: Original better');
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    // --- USANDO EL FALLBACK DE REDIRECCIÓN DE TU SCRIPT ORIGINAL ---
    console.error("[FALLBACK ACTIVADO]", { url: imageUrl, errorMessage: error.message });
    res.setHeader('Location', imageUrl);
    res.status(302).send('Redireccionando a la fuente original por un error.');
  } finally {
    clearTimeout(timeoutId);
  }
}

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
