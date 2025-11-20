import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN ---
const CONFIG = {
    // Lo que pedimos a los proxies
    targetWidth: 720,
    targetQuality: 25,
    
    // Lo que hace Vercel SI Y SOLO SI fallan los proxies
    localFormat: 'avif',
    localEffort: 4, 
    
    timeout: 14000,
    maxInputSize: 30 * 1024 * 1024 
};

const getHeaders = (targetUrl) => {
    try {
        const urlObj = new URL(targetUrl);
        return {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            'Referer': urlObj.origin, 
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
        // FASE 1: OBREROS EXTERNOS (Gasto CPU = 0%)
        // ============================================================
        // Intentamos obtener la imagen procesada externamente.
        // Si llega ALGO (AVIF, WebP, lo que sea), lo enviamos directo.
        
        // 1.1 WSRV.NL (Prioridad 1)
        try {
            const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.targetWidth}&output=avif&q=${CONFIG.targetQuality}`;
            const response = await fetch(wsrvUrl, { signal: controller.signal });
            
            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length > 100) {
                    clearTimeout(timeoutId);
                    // ¡DETENTE! No proceses nada. Envía lo que llegó.
                    // Si wsrv mandó WebP en vez de AVIF, lo aceptamos.
                    const contentType = response.headers.get('content-type') || 'image/avif';
                    return sendPassthrough(res, buffer, contentType, 'wsrv.nl', debug);
                }
            }
        } catch (e) {}

        // 1.2 STATICALLY (Prioridad 2)
        try {
            const cleanUrl = targetUrl.replace(/^https?:\/\//, '');
            const staticUrl = `https://cdn.statically.io/img/${cleanUrl}?w=${CONFIG.targetWidth}&f=avif&q=${CONFIG.targetQuality}`;
            const response = await fetch(staticUrl, { signal: controller.signal });

            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length > 100) {
                    clearTimeout(timeoutId);
                    const contentType = response.headers.get('content-type') || 'image/avif';
                    return sendPassthrough(res, buffer, contentType, 'statically', debug);
                }
            }
        } catch (e) {}

        // ============================================================
        // FASE 2: VERCEL LOCAL (Último Recurso - Gasto CPU Alto)
        // ============================================================
        // Solo llegamos aquí si wsrv y statically fallaron (bloqueo o error).
        // Aquí sí encendemos Sharp.
        
        console.log('Proxies fallaron. Activando procesamiento local...');

        const responseDirect = await fetch(targetUrl, {
            headers: getHeaders(targetUrl),
            signal: controller.signal,
            redirect: 'follow'
        });

        if (!responseDirect.ok) throw new Error(`Origen inaccesible: ${responseDirect.status}`);
        
        const originalBuffer = Buffer.from(await responseDirect.arrayBuffer());
        
        // Procesamiento Local
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        let pipeline = sharpInstance.trim({ threshold: 10 });

        if (metadata.width > CONFIG.targetWidth) {
            pipeline = pipeline.resize({
                width: CONFIG.targetWidth,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.targetQuality, // 25
                effort: CONFIG.localEffort,    // 4
                chromaSubsampling: '4:4:4'
            })
            .toBuffer();

        clearTimeout(timeoutId);

        // Safety Check
        let finalBuffer = compressedBuffer;
        if (compressedBuffer.length >= originalBuffer.length) {
            finalBuffer = originalBuffer;
        }

        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', 'Vercel Local (Fallback)');

        if (debug === 'true') {
            return res.json({
                source: 'Vercel Local',
                status: 'Processed Locally',
                size: finalBuffer.length
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        // ============================================================
        // FASE 3: REDIRECT FINAL
        // ============================================================
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}

// Función de "Passthrough" (Cero CPU)
function sendPassthrough(res, buffer, contentType, source, debug) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Compressed-Size', buffer.length);
    res.setHeader('X-Processor', `${source} (Passthrough)`);

    if (debug === 'true') {
        return res.json({
            source: source,
            status: 'Direct Relay (No CPU used)',
            format: contentType,
            size: buffer.length
        });
    }
    
    return res.send(buffer);
            } 
