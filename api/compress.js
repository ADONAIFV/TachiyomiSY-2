import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: TEXTO NÍTIDO / FONDO COMPRIMIDO ---
const CONFIG = {
    format: 'webp',
    quality: 20,          // Bajamos a 20: Compresión agresiva para los fondos
    width: 600,           // Ancho contenido para móviles
    effort: 4,            // Balance CPU/Compresión
    timeout: 12000,       
    maxInputSize: 30 * 1024 * 1024 
};

const getHeaders = (targetUrl) => {
    const urlObj = new URL(targetUrl);
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': urlObj.origin, 
    };
};

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    if (!rawUrl) return res.status(400).json({ error: 'Falta ?url=' });

    let targetUrl = rawUrl;
    if (typeof targetUrl === 'string') {
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
        const match = targetUrl.match(/https?:\/\/.*/i);
        if (match && match[0]) targetUrl = match[0];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // --- FASE 1: DIRECTO ---
        let response;
        let usedProxy = false;

        try {
            response = await fetch(targetUrl, {
                headers: getHeaders(targetUrl),
                signal: controller.signal,
                redirect: 'follow'
            });
        } catch (e) {
            response = { ok: false, status: 500 };
        }

        // --- FASE 2: PROXY (Solo si falla directo) ---
        if (!response.ok || [403, 401, 521, 404, 500].includes(response.status)) {
            console.log(`Fallo directo (${response.status}). Activando Proxy Raw...`);
            
            // Pedimos la imagen "cruda" al proxy para evitar errores 404 de validación
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}`;
            
            response = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });
            usedProxy = true;
        }

        clearTimeout(timeoutId);

        // --- FASE 3: FALLBACK FINAL ---
        if (!response.ok) {
            // Si todo falla, redirigimos al original para no cortar la lectura
            return res.redirect(302, targetUrl);
        }

        const originalBuffer = Buffer.from(await response.arrayBuffer());

        // --- MOTOR DE COMPRESIÓN ---
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        // Trim estándar
        pipeline = pipeline.trim({ threshold: 12 });

        if (shouldResize) {
            pipeline = pipeline.resize({
                width: CONFIG.width,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        const compressedBuffer = await pipeline
            .webp({
                quality: CONFIG.quality, // 20
                effort: CONFIG.effort,   // 4
                smartSubsample: true,    // ACTIVADO: El texto rojo/azul se verá perfecto
                minSize: true
            })
            .toBuffer();

        let finalBuffer = compressedBuffer;
        let isCompressed = true;
        
        if (compressedBuffer.length >= originalBuffer.length) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalBuffer.length);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                input: originalBuffer.length,
                output: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalBuffer.length * 100)).toFixed(2)}%`,
                method: usedProxy ? 'Proxy' : 'Direct',
                settings: 'WebP Q20 | SmartSubsample: ON'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('SysErr:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
