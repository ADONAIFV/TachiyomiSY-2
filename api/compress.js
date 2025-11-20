import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN MAESTRA: PARALLEL RACING ---
const CONFIG = {
    maxSizeBytes: 100 * 1024, // 100 KB (Regla de Oro)
    
    // Configuración Local (Plan Z)
    localQuality: 25,
    localEffort: 3,
    chroma: '4:4:4',
    
    timeout: 20000,
};

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    if (!rawUrl) return res.status(400).json({ error: 'Falta ?url=' });

    // 1. Saneamiento
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
        // PASO 0: PREPARAR LA FUENTE (PHOTON)
        // ============================================================
        // Todos los obreros comerán de Photon para ser rápidos.
        const cleanUrl = targetUrl.replace(/^https?:\/\//, '');
        const photonUrl = `https://i0.wp.com/${cleanUrl}?w=720&strip=all`;

        // ============================================================
        // PASO 1: LA GRAN CARRERA (PROMISE.ANY)
        // ============================================================
        // Definimos a los corredores.
        
        const racerStatically = fetchWorker(
            `https://cdn.statically.io/img/${cleanUrl}?w=720&f=avif&q=25`, 
            'Statically', controller.signal
        );

        const racerWsrv = fetchWorker(
            `https://wsrv.nl/?url=${encodeURIComponent(photonUrl)}&output=avif&q=25`, 
            'wsrv.nl', controller.signal
        );

        const racerWeserv = fetchWorker(
            `https://images.weserv.nl/?url=${encodeURIComponent(photonUrl)}&output=avif&q=25`, 
            'weserv.nl', controller.signal
        );

        const racerImageCDN = fetchWorker(
            `https://imagecdn.app/v2/image/${encodeURIComponent(photonUrl)}?format=avif&quality=25`, 
            'imagecdn.app', controller.signal
        );

        let finalBuffer;
        let winnerName = '';

        try {
            // ¡DISPARO DE SALIDA!
            // Promise.any espera al PRIMERO que tenga éxito (resuelva).
            // Si uno falla, lo ignora y espera al siguiente.
            const winner = await Promise.any([
                racerStatically, 
                racerWsrv, 
                racerWeserv, 
                racerImageCDN
            ]);
            
            finalBuffer = winner.buffer;
            winnerName = winner.name;
            
        } catch (aggregateError) {
            console.log('Todos los corredores fallaron o excedieron 100KB.');
            // Si llegamos aquí, nadie ganó la carrera.
        }

        // ============================================================
        // PASO 2: VERCEL LOCAL (PLAN Z)
        // ============================================================
        if (!finalBuffer) {
            console.log('Activando Vercel Local...');
            
            // Descargamos de Photon (ligero)
            const sourceResp = await fetch(photonUrl, { 
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0' } 
            });
            
            let inputBuffer;
            if (sourceResp.ok) {
                inputBuffer = Buffer.from(await sourceResp.arrayBuffer());
            } else {
                // Fallback a original
                const directResp = await fetch(targetUrl, { signal: controller.signal });
                inputBuffer = Buffer.from(await directResp.arrayBuffer());
            }

            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            // Aseguramos resize (aunque Photon ya debió hacerlo)
            const metadata = await sharpInstance.metadata();
            let pipeline = sharpInstance;
            
            if (metadata.width > 720) {
                pipeline = pipeline.resize({ width: 720, withoutEnlargement: true, fit: 'inside', kernel: 'lanczos3' });
            }

            finalBuffer = await pipeline
                .avif({
                    quality: CONFIG.localQuality,
                    effort: CONFIG.localEffort,
                    chromaSubsampling: CONFIG.chroma
                })
                .toBuffer();
            
            winnerName = 'Vercel Local (Fallback)';
        }

        clearTimeout(timeoutId);

        // Respuesta Final
        res.setHeader('Content-Type', 'image/avif');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        res.setHeader('X-Processor', winnerName);

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                winner: winnerName,
                size: finalBuffer.length,
                mode: winnerName.includes('Vercel') ? 'CPU High' : 'CPU Zero (Race Winner)'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        // Red de Seguridad Final
        if (!res.headersSent) return res.redirect(302, `https://i0.wp.com/${targetUrl.replace(/^https?:\/\//, '')}?w=720`);
    }
}

// --- EL ENTRENADOR DE CORREDORES ---
// Esta función valida que el corredor cumpla las reglas para ganar.
async function fetchWorker(url, name, signal) {
    try {
        const response = await fetch(url, { 
            signal: signal,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);

        const buffer = Buffer.from(await response.arrayBuffer());
        const type = response.headers.get('content-type') || '';

        // REGLAS PARA GANAR LA CARRERA:
        // 1. Debe ser una imagen válida (>500 bytes)
        // 2. Debe pesar menos de 100KB
        // 3. Debe ser AVIF (Opcional: si quieres ser estricto descomenta la línea siguiente)
        // if (!type.includes('avif')) throw new Error(`${name} no devolvió AVIF`);

        if (buffer.length < 500) throw new Error(`${name} imagen vacía`);
        if (buffer.length > CONFIG.maxSizeBytes) throw new Error(`${name} muy pesada (${buffer.length})`);

        return { name, buffer };

    } catch (error) {
        // Si falla, rechazamos la promesa para que Promise.any siga buscando
        throw error;
    }
}
