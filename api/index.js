import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';
import fs from 'fs/promises';
import path from 'path';

// --- CONFIGURACIÓN DE SEGURIDAD Y RENDIMIENTO ---
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB
const FETCH_TIMEOUT_MS = 15000; // 15 segundos

// --- CONFIGURACIÓN DE COMPRESIÓN (para Manhua a Color) ---
const MAX_IMAGE_WIDTH = 1080;
const AVIF_QUALITY = 55;

// --- HEADERS DE NAVEGADOR HIPERREALISTAS ---
const HYPER_REALISTIC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Dest': 'image',
  'Sec-CH-UA': '"Google Chrome";v="138", "Chromium";v="138", "Not?A_Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Referer': 'https://www.google.com/'
};

export default async function handler(req, res) {
  const startTime = Date.now();
  const { url: imageUrl, debug } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // --- LÓGICA DE DESCARGA CORREGIDA Y MÁS COMPATIBLE ---
    const response = await fetch(imageUrl, { headers: HYPER_REALISTIC_HEADERS, signal: controller.signal });
    if (!response.ok) {
        throw new Error(`Error al obtener la imagen: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_INPUT_SIZE_BYTES) {
      throw new Error(`La imagen excede el límite de ${MAX_INPUT_SIZE_BYTES / 1024 / 1024} MB`);
    }

    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;
    // Comprobación de tamaño post-descarga por si el header no existía
    if (originalSize > MAX_INPUT_SIZE_BYTES) {
        throw new Error(`La imagen (tamaño real) excede el límite de ${MAX_INPUT_SIZE_BYTES / 1024 / 1024} MB`);
    }

    const originalContentType = response.headers.get('content-type') || 'image/jpeg';
    
    const metadata = await sharp(originalBuffer).metadata();
    if (metadata.pages && metadata.pages > 1) {
      res.setHeader('X-Image-Status', 'Passthrough: Animation detected');
      return sendOriginal(res, originalBuffer, originalContentType);
    }

    const compressedBuffer = await sharp(originalBuffer)
      .trim()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;
    const processingTime = Date.now() - startTime;

    if (debug === 'true') {
      return res.status(200).json({
        decision: compressedSize < originalSize ? 'Optimized' : 'Passthrough (Original better)',
        times: { total: `${processingTime}ms` },
        sizes: { original: originalSize, compressed: compressedSize, savings: originalSize - compressedSize },
        metadata: { format: metadata.format, width: metadata.width, height: metadata.height }
      });
    }

    if (compressedSize < originalSize) {
      res.setHeader('X-Image-Status', 'Optimized');
      return sendCompressed(res, compressedBuffer, originalSize, compressedSize);
    } else {
      res.setHeader('X-Image-Status', 'Passthrough: Original better');
      return sendOriginal(res, originalBuffer, originalContentType);
    }

  } catch (error) {
    console.error({ level: 'error', url: imageUrl, message: error.message, name: error.name });
    const fallbackBuffer = await fs.readFile(path.join(process.cwd(), 'public', 'error.png'));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Image-Status', 'Error-Fallback');
    res.status(200).send(fallbackBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

function sendCompressed(res, buffer, originalSize, compressedSize) {
  res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate');
  res.setHeader('Content-Type', 'image/avif');
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
