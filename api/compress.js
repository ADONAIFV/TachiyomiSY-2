import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: PROTOCOLO HIDRA (LÍMITE ESTRICTO 60KB) ---
const CONFIG = {
    // Límite de la "Báscula": 60 KB
    // Si la imagen del proxy pesa más de esto, Vercel la comprime.
    maxSizeBytes: 60 * 1024, 
    
    // Configuración de Vercel (Modo Flash)
    localFormat: 'avif',
    localQuality: 5,      // Q5: Lo mínimo legible
    localEffort: 0,       // Effort 0: Velocidad máxima
    chroma: '4:4:4',      // Texto nítido
    
    timeout: 25000
};

// LISTA DE CABEZAS DE LA HIDRA (PROXIES)
const PROVIDERS = [
    'photon',
    'wsrv',
    'statically',
    'imagecdn'
];

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    if (!rawUrl) return res.status(400).json({ error: 'Falta ?url=' });

    let targetUrl = rawUrl;
    if (typeof targetUrl === 'string') {
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
        targetUrl = targetUrl.replace(/^https?:\/\//, '');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // ============================================================
        // PASO 1: ROTACIÓN DE PROXIES
        // ============================================================
        const champion = PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)];
        const proxyUrl = getProxyUrl(champion, targetUrl);

        let response = await fetch(proxyUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });

        if (!response.ok) {
            const backupUrl = getProxyUrl('photon', targetUrl);
            response = await fetch(backupUrl, { signal: controller.signal });
        }

        if (!response.ok) {
            return res.redirect(302, rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        }

        const inputBuffer = Buffer.from(await response.arrayBuffer());
        const inputSize = inputBuffer.length;

        // ============================================================
        // PASO 2: EL GUARDIÁN DE PESO (< 60 KB)
        // ============================================================
        
        let finalBuffer = inputBuffer;
        let finalFormat = response.headers.get('content-type') || 'image/webp';
        let processor = `Hydra Node (${champion})`;

        // Si pesa más de 60KB, Vercel interviene
        if (inputSize > CONFIG.maxSizeBytes) {
            
            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            
            // Compresión AVIF Extrema (Q5 + Effort 0)
            const compressedBuffer = await sharpInstance
                .avif({
                    quality: CONFIG.localQuality, // 5
                    effort: CONFIG.localEffort,   // 0
                    chromaSubsampling: CONFIG.chroma
                })
                .toBuffer();

            // Solo aplicamos si realmente bajó el peso
            if (compressedBuffer.length < inputSize) {
                finalBuffer = compressedBuffer;
                finalFormat = 'image/avif';
                processor = `Vercel Local (Reduced >60KB)`;
            }
        }

        clearTimeout(timeoutId);

        // ============================================================
        // PASO 3: ENTREGA
        // ============================================================
        res.setHeader('Content-Type', finalFormat);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', processor);

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                proxy_used: champion,
                input_size: inputSize,
                output_size: finalBuffer.length,
                limit_60kb: inputSize < CONFIG.maxSizeBytes ? 'PASS' : 'OPTIMIZED',
                processor: processor
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        if (!res.headersSent) {
            const originalFullUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
            return res.redirect(302, originalFullUrl);
        }
    }
}

function getProxyUrl(provider, url) {
    const encoded = encodeURIComponent(`https://${url}`);
    const raw = url; 

    switch (provider) {
        case 'photon': return `https://i0.wp.com/${raw}?w=720&q=60&strip=all`;
        case 'wsrv': return `https://wsrv.nl/?url=${encoded}&w=720&q=50&output=webp`;
        case 'statically': return `https://cdn.statically.io/img/${raw}?w=720&q=50&f=webp`;
        case 'imagecdn': return `https://imagecdn.app/v2/image/${encoded}?width=720&quality=50&format=webp`;
        default: return `https://i0.wp.com/${raw}?w=720`;
    }
}
