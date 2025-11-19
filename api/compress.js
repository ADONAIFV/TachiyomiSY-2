import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: Q10 + 720PX (TEXTO LEGIBLE / BAJO CPU) ---
const CONFIG = {
    format: 'avif',
    quality: 10,          // Calidad muy baja (necesaria para compensar los 720px)
    width: 720,           // 720px: Mayor definición para leer letras pequeñas/rojas
    effort: 2,            // Modo Turbo
    timeout: 15000,       
    maxInputSize: 30 * 1024 * 1024 
};

const getHeaders = (targetUrl) => {
    const urlObj = new URL(targetUrl);
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
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
        // --- FASE 1: INTENTO DIRECTO ---
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

        // --- FASE 2: INTENTO PROXY (OPTIMIZADO PARA CPU) ---
        if (!response.ok || [403, 401, 521, 404, 500].includes(response.status)) {
            console.log(`Activando Proxy Optimizado...`);
            
            // <--- LA CLAVE DE LOS 7 SEGUNDOS A 1 SEGUNDO --->
            // Le pedimos al proxy que nos de la imagen YA redimensionada a 720px.
            // output=webp: Formato ligero para que viaje rápido a Vercel.
            // Vercel recibe un archivo pequeño y ya no tiene que redimensionar, solo convertir.
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.width}&output=webp`;
            
            response = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });
            usedProxy = true;
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
            return res.redirect(302, targetUrl);
        }

        const originalBuffer = Buffer.from(await response.arrayBuffer());

        // --- MOTOR AVIF ---
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        // Nota: Si viene del proxy, shouldResize será false (porque ya es 720px),
        // saltándose el paso de cálculo pesado de resize.
        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        // Trim suave (Threshold 10 es seguro)
        pipeline = pipeline.trim({ threshold: 10 });

        if (shouldResize) {
            pipeline = pipeline.resize({
                width: CONFIG.width,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.quality,      // 10
                effort: CONFIG.effort,        // 2
                chromaSubsampling: '4:4:4'    // CRUCIAL: Mantiene las letras rojas legibles a Q10
            })
            .toBuffer();

        let finalBuffer = compressedBuffer;
        let isCompressed = true;

        if (compressedBuffer.length >= originalBuffer.length) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalBuffer.length);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                input: originalBuffer.length,
                output: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalBuffer.length * 100)).toFixed(2)}%`,
                method: usedProxy ? 'Proxy (Pre-resized)' : 'Direct',
                settings: 'AVIF Q10 | Width 720 | Chroma 4:4:4'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('SysErr:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
