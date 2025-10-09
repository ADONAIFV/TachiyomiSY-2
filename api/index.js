import fetch from 'node-fetch';
import sharp from 'sharp';
import { AbortController } from 'abort-controller';
import fs from 'fs/promises';
import path from 'path';

// ... (Todas las constantes y headers se mantienen igual)
const MAX_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_WIDTH = 1080;
const AVIF_QUALITY = 55;
const HYPER_REALISTIC_HEADERS = { /* ... */ };

export default async function handler(req, res) {
  const startTime = Date.now();
  const { url: imageUrl, debug } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // El bloque try... se mantiene exactamente igual que la versión anterior
    const response = await fetch(imageUrl, { headers: HYPER_REALISTIC_HEADERS, signal: controller.signal });
    if (!response.ok) {
        throw new Error(`Error al obtener la imagen: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`La URL no devolvió una imagen válida. Content-Type recibido: ${contentType || 'ninguno'}`);
    }

    // ... (El resto del bloque try se mantiene idéntico, con la lógica de compresión, etc.)
    const originalBuffer = await response.buffer();
    const originalSize = originalBuffer.length;
    if (originalSize > MAX_INPUT_SIZE_BYTES) {
        throw new Error(`La imagen (tamaño real) excede el límite de ${MAX_INPUT_SIZE_BYTES / 1024 / 1024} MB`);
    }

    const originalContentType = contentType;
    
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
    // --- ESTE ES EL CAMBIO CRÍTICO ---
    console.error("[ERROR CAPTURADO]", { 
        url: imageUrl, 
        message: error.message, 
        name: error.name,
        // Loguear el objeto de error completo puede darnos más pistas
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });

    // En lugar de devolver una imagen, devolvemos un error 500 claro con el mensaje del error.
    // Esto es mucho mejor para depurar.
    return res.status(500).json({
      error: "Ha ocurrido un error interno en el servidor.",
      details: error.message,
      source: "API Catch Block"
    });

  } finally {
    clearTimeout(timeoutId);
  }
}

// ... Las funciones sendCompressed y sendOriginal se mantienen igual
function sendCompressed(res, buffer, originalSize, compressedSize) { /* ... */ }
function sendOriginal(res, buffer, contentType) { /* ... */ }
