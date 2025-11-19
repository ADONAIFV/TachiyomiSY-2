javascript
import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN MAESTRA (MANHUA EDITION) ---
const CONFIG = {
    quality: 5,           // Calidad extrema (AVIF soporta esto bien)
    width: 600,           // Ancho fijo para móviles
    format: 'avif',       // El formato más eficiente actual
    effort: 6,            // (1-9) Mayor esfuerzo CPU = mejor calidad visual con poco peso
    timeout: 15000,       // 15 segundos máximo
    maxInputSize: 30 * 1024 * 1024 // 30MB límite
};

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    // 1. Validación básica
    if (!rawUrl) {
        return res.status(400).json({ error: 'Falta el parámetro ?url=' });
    }

    // 2. Limpieza de URL (Tu lógica original preservada)
    let targetUrl = rawUrl;
    if (typeof targetUrl === 'string') {
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
        // Regex para encontrar la primera ocurrencia real de http/https
        const match = targetUrl.match(/https?:\/\/.*/i);
        if (match && match[0]) targetUrl = match[0];
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // 3. Modo Camaleón: Headers para engañar a Cloudflare
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Referer': new URL(targetUrl).origin 
            },
            signal: controller.signal,
            redirect: 'follow'
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Origen respondió ${response.status}`);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error('La URL no es una imagen válida.');
        }

        const originalBuffer = Buffer.from(await response.arrayBuffer());
        const originalSize = originalBuffer.length;

        if (originalSize > CONFIG.maxInputSize) throw new Error('Imagen demasiado grande.');

        // 4. EL MOTOR GRÁFICO (Aquí ocurre la magia)
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        // A. Recorte de bordes inútiles (Auto-Trim)
        pipeline = pipeline.trim({ threshold: 10 });

        // B. Redimensionado Inteligente (Lanczos3 para texto nítido)
        if (shouldResize) {
            pipeline = pipeline.resize({
                width: CONFIG.width,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3' // Crucial para leer texto pequeño en 600px
            });
        }

        // C. Compresión AVIF Agresiva
        const compressedBuffer = await pipeline
            .avif({
                quality: CONFIG.quality,
                effort: CONFIG.effort,
                chromaSubsampling: '4:2:0' 
            })
            .toBuffer();

        // 5. Garantía "No Empeorar"
        // Si el original era más ligero (raro, pero posible), usamos el original
        let finalBuffer = compressedBuffer;
        let isCompressed = true;

        if (compressedBuffer.length >= originalSize) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        // 6. Enviar Respuesta
        res.setHeader('Content-Type', isCompressed ? 'image/avif' : contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalSize);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                originalSize,
                compressedSize: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalSize * 100)).toFixed(2)}%`,
                format: isCompressed ? 'avif' : 'original'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('Error:', error.message);
        // Fallback: Redirigir a la imagen original si fallamos
        if (!res.headersSent) return res.redirect(302, targetUrl);
        res.status(500).send('Error processing image');
    }
} 
