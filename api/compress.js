import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: CALIDAD ORO + BAJO CONSUMO ---
const CONFIG = {
    format: 'avif',       
    quality: 25,          // Restaurado: Tu calidad ideal
    width: 600,           // 600px para compensar el bajo esfuerzo y mantener <50KB
    effort: 2,            // <--- EL SALVAVIDAS: Rápido y bajo consumo de CPU
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

        // --- FASE 2: PROXY (Solo si es necesario) ---
        if (!response.ok || [403, 401, 521, 404, 500].includes(response.status)) {
            console.log(`Bloqueo (${response.status}). Activando Proxy...`);
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}`;
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

        // --- MOTOR AVIF HÍBRIDO ---
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

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
            .avif({
                quality: CONFIG.quality,      // 25 (La que te gustó)
                effort: CONFIG.effort,        // 2 (Para salvar tu cuenta Vercel)
                chromaSubsampling: '4:4:4'    // 4:4:4 (Restaurado: Texto nítido, colores perfectos)
            })
            .toBuffer();

        let finalBuffer = compressedBuffer;
        let isCompressed = true;

        if (compressedBuffer.length >= originalBuffer.length) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        res.setHeader('Content-Type', isCompressed ? 'image/avif' : 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalBuffer.length);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                input: originalBuffer.length,
                output: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalBuffer.length * 100)).toFixed(2)}%`,
                settings: 'AVIF Q25 | Chroma 4:4:4 | Effort 2'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('SysErr:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
