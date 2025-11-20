import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN FINAL: CALIDAD HÍBRIDA ---
const CONFIG = {
    // Configuración de SALIDA (Lo que recibe Tachiyomi)
    finalFormat: 'avif',
    finalQuality: 25,     // Q25 AVIF
    finalWidth: 720,      // 720px
    finalEffort: 4,       // Effort 4 (Balanceado)
    chroma: '4:4:4',      // Texto Nítido

    // Configuración del OBRERO (wsrv.nl)
    // Le pedimos WebP de baja calidad para que la transferencia sea instantánea
    proxyQuality: 50,     
    
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
        let inputBuffer;
        let usedProxy = false;

        // ============================================================
        // PASO 1: INTENTO HÍBRIDO (Delegar a wsrv.nl)
        // ============================================================
        // Le pedimos al proxy:
        // 1. WebP (Su especialidad)
        // 2. 720px (Para que Vercel no tenga que redimensionar)
        // 3. Q50 (Para que llegue rápido a Vercel)
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=${CONFIG.finalWidth}&output=webp&q=${CONFIG.proxyQuality}`;

        try {
            const proxyResponse = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });

            if (proxyResponse.ok) {
                const buffer = Buffer.from(await proxyResponse.arrayBuffer());
                // Validación: Asegurar que recibimos una imagen válida
                if (buffer.length > 100) {
                    inputBuffer = buffer;
                    usedProxy = true;
                    // ¡ÉXITO! Tenemos una imagen de 720px lista para convertir.
                }
            }
        } catch (e) {
            console.log('Proxy falló o tardó demasiado. Pasando a descarga directa...');
        }

        // ============================================================
        // PASO 2: INTENTO DIRECTO (Si el Proxy falló)
        // ============================================================
        // Si wsrv.nl está bloqueado (403/404), Vercel tiene que bajar la original.
        if (!inputBuffer) {
            const directResponse = await fetch(targetUrl, {
                headers: getHeaders(targetUrl),
                signal: controller.signal,
                redirect: 'follow'
            });

            if (!directResponse.ok) {
                // Si falla el proxy Y falla el directo, no hay nada que hacer.
                // Lanzamos error para activar la redirección final.
                throw new Error(`Origen inaccesible: ${directResponse.status}`);
            }

            inputBuffer = Buffer.from(await directResponse.arrayBuffer());
        }

        // ============================================================
        // PASO 3: EL TOQUE FINAL (Vercel Engine)
        // ============================================================
        // Aquí ocurre la magia. Convertimos lo que tengamos a AVIF Q25.
        
        const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        let pipeline = sharpInstance;

        // Solo aplicamos Trim si venimos directo (el proxy a veces corta de más)
        if (!usedProxy) {
            pipeline = pipeline.trim({ threshold: 10 });
        }

        // Lógica de Redimensionado Inteligente:
        // Si venimos del Proxy, la imagen YA es 720px. Sharp detectará esto
        // y se saltará el paso de resize, ahorrando MUCHA CPU.
        if (metadata.width > CONFIG.finalWidth) {
            pipeline = pipeline.resize({
                width: CONFIG.finalWidth,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        // Conversión final a AVIF
        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.finalQuality, // 25
                effort: CONFIG.finalEffort,   // 4
                chromaSubsampling: CONFIG.chroma // 4:4:4
            })
            .toBuffer();

        clearTimeout(timeoutId);

        // Si por alguna razón el resultado es más grande que lo que recibimos (raro),
        // enviamos lo que recibimos (sea el WebP del proxy o el original).
        let finalBuffer = compressedBuffer;
        let finalFormat = 'image/avif';
        
        if (compressedBuffer.length >= inputBuffer.length) {
            finalBuffer = inputBuffer;
            finalFormat = usedProxy ? 'image/webp' : 'image/jpeg';
        }

        res.setHeader('Content-Type', finalFormat);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Source', usedProxy ? 'Hybrid (wsrv+Vercel)' : 'Direct (Vercel)');

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                source: usedProxy ? 'Hybrid (Proxy Pre-processing)' : 'Direct Fetch',
                inputSize: inputBuffer.length,
                outputSize: finalBuffer.length,
                format: finalFormat
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        // ============================================================
        // RED DE SEGURIDAD FINAL (REDIRECT)
        // ============================================================
        // Si todo falla, redirigimos a la imagen original.
        console.error(`Fatal Error: ${error.message}`);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
