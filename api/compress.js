import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: OBJETIVO 20-50 KB ---
const CONFIG = {
    format: 'webp',
    quality: 40,          // Bajamos a 40 (Punto dulce para WebP en Manhua)
    width: 640,           // 640px es el estándar móvil perfecto (ahorra 20% vs 720px)
    effort: 4,            
    timeout: 15000,       
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
        // --- INTENTO 1: DIRECTO ---
        let response;
        let usedProxy = false;

        try {
            response = await fetch(targetUrl, {
                headers: getHeaders(targetUrl),
                signal: controller.signal,
                redirect: 'follow'
            });
        } catch (fetchError) {
            // Si falla la conexión directa (DNS, 521, timeout), marcamos para usar proxy
            console.log(`Fallo directo (${fetchError.message}). Probando Proxy...`);
            response = { ok: false, status: 500 }; // Forzamos el fallo
        }

        // --- INTENTO 2: PROXY INTELLIGENTE (Si falló el directo o hay bloqueo 403/401/521) ---
        if (!response.ok || response.status === 403 || response.status === 401 || response.status === 521) {
            console.log(`Activando Relevo WSRV (Causa: ${response.status || 'Error Red'})...`);
            
            // TRUCO MAESTRO: Pedimos al proxy que YA nos dé la imagen redimensionada.
            // &w=640: El proxy hace el trabajo duro de redimensionar.
            // &q=60: Pedimos calidad media para que la descarga sea rápida.
            // &output=webp: Descargamos un archivo ligero.
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.width}&output=webp&q=60`;
            
            response = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });
            usedProxy = true;
        }

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Fallo definitivo: ${response.status}`);

        const originalBuffer = Buffer.from(await response.arrayBuffer());
        
        // --- MOTOR DE COMPRESIÓN ---
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        // Si venimos del proxy, la imagen YA viene en 640px (o menos),
        // así que Sharp tiene que trabajar muy poco. ¡Ahorro masivo de CPU!
        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        // Solo hacemos trim si NO usamos el proxy (el proxy a veces corta mal si hacemos trim sobre trim)
        // O si prefieres siempre trim, déjalo, pero consume CPU. 
        // Lo dejamos activado para asegurar bordes limpios.
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
            .webp({
                quality: CONFIG.quality, // 40
                effort: CONFIG.effort,   // 4
                smartSubsample: true,    // Vital para leer texto a calidad 40
                minSize: true
            })
            .toBuffer();

        // Lógica de seguridad: Si comprimir aumentó el tamaño (raro), usa el original
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
                inputSize: originalBuffer.length,
                finalSize: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalBuffer.length * 100)).toFixed(2)}%`,
                source: usedProxy ? 'Proxy (Pre-optimized)' : 'Direct',
                settings: 'WebP Q40 | Width 640'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('Err:', error.message);
        // Redirección final de emergencia
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
