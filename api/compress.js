import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN: EL GUARDIÁN DE PESO ---
const CONFIG = {
    // LÍMITE DE PASO (La "Báscula")
    maxSizeBytes: 100 * 1024, // 100 KB. Si pesa menos, pasa directo.
    
    // CONFIGURACIÓN PHOTON (Intento Inicial)
    photonWidth: 720,
    photonQuality: 60,    // Q60 WebP suele dar <80KB en mayoría de casos
    
    // CONFIGURACIÓN VERCEL (Solo si Photon falla el peso)
    localFormat: 'avif',
    localQuality: 25,     // AVIF Q25 (Tu estándar de oro)
    localEffort: 3,       // Effort 3 (Rápido pero eficiente)
    chroma: '4:4:4',      // Texto nítido
    
    timeout: 20000
};

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    if (!rawUrl) return res.status(400).json({ error: 'Falta ?url=' });

    let targetUrl = rawUrl;
    if (typeof targetUrl === 'string') {
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
        // Limpieza para Photon: Quitamos protocolo
        targetUrl = targetUrl.replace(/^https?:\/\//, '');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // ============================================================
        // PASO 1: PHOTON (MATERIA PRIMA)
        // ============================================================
        // Pedimos a Photon una imagen optimizada en WebP
        const photonUrl = `https://i0.wp.com/${targetUrl}?w=${CONFIG.photonWidth}&q=${CONFIG.photonQuality}&strip=all`;

        const response = await fetch(photonUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' 
            },
            signal: controller.signal
        });

        if (!response.ok) {
            // Si Photon falla, redirigimos a la original
            return res.redirect(302, rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        }

        // Obtenemos la imagen en memoria
        const inputBuffer = Buffer.from(await response.arrayBuffer());
        const inputSize = inputBuffer.length;

        // ============================================================
        // PASO 2: LA BÁSCULA (DECISIÓN DE VERCEL)
        // ============================================================
        
        let finalBuffer = inputBuffer;
        let finalFormat = response.headers.get('content-type') || 'image/webp';
        let processor = 'Photon Direct (Clean Pass)';
        let isProcessed = false;

        // CONDICIÓN: Si pesa más de 100KB, Vercel interviene.
        if (inputSize > CONFIG.maxSizeBytes) {
            console.log(`Imagen pesada (${Math.round(inputSize/1024)}KB). Iniciando compresión AVIF local...`);
            
            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            
            // Como viene de Photon, ya es 720px. Solo convertimos formato.
            // Usamos AVIF para bajar esos KB extra.
            const compressedBuffer = await sharpInstance
                .avif({
                    quality: CONFIG.localQuality, // 25
                    effort: CONFIG.localEffort,   // 3
                    chromaSubsampling: CONFIG.chroma // 4:4:4
                })
                .toBuffer();

            // VERIFICACIÓN DE SEGURIDAD:
            // Solo usamos la versión de Vercel si realmente logramos bajar el peso.
            // (A veces AVIF Q25 4:4:4 puede pesar más que WebP Q60 si la imagen es ruido puro)
            if (compressedBuffer.length < inputSize) {
                finalBuffer = compressedBuffer;
                finalFormat = 'image/avif';
                processor = 'Vercel Local (Weight Reduction)';
                isProcessed = true;
            } else {
                processor = 'Photon (Vercel tried but failed to reduce)';
            }
        }

        clearTimeout(timeoutId);

        // ============================================================
        // PASO 3: ENTREGA
        // ============================================================
        res.setHeader('Content-Type', finalFormat);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', 'Photon Source'); // No sabemos el original real, solo el de Photon
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', processor);

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                input_from_photon: inputSize,
                final_output: finalBuffer.length,
                processor: processor,
                limit_100kb: inputSize < CONFIG.maxSizeBytes ? 'PASSED' : 'EXCEEDED (Action Taken)',
                format: finalFormat
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
