import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN DE DEFENSA EN 3 CAPAS ---
const CONFIG = {
    // Configuración para el RESPALDO LOCAL (Fase 3)
    localQuality: 25,     // Tu petición: Q25
    localWidth: 720,      // 720px
    localEffort: 6,       // Máximo esfuerzo si llegamos a usar Vercel
    timeout: 15000,       // Tiempo total máximo
    maxInputSize: 30 * 1024 * 1024 
};

// Headers para el modo local (Fase 3)
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
        // ============================================================
        // FASE 1: PROXY "FRANCOTIRADOR" (Especificaciones Exactas)
        // ============================================================
        // Pedimos: AVIF, Q25, 720px.
        // Nota: wsrv usa chroma 4:2:0 por defecto para ahorrar, pero a Q25 se ve muy bien.
        const workerUrl1 = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=720&output=avif&q=25`;
        
        let response = await fetch(workerUrl1, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });

        if (response.ok) {
            clearTimeout(timeoutId);
            return sendProxyResponse(res, response, debug, 'Worker Tier 1 (High Spec)');
        }

        // ============================================================
        // FASE 2: PROXY "SEGURO" (Reintento Simplificado)
        // ============================================================
        console.log(`Worker Tier 1 falló (${response.status}). Reintentando modo seguro...`);
        
        // Quitamos '&q=25'. Dejamos que wsrv decida la mejor compresión por defecto.
        // A veces los servidores fallan con parámetros estrictos pero funcionan con los básicos.
        const workerUrl2 = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=720&output=avif`;
        
        response = await fetch(workerUrl2, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });

        if (response.ok) {
            clearTimeout(timeoutId);
            return sendProxyResponse(res, response, debug, 'Worker Tier 2 (Safe Mode)');
        }

        // ============================================================
        // FASE 3: EL TANQUE (VERCEL LOCAL - Effort 6)
        // ============================================================
        console.log(`Worker Tier 2 falló. Activando Vercel Engine (Effort 6)...`);

        // A. Descarga Directa
        response = await fetch(targetUrl, {
            headers: getHeaders(targetUrl),
            signal: controller.signal,
            redirect: 'follow'
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Fallo Total (Local): ${response.status}`);

        const originalBuffer = Buffer.from(await response.arrayBuffer());

        // B. Procesamiento Local Pesado
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        let pipeline = sharpInstance.trim({ threshold: 10 });

        if (metadata.width > CONFIG.localWidth) {
            pipeline = pipeline.resize({
                width: CONFIG.localWidth,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        // Aquí sí aplicamos Chroma 4:4:4 forzado porque tenemos el control total
        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.localQuality, // 25
                effort: CONFIG.localEffort,   // 6 (Máximo)
                chromaSubsampling: '4:4:4'    // Texto Perfecto
            })
            .toBuffer();

        let finalBuffer = compressedBuffer;
        if (compressedBuffer.length >= originalBuffer.length) {
            finalBuffer = originalBuffer;
        }

        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalBuffer.length);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', 'Vercel Local (Tier 3)');

        if (debug === 'true') {
            return res.json({
                source: 'Vercel Local',
                originalSize: originalBuffer.length,
                compressedSize: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalBuffer.length * 100)).toFixed(2)}%`,
                settings: 'AVIF Q25 | Effort 6 | Chroma 4:4:4'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('Fatal Error:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}

// Función auxiliar para enviar respuestas del Proxy
async function sendProxyResponse(res, response, debug, sourceName) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'image/avif');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Original-Size', 'Delegated'); 
    res.setHeader('X-Compressed-Size', buffer.length);
    res.setHeader('X-Processor', sourceName);

    if (debug === 'true') {
        return res.json({
            source: sourceName,
            status: 'Success',
            size: buffer.length,
            format: 'avif',
            cpuUsage: '0%'
        });
    }
    return res.send(buffer);
}
