import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';
import fs from 'fs/promises';
import path from 'path';

// --- CONFIGURACIÓN ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_WIDTH = 1080;
const HYPER_REALISTIC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': 'https://www.google.com/'
};

// --- NUEVA LÓGICA DE SELECCIÓN DE FORMATO (MÁS SIMPLE Y ROBUSTA) ---
function getBestFormat(acceptHeader = '') {
  if (acceptHeader.includes('image/avif')) {
    // Para navegadores modernos, usamos la máxima compresión
    return { format: 'avif', contentType: 'image/avif', quality: 55 };
  }
  // Para todos los demás (incluido Tachiyomi), usamos WebP. Es el estándar de oro.
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
    const response = await fetch(imageUrl, { headers: HYPER_REALISTIC_HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`Error al obtener la imagen: ${response.status} ${response.statusText}`);

    const originalContentTypeHeader = response.headers.get('content-type');
    if (!originalContentTypeHeader || !originalContentTypeHeader.startsWith('image/')) {
      throw new Error(`La URL no devolvió una imagen válida. Content-Type: ${originalContentTypeHeader || 'ninguno'}`);
    }
    
    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;
    if (originalSize > MAX_INPUT_SIZE_BYTES) throw new Error(`La imagen excede el límite de tamaño.`);

    const metadata = await sharp(originalBuffer).metadata();
    if (metadata.pages && metadata.pages > 1) {
      res.setHeader('X-Image-Status', 'Passthrough: Animation detected');
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
    const clientAcceptHeader = req.headers.accept;
    const targetFormat = getBestFormat(clientAcceptHeader);
    
    let imageProcessor = sharp(originalBuffer)
      .trim()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true });
      
    imageProcessor = imageProcessor[targetFormat.format]({ quality: targetFormat.quality });
    
    const compressedBuffer = await imageProcessor.toBuffer();
    const compressedSize = compressedBuffer.length;

    if (compressedSize < originalSize) {
      res.setHeader('X-Image-Status', `Optimized to ${targetFormat.format.toUpperCase()}`);
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize, targetFormat.contentType);
    } else {
      res.setHeader('X-Image-Status', 'Passthrough: Original better');
      return sendOriginal(res, originalBuffer, originalContentTypeHeader);
    }
    
  } catch (error) {
    console.error("[CRITICAL ERROR]", { errorMessage: error.message });
    const fallbackBuffer = await fs.readFile(path.join(process.cwd(), 'public', 'error.png'));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Image-Status', 'Error-Fallback');
    res.status(200).send(fallbackBuffer);
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
