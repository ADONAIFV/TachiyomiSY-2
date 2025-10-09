import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';
import fs from 'fs/promises';
import path from 'path';

// --- CONFIGURACIÓN FINAL ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000; // Un timeout más corto y razonable: 12 segundos
const MAX_IMAGE_WIDTH = 1080;

// --- HEADERS GENÉRICOS DE NAVEGADOR (Menos sospechosos que los de móvil) ---
function getHeaders(domain) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': domain + '/'
  };
}

// --- LÓGICA DE HYPER-COMPRESSION ---
function getBestFormat(acceptHeader = '') {
  if (acceptHeader && acceptHeader.includes('image/avif')) {
    return { format: 'avif', contentType: 'image/avif', quality: 45 };
  }
  return { format: 'webp', contentType: 'image/webp', quality: 50 };
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
    
    const clientAcceptHeader = req.headers.accept;
    const targetFormat = getBestFormat(clientAcceptHeader);
    
    const compressedBuffer = await sharp(originalBuffer)
      .trim()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .png({ colours: 256 }) // Quantization para máxima compresión
      [targetFormat.format]({ quality: targetFormat.quality })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;

    if (compressedSize < originalSize) {
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize, targetFormat.contentType);
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

// ... Las funciones sendCompressed y sendOriginal se mantienen igual
function sendCompressed(res, buffer, originalSize, compressedSize, contentType) { /* ... */ }
function sendOriginal(res, buffer, contentType) { /* ... */ }
