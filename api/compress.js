import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN MAESTRA ---
const CONFIG = {
    // Lo que queremos al final
    finalFormat: 'avif',
    finalQuality: 25,
    finalWidth: 720,
    finalEffort: 4, 
    chroma: '4:4:4',
    
    timeout: 15000,
    maxInputSize: 30 * 1024 * 1024 
};

// Headers estándar
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
        let inputBuffer;
        let inputMime = '';
        let sourceUsed = '';
        let requiresProcessing = true; // Por defecto, asumimos que Vercel tendrá que trabajar

        // ============================================================
        // OBRERO 1: WSRV.NL (El más fiable)
        // ============================================================
        // Intentamos que ÉL nos de el AVIF Q25 directamente.
        // Si lo logra, Vercel no gasta CPU.
        try {
            const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=720&output=avif&q=25`;
            const resWsrv = await fetch(wsrvUrl, { signal: controller.signal });
            
            if (resWsrv.ok) {
                const buffer = Buffer.from(await resWsrv.arrayBuffer());
                if (buffer.length > 100) {
                    inputBuffer = buffer;
                    inputMime = resWsrv.headers.get('content-type') || '';
                    sourceUsed = 'wsrv.nl';
                    
                    // EL GRAN TRUCO: Si ya es AVIF, no hacemos nada más.
                    if (inputMime.includes('avif')) {
                        requiresProcessing = false; 
                    }
                }
            }
        } catch (e) { console.log('Wsrv falló, probando siguiente...'); }

        // ============================================================
        // OBRERO 2: STATICALLY (El refuerzo gratuito)
        // ============================================================
        // Si wsrv falló, probamos Statically.
        if (!inputBuffer) {
            try {
                // Statically usa estructura /img/URL
                // Quitamos el protocolo https:// de la url objetivo para Statically
                const cleanUrl = targetUrl.replace(/^https?:\/\//, '');
                const staticallyUrl = `https://cdn.statically.io/img/${cleanUrl}?w=720&f=avif&q=25`;
                
                const resStatic = await fetch(staticallyUrl, { signal: controller.signal });

                if (resStatic.ok) {
                    const buffer = Buffer.from(await resStatic.arrayBuffer());
                    if (buffer.length > 100) {
                        inputBuffer = buffer;
                        inputMime = resStatic.headers.get('content-type') || '';
                        sourceUsed = 'statically.io';
                        
                        if (inputMime.includes('avif')) {
                            requiresProcessing = false;
                        }
                    }
                }
            } catch (e) { console.log('Statically falló, probando directo...'); }
        }

        // ============================================================
        // OBRERO 3: DESCARGA DIRECTA (Último recurso)
        // ============================================================
        if (!inputBuffer) {
            const resDirect = await fetch(targetUrl, {
                headers: getHeaders(targetUrl),
                signal: controller.signal,
                redirect: 'follow'
            });
            
            if (!resDirect.ok) throw new Error(`Origen inaccesible: ${resDirect.status}`);
            
            inputBuffer = Buffer.from(await resDirect.arrayBuffer());
            inputMime = resDirect.headers.get('content-type');
            sourceUsed = 'Direct Origin';
            requiresProcessing = true; // Aquí SIEMPRE procesamos
        }

        clearTimeout(timeoutId);

        // ============================================================
        // FASE DE DECISIÓN DE VERCEL
        // ============================================================
        
        let finalBuffer;

        if (!requiresProcessing) {
            // CAMINO RÁPIDO (FAST LANE): 0% CPU
            // El obrero ya nos dio un AVIF. Lo enviamos tal cual.
            console.log(`Passthrough activado para ${sourceUsed}`);
            finalBuffer = inputBuffer;
        } else {
            // CAMINO LENTO (PROCESS LANE): Usamos CPU
            // Recibimos WebP, JPEG o PNG. Vercel tiene que convertirlo a AVIF.
            console.log(`Procesando imagen desde ${sourceUsed}...`);
            
            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            const metadata = await sharpInstance.metadata();
            
            let pipeline = sharpInstance;

            // Solo hacemos trim si viene directo (los proxys a veces cortan mal)
            if (sourceUsed === 'Direct Origin') {
                pipeline = pipeline.trim({ threshold: 10 });
            }

            // Resize si es necesario (Si viene de proxy, ya es 720px)
            if (metadata.width > CONFIG.finalWidth) {
                pipeline = pipeline.resize({
                    width: CONFIG.finalWidth,
                    withoutEnlargement: true,
                    fit: 'inside',
                    kernel: 'lanczos3'
                });
            }

            // Tu configuración sagrada
            finalBuffer = await pipeline
                .avif({
                    quality: CONFIG.finalQuality, // 25
                    effort: CONFIG.finalEffort,   // 4
                    chromaSubsampling: CONFIG.chroma
                })
                .toBuffer();
        }

        // Verificación final de tamaño (Safety check)
        if (finalBuffer.length >= inputBuffer.length && requiresProcessing) {
            finalBuffer = inputBuffer; // Si optimizar salió mal, enviamos lo que llegó
        }

        // Responder
        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', requiresProcessing ? `Vercel (Convert from ${sourceUsed})` : `Vercel (Passthrough ${sourceUsed})`);

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                source: sourceUsed,
                mode: requiresProcessing ? 'CPU Heavy (Conversion)' : 'CPU Zero (Passthrough)',
                size: finalBuffer.length
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error(`Error Fatal: ${error.message}`);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
}
