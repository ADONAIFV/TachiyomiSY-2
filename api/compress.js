import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN MAESTRA (CALIBRACIÓN DE ALTA FIDELIDAD) ---
const CONFIG = {
    quality: 25,          // Aumentado de 5 a 25 (Elimina el efecto "borroso")
    width: 720,           // Aumentado a 720px (Mejor definición en HD)
    format: 'avif',
    effort: 6,            // Mantenemos esfuerzo alto para compactar bien
    timeout: 20000,       // 20 segundos (Damos un poco más de margen)
    maxInputSize: 30 * 1024 * 1024 
};

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    // 1. Validación
    if (!rawUrl) return res.status(400).json({ error: 'Falta ?url=' });

    // 2. Limpieza de URL
    let targetUrl = rawUrl;
    if (typeof targetUrl === 'string') {
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
        const match = targetUrl.match(/https?:\/\/.*/i);
        if (match && match[0]) targetUrl = match[0];
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // 3. Fetch "Camaleón"
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': new URL(targetUrl).origin 
            },
            signal: controller.signal,
            redirect: 'follow'
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Origen: ${response.status}`);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('image/')) throw new Error('No es imagen.');

        const originalBuffer = Buffer.from(await response.arrayBuffer());
        const originalSize = originalBuffer.length;

        if (originalSize > CONFIG.maxInputSize) throw new Error('Imagen muy grande.');

        // 4. MOTOR GRÁFICO 2.0 (Optimizado para Calidad/Peso)
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        // A. Trim inteligente
        pipeline = pipeline.trim({ threshold: 10 });

        // B. Resize Lanczos3 (Nitidez)
        if (shouldResize) {
            pipeline = pipeline.resize({
                width: CONFIG.width,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        // C. Compresión AVIF 4:4:4 (El secreto de la nitidez en texto)
        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.quality,
                effort: CONFIG.effort,
                chromaSubsampling: '4:4:4' // <--- CAMBIO CRÍTICO: Texto nítido, colores perfectos
            })
            .toBuffer();

        // 5. Lógica de decisión
        let finalBuffer = compressedBuffer;
        let isCompressed = true;

        if (compressedBuffer.length >= originalSize) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        // 6. Respuesta
        res.setHeader('Content-Type', isCompressed ? 'image/avif' : contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalSize);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                originalSize,
                compressedSize: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalSize * 100)).toFixed(2)}%`,
                format: isCompressed ? 'avif' : 'original',
                settings: 'Quality 25 | Width 720 | Chroma 4:4:4'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('Err:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
        res.status(500).send('Error');
    }
}
