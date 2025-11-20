import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: NO HAY EXCUSAS ---
const CONFIG = {
    finalFormat: 'avif',
    finalQuality: 25,
    finalWidth: 720,
    
    // Bajamos Effort a 3 para asegurar que Vercel logre terminar 
    // el trabajo antes del timeout, pero mantenemos la calidad.
    localEffort: 3,       
    
    timeout: 25000, // Aumentamos tiempo para asegurar que termine
    maxInputSize: 30 * 1024 * 1024 
};

// HEADERS ROBUSTOS (Para evitar bloqueos de Mangacrab/Leercapitulo)
const getHeaders = (targetUrl) => {
    try {
        const urlObj = new URL(targetUrl);
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': urlObj.origin, // Truco: Referer es el mismo sitio
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site'
        };
    } catch (e) { return {}; }
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
        // ============================================================
        // FASE 1: INTENTO DE PROXIES (Passthrough)
        // ============================================================
        // Intentamos obtener AVIF o WebP procesado externamente.
        
        // 1. WSRV.NL (Pedimos AVIF Q25)
        try {
            const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.finalWidth}&output=avif&q=${CONFIG.finalQuality}`;
            const resWsrv = await fetch(wsrvUrl, { signal: controller.signal });
            if (resWsrv.ok) {
                const buffer = Buffer.from(await resWsrv.arrayBuffer());
                if (buffer.length > 500) { // Validación mínima
                    clearTimeout(timeoutId);
                    return sendPassthrough(res, buffer, 'image/avif', 'wsrv.nl', debug);
                }
            }
        } catch (e) {}

        // 2. WSRV.NL FALLBACK (Pedimos WebP Q50 - Más compatible)
        try {
            const wsrvUrl2 = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.finalWidth}&output=webp&q=50`;
            const resWsrv2 = await fetch(wsrvUrl2, { signal: controller.signal });
            if (resWsrv2.ok) {
                const buffer = Buffer.from(await resWsrv2.arrayBuffer());
                if (buffer.length > 500) {
                    clearTimeout(timeoutId);
                    return sendPassthrough(res, buffer, 'image/webp', 'wsrv.nl (WebP)', debug);
                }
            }
        } catch (e) {}

        // ============================================================
        // FASE 2: VERCEL LOCAL (FORZADO)
        // ============================================================
        // Si llegamos aquí, los proxies fallaron. Vercel DEBE procesar.
        console.log('Proxies fallaron. Iniciando procesamiento local FORZADO...');

        const resDirect = await fetch(targetUrl, {
            headers: getHeaders(targetUrl),
            signal: controller.signal,
            redirect: 'follow'
        });

        if (!resDirect.ok) {
            throw new Error(`Origen bloqueado: ${resDirect.status}`);
        }
        
        const originalBuffer = Buffer.from(await resDirect.arrayBuffer());
        
        // CONFIGURACIÓN SHARP "A PRUEBA DE FALLOS"
        const sharpInstance = sharp(originalBuffer, { 
            animated: true, 
            limitInputPixels: false,
            failOnError: false // IMPORTANTE: Si la imagen tiene un error pequeño, la procesa igual
        });

        const metadata = await sharpInstance.metadata();
        let pipeline = sharpInstance;

        // 1. Siempre hacemos Trim (si funciona)
        try { pipeline = pipeline.trim({ threshold: 10 }); } catch (e) {}

        // 2. Redimensionado OBLIGATORIO
        // Incluso si la imagen es pequeña, aseguramos el ancho para estandarizar.
        if (metadata.width > CONFIG.finalWidth) {
            pipeline = pipeline.resize({
                width: CONFIG.finalWidth, // 720px
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        // 3. Conversión a AVIF OBLIGATORIA
        // Eliminamos la comprobación de tamaño. Enviamos el AVIF procesado SIEMPRE.
        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.finalQuality, // 25
                effort: CONFIG.localEffort,   // 3 (Suficiente para calidad, rápido para no timeout)
                chromaSubsampling: '4:4:4'    // Texto nítido
            })
            .toBuffer();

        clearTimeout(timeoutId);

        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalBuffer.length);
        res.setHeader('X-Compressed-Size', compressedBuffer.length);
        res.setHeader('X-Processor', 'Vercel Local (Forced)');

        if (debug === 'true') {
            return res.json({
                status: 'Processed Locally',
                source: 'Direct Fetch',
                inputSize: originalBuffer.length,
                outputSize: compressedBuffer.length,
                note: 'Resize and Compression Enforced'
            });
        }

        return res.send(compressedBuffer);

    } catch (error) {
        console.error(`Error Fatal: ${error.message}`);
        // Solo si realmente explota todo (Timeout, Error 500 real), redirigimos.
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}

function sendPassthrough(res, buffer, contentType, source, debug) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Compressed-Size', buffer.length);
    res.setHeader('X-Processor', `${source} (Passthrough)`);

    if (debug === 'true') {
        return res.json({
            source: source,
            status: 'Direct Relay',
            size: buffer.length
        });
    }
    return res.send(buffer);
} 
