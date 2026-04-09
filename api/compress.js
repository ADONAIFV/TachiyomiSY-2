import sharp from 'sharp';

const CONFIG = {
    maxSizeBytes: Number(process.env.MAX_SIZE_BYTES) || 60 * 1024,
    localFormat: process.env.LOCAL_FORMAT || 'avif',
    localQuality: Number(process.env.LOCAL_QUALITY) || 30,
    localEffort: Number(process.env.LOCAL_EFFORT) || 0,
    chroma: process.env.CHROMA || '4:4:4',
    timeout: Number(process.env.REQUEST_TIMEOUT_MS) || 25000,
    proxyWidth: Number(process.env.PROXY_WIDTH) || 720,
    proxyQuality: Number(process.env.PROXY_QUALITY) || 50,
    cacheMaxAge: Number(process.env.CACHE_MAX_AGE) || 3600,
    staleWhileRevalidate: Number(process.env.STALE_WHILE_REVALIDATE) || 86400
};

const PROVIDERS = [
    'photon',
    'wsrv',
    'statically',
    'imagecdn'
];

export default async function handler(req, res) {
    const { url: rawUrl, debug } = req.query;

    if (!rawUrl) {
        return res.status(400).json({ error: 'Falta ?url=' });
    }

    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        const result = await fetchImage(normalizedUrl, controller);
        if (!result) {
            return res.status(502).json({ error: 'No se pudo obtener la imagen desde direct o proxies' });
        }

        const { response, provider } = result;
        const inputBuffer = Buffer.from(await response.arrayBuffer());
        const inputSize = inputBuffer.length;

        let finalBuffer = inputBuffer;
        let finalFormat = response.headers.get('content-type') || 'image/webp';
        let processor = provider === 'direct' ? 'Direct Download' : `Hydra Node (${provider})`;
        let compressed = false;

        if (inputSize > CONFIG.maxSizeBytes) {
            const sharpInstance = sharp(inputBuffer, { animated: true, limitInputPixels: false });
            const compressedBuffer = await sharpInstance[CONFIG.localFormat]({
                quality: CONFIG.localQuality,
                effort: CONFIG.localEffort,
                chromaSubsampling: CONFIG.chroma
            }).toBuffer();

            if (compressedBuffer.length < inputSize) {
                finalBuffer = compressedBuffer;
                finalFormat = `image/${CONFIG.localFormat}`;
                processor = `Vercel Local (Reduced >${Math.round(CONFIG.maxSizeBytes / 1024)}KB)`;
                compressed = true;
            }
        }

        const outputSize = finalBuffer.length;
        const compressionRatio = inputSize > 0 ? Math.round((outputSize / inputSize) * 100) : 100;

        res.setHeader('Content-Type', finalFormat);
        res.setHeader('Cache-Control', `public, max-age=${CONFIG.cacheMaxAge}, stale-while-revalidate=${CONFIG.staleWhileRevalidate}`);
        res.setHeader('Content-Length', String(outputSize));
        res.setHeader('X-Input-Size', String(inputSize));
        res.setHeader('X-Output-Size', String(outputSize));
        res.setHeader('X-Compressed', String(compressed));
        res.setHeader('X-Processor', processor);
        res.setHeader('X-Proxy-Used', provider);
        res.setHeader('X-Limit-60KB', inputSize < CONFIG.maxSizeBytes ? 'PASS' : 'OPTIMIZED');
        res.setHeader('X-Quality-Used', String(CONFIG.localQuality));
        res.setHeader('X-Compression-Ratio', `${compressionRatio}%`);

        if (debug === 'true') {
            return res.json({
                status: 'Success',
                proxy_used: provider,
                input_size: inputSize,
                output_size: outputSize,
                limit_60kb: inputSize < CONFIG.maxSizeBytes ? 'PASS' : 'OPTIMIZED',
                quality_used: CONFIG.localQuality,
                compressed,
                compression_ratio: `${compressionRatio}%`
            });
        }

        return res.send(finalBuffer);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(502).json({ error: 'Error interno', reason: error.message });
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

function normalizeUrl(rawUrl) {
    let candidate = String(rawUrl).trim();
    if (!/^https?:\/\//i.test(candidate)) {
        candidate = `https://${candidate}`;
    }

    try {
        const url = new URL(candidate);
        return url.toString();
    } catch {
        return null;
    }
}

function isImageResponse(response) {
    const type = response.headers.get('content-type');
    return Boolean(type && type.startsWith('image/'));
}

async function fetchImage(originalUrl, controller) {
    const directResponse = await tryFetch(originalUrl, controller);
    if (directResponse && isImageResponse(directResponse)) {
        return { response: directResponse, provider: 'direct' };
    }

    for (const provider of PROVIDERS) {
        const proxyUrl = getProxyUrl(provider, originalUrl);
        const response = await tryFetch(proxyUrl, controller);
        if (response && isImageResponse(response)) {
            return { response, provider };
        }
    }

    return null;
}

async function tryFetch(url, controller) {
    try {
        return await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal,
            redirect: 'follow'
        });
    } catch {
        return null;
    }
}

function getProxyUrl(provider, originalUrl) {
    const encoded = encodeURIComponent(originalUrl);
    const raw = encodeURIComponent(originalUrl.replace(/^https?:\/\//i, ''));

    switch (provider) {
        case 'photon':
            return `https://i0.wp.com/${raw}?w=${CONFIG.proxyWidth}&q=${Math.min(100, CONFIG.proxyQuality)}&strip=all`;
        case 'wsrv':
            return `https://wsrv.nl/?url=${encoded}&w=${CONFIG.proxyWidth}&q=${Math.min(100, CONFIG.proxyQuality)}&output=webp`;
        case 'statically':
            return `https://cdn.statically.io/img/${raw}?w=${CONFIG.proxyWidth}&q=${Math.min(100, CONFIG.proxyQuality)}&f=webp`;
        case 'imagecdn':
            return `https://imagecdn.app/v2/image/${encoded}?width=${CONFIG.proxyWidth}&quality=${Math.min(100, CONFIG.proxyQuality)}&format=webp`;
        default:
            return `https://i0.wp.com/${raw}?w=${CONFIG.proxyWidth}`;
    }
}
