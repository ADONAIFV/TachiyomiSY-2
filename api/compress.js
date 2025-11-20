import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: PROTOCOLO HIDRA ---
const CONFIG = {
    // Límite de la "Báscula"
    maxSizeBytes: 100 * 1024, // 100 KB
    
    // Configuración de Vercel (Solo si el proxy falla o la imagen es pesada)
    localFormat: 'avif',
    localQuality: 25,
    localEffort: 3,
    chroma: '4:4:4',
    
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
        // Limpieza universal de URL
        targetUrl = targetUrl.replace(/^https?:\/\//, '');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // ============================================================
        // PASO 1: ROTACIÓN DE PROXIES (LA HIDRA)
        // ============================================================
        // Elegimos un "campeón" aleatorio para esta petición.
        const champion = PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)];
        const proxyUrl = getProxyUrl(champion, targetUrl);

        let response = await fetch(proxyUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });

        // SI FALLA EL CAMPEÓN, INTENTAMOS PHOTON (El más robusto) COMO RESPALDO
        if (!response.ok) {
            const backupUrl = getProxyUrl('photon', targetUrl);
            response = await fetch(backupUrl, { signal: controller.signal });
        }

        if (!response.ok) {
            // Si todo falla, redirigimos original
            return res.redirect(302, rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        }

        const inputBuffer = Buffer.from(await response.arrayBuffer());
        const inputSize = inputBuffer.length;

        // ============================================================
        // PASO 2: EL GUARDIÁN DE PESO
        // ============================================================
        
        let finalBuffer = inputBuffer;
        let finalFormat = response.headers.get('content-type') || 'image/webp';
        let processor = `Hydra Node (${champion})`;

        // Si pesa más de 100KB, Vercel interviene
        if (inputSize > CONFIG.maxSizeBytes) {
            
            // Procesamos localmente
            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            
            // Como viene de un proxy, ya está en ~720px. Solo convertimos formato.
            const compressedBuffer = await sharpInstance
                .avif({
                    quality: CONFIG.localQuality,
                    effort: CONFIG.localEffort,
                    chromaSubsampling: CONFIG.chroma
                })
                .toBuffer();

            // Verificación de eficiencia (Solo usamos si bajó el peso)
            if (compressedBuffer.length < inputSize) {
                finalBuffer = compressedBuffer;
                finalFormat = 'image/avif';
                processor = `Vercel Local (Filtered from ${champion})`;
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
                processor: processor,
                limit_check: inputSize < CONFIG.maxSizeBytes ? 'PASS' : 'OPTIMIZED'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (!res.headersSent) {
            const originalFullUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
            return res.redirect(302, originalFullUrl);
        }
    }
}

// --- GENERADOR DE URLs PARA CADA CABEZA ---
function getProxyUrl(provider, url) {
    const encoded = encodeURIComponent(`https://${url}`);
    const raw = url; 

    switch (provider) {
        case 'photon':
            // Photon: i0.wp.com/URL?w=720&q=60&strip=all
            return `https://i0.wp.com/${raw}?w=720&q=60&strip=all`;
        
        case 'wsrv':
            // Wsrv: wsrv.nl/?url=URL&w=720&q=50&output=webp
            return `https://wsrv.nl/?url=${encoded}&w=720&q=50&output=webp`;
        
        case 'statically':
            // Statically: cdn.statically.io/img/URL?w=720&q=50&f=webp
            return `https://cdn.statically.io/img/${raw}?w=720&q=50&f=webp`;
            
        case 'imagecdn':
            // ImageCDN: imagecdn.app/v2/image/URL?width=720&quality=50&format=webp
            return `https://imagecdn.app/v2/image/${encoded}?width=720&quality=50&format=webp`;
            
        default:
            return `https://i0.wp.com/${raw}?w=720`;
    }
}
