import fetch from 'node-fetch';
import sharp from 'sharp';

// --- CONFIGURACIÓN OPTIMIZADA ---
const CONFIG = {
    format: 'webp',
    quality: 50,          // Calidad final de usuario (Equilibrio peso/calidad)
    width: 720,           
    effort: 4,            
    timeout: 15000,       
    maxInputSize: 30 * 1024 * 1024 
};

const getHeaders = (targetUrl) => {
    const urlObj = new URL(targetUrl);
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
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
        // --- INTENTO 1: ACCESO DIRECTO ---
        let response = await fetch(targetUrl, {
            headers: getHeaders(targetUrl),
            signal: controller.signal,
            redirect: 'follow'
        });

        // --- INTENTO 2: PROXY DE RELEVO (Optimizado) ---
        if (response.status === 403 || response.status === 401) {
            console.log(`Bloqueo detectado (${response.status}). Activando Relevo WSRV...`);
            
            // CAMBIO TÁCTICO: Pedimos WebP a calidad 85.
            // Es visualmente idéntico al original para propósitos de edición,
            // pero se transfiere mucho más rápido que un PNG.
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&output=webp&q=85`;
            
            response = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });
        }

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Fallo definitivo: ${response.status}`);

        const originalBuffer = Buffer.from(await response.arrayBuffer());
        const originalSize = originalBuffer.length;

        if (originalSize > CONFIG.maxInputSize) throw new Error('Imagen demasiado grande.');

        // --- MOTOR DE COMPRESIÓN ---
        const sharpInstance = sharp(originalBuffer, { animated: true, limitInputPixels: false });
        const metadata = await sharpInstance.metadata();

        const shouldResize = metadata.width > CONFIG.width;
        let pipeline = sharpInstance;

        pipeline = pipeline.trim({ threshold: 10 });

        if (shouldResize) {
            pipeline = pipeline.resize({
                width: CONFIG.width,
                withoutEnlargement: true,
                fit: 'inside',
                kernel: 'lanczos3'
            });
        }

        const compressedBuffer = await pipeline
            .webp({
                quality: CONFIG.quality, // 50 (Tu estándar)
                effort: CONFIG.effort,   // 4
                smartSubsample: true,
                minSize: true
            })
            .toBuffer();

        let finalBuffer = compressedBuffer;
        let isCompressed = true;
        if (compressedBuffer.length >= originalSize) {
            finalBuffer = originalBuffer;
            isCompressed = false;
        }

        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Original-Size', originalSize);
        res.setHeader('X-Compressed-Size', finalBuffer.length);
        
        if (debug === 'true') {
            return res.json({
                originalSize,
                compressedSize: finalBuffer.length,
                savings: `${(100 - (finalBuffer.length / originalSize * 100)).toFixed(2)}%`,
                method: response.url.includes('wsrv.nl') ? 'Proxy Relay (WebP q85 Transport)' : 'Direct Fetch',
                format: 'webp'
            });
        }

        return res.send(finalBuffer);

    } catch (error) {
        console.error('Err:', error.message);
        if (!res.headersSent) return res.redirect(302, targetUrl);
    }
            } 
