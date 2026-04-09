import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG = {
    maxSizeBytes: Number(process.env.MAX_SIZE_BYTES) || 102400, // 100KB para HF
    localFormat: process.env.LOCAL_FORMAT || 'avif',
    localQuality: Number(process.env.LOCAL_QUALITY) || 40,
    localQualityHigh: Number(process.env.LOCAL_QUALITY_HIGH) || 55,
    localQualityMin: Number(process.env.LOCAL_QUALITY_MIN) || 20,
    localEffort: Number(process.env.LOCAL_EFFORT) || 6, // Más alto en HF
    chroma: process.env.CHROMA || '4:4:4',
    timeout: Number(process.env.REQUEST_TIMEOUT_MS) || 60000, // 60s en HF
    compressionTimeoutMs: Number(process.env.COMPRESSION_TIMEOUT_MS) || 45000, // 45s sin prisa
    proxyWidth: Number(process.env.PROXY_WIDTH) || 720,
    proxyQuality: Number(process.env.PROXY_QUALITY) || 50,
    cacheMaxAge: Number(process.env.CACHE_MAX_AGE) || 7200,
    staleWhileRevalidate: Number(process.env.STALE_WHILE_REVALIDATE) || 604800,
    enableCache: process.env.ENABLE_CACHE !== 'false',
    cacheSize: Number(process.env.CACHE_SIZE) || 100, // Guardar últimas 100 imágenes
    parallelFetches: Number(process.env.PARALLEL_FETCHES) || 3,
    // Nuevas configuraciones para HF Spaces
    cacheDir: process.env.CACHE_DIR || '/tmp/compress_cache',
    maxCacheSize: Number(process.env.MAX_CACHE_SIZE) || 1024 * 1024 * 1024, // 1GB cache
    maxConcurrentJobs: Math.min(4, os.cpus().length * 2), // Máximo 4 jobs concurrentes
    enableDiskCache: process.env.ENABLE_DISK_CACHE !== 'false'
};

// Caché en memoria para URLs procesadas
const formatCache = new Map();
let cacheSize = 0;

function getCacheKey(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
}

// Inicializar directorio de cache para HF Spaces
async function initCache() {
    if (CONFIG.enableDiskCache) {
        try {
            await fs.mkdir(CONFIG.cacheDir, { recursive: true });
            console.log(`📁 Disk cache initialized: ${CONFIG.cacheDir}`);
        } catch (error) {
            console.warn('⚠️  Could not create cache directory:', error.message);
        }
    }
}

// Exportar función de inicialización
export { initCache };

// Gestión de caché en disco para HF Spaces
async function getDiskCache(cacheKey) {
    if (!CONFIG.enableDiskCache) return null;

    try {
        const cachePath = path.join(CONFIG.cacheDir, `${cacheKey}.bin`);
        const metaPath = path.join(CONFIG.cacheDir, `${cacheKey}.json`);

        const metaStats = await fs.stat(metaPath);
        if (Date.now() - metaStats.mtime.getTime() > CONFIG.cacheMaxAge * 1000) {
            await fs.unlink(cachePath).catch(() => {});
            await fs.unlink(metaPath).catch(() => {});
            return null;
        }

        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        const buffer = await fs.readFile(cachePath);

        console.log(`💾 Disk cache hit for ${cacheKey.substring(0, 8)}`);
        return { buffer, meta };
    } catch (error) {
        return null;
    }
}

async function setDiskCache(cacheKey, buffer, meta) {
    if (!CONFIG.enableDiskCache) return;

    try {
        const cachePath = path.join(CONFIG.cacheDir, `${cacheKey}.bin`);
        const metaPath = path.join(CONFIG.cacheDir, `${cacheKey}.json`);

        await fs.writeFile(cachePath, buffer);
        await fs.writeFile(metaPath, JSON.stringify({ ...meta, timestamp: Date.now() }));

        // Limpiar caché antiguo si es necesario
        const files = await fs.readdir(CONFIG.cacheDir);
        if (files.length > CONFIG.cacheSize * 2) { // Meta + bin files
            const sortedFiles = files
                .filter(f => f.endsWith('.json'))
                .map(f => ({
                    name: f,
                    path: path.join(CONFIG.cacheDir, f),
                    stat: fs.stat(path.join(CONFIG.cacheDir, f))
                }));

            const stats = await Promise.all(sortedFiles.map(f => f.stat));
            const fileStats = sortedFiles.map((f, i) => ({ ...f, mtime: stats[i].mtime }));

            fileStats.sort((a, b) => a.mtime - b.mtime);

            // Eliminar archivos más antiguos
            for (let i = 0; i < Math.max(0, fileStats.length - CONFIG.cacheSize); i++) {
                const baseName = fileStats[i].name.replace('.json', '');
                await fs.unlink(fileStats[i].path).catch(() => {});
                await fs.unlink(path.join(CONFIG.cacheDir, `${baseName}.bin`)).catch(() => {});
            }
        }
    } catch (error) {
        console.warn('⚠️  Could not write to disk cache:', error.message);
    }
}

// Procesamiento paralelo con límite para HF Spaces
const processingQueue = [];
let activeJobs = 0;

async function processWithLimit(fn) {
    return new Promise((resolve, reject) => {
        const execute = async () => {
            activeJobs++;
            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                activeJobs--;
                if (processingQueue.length > 0) {
                    const next = processingQueue.shift();
                    next();
                }
            }
        };

        if (activeJobs < CONFIG.maxConcurrentJobs) {
            execute();
        } else {
            processingQueue.push(execute);
        }
    });
}


const PROVIDERS = [
    'photon',
    'wsrv',
    'statically',
    'imagecdn'
];

function getCompressionOptions(format, quality, effort) {
    const options = { quality, effort };

    if (['avif', 'webp', 'heif'].includes(format)) {
        options.chromaSubsampling = CONFIG.chroma;
    }

    return options;
}

async function encodeBuffer(inputBuffer, format, quality, effort) {
    return sharp(inputBuffer, { animated: true, limitInputPixels: false })
        .toFormat(format, getCompressionOptions(format, quality, effort))
        .toBuffer();
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Compression timeout')), ms))
    ]);
}

async function compressBuffer(inputBuffer) {
    const format = CONFIG.localFormat;
    let best = null;
    let stage = 'none';
    let quality = CONFIG.localQuality;
    let effort = CONFIG.localEffort;

    try {
        // Primera pasada: calidad normal con máximo esfuerzo
        best = await encodeBuffer(inputBuffer, format, CONFIG.localQuality, CONFIG.localEffort);

        // Si no alcanza el tamaño objetivo, intenta con mayor calidad
        if (best.length > CONFIG.maxSizeBytes * 1.2) {
            const higherQuality = await encodeBuffer(inputBuffer, format, CONFIG.localQualityHigh, CONFIG.localEffort);
            
            if (higherQuality.length < best.length && higherQuality.length < inputBuffer.length) {
                best = higherQuality;
                quality = CONFIG.localQualityHigh;
                stage = 'quality-improved';
            }
        }

        // Fallback a menor calidad si es necesario
        if (best.length > CONFIG.maxSizeBytes) {
            const lowerQuality = await encodeBuffer(inputBuffer, format, CONFIG.localQualityMin, CONFIG.localEffort);
            
            if (lowerQuality.length < best.length) {
                best = lowerQuality;
                quality = CONFIG.localQualityMin;
                stage = 'fallback-quality';
            }
        }

        return {
            buffer: best,
            stage: stage || 'base',
            quality,
            effort,
            timeout: false
        };
    } catch (error) {
        console.error('Compression error:', error);
        return {
            buffer: null,
            stage: 'error',
            quality,
            effort,
            timeout: error.message.includes('timeout'),
            error: error.message
        };
    }
}

function getCachedCompression(cacheKey) {
    if (!CONFIG.enableCache) return null;
    
    const cached = formatCache.get(cacheKey);
    if (cached) {
        cached.hits = (cached.hits || 0) + 1;
        cached.lastAccess = Date.now();
        return cached.buffer;
    }
    return null;
}

function setCachedCompression(cacheKey, buffer) {
    if (!CONFIG.enableCache || !buffer) return;
    
    // Mantener el caché bajo control
    if (formatCache.size >= CONFIG.cacheSize) {
        // Eliminar el menos accedido
        let oldest = null;
        let oldestKey = null;
        
        for (const [key, value] of formatCache) {
            if (!oldest || (value.lastAccess || 0) < oldest.lastAccess) {
                oldest = value;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            formatCache.delete(oldestKey);
        }
    }
    
    formatCache.set(cacheKey, {
        buffer,
        timestamp: Date.now(),
        lastAccess: Date.now(),
        size: buffer.length
    });
}

export default async function handler(req, res) {
    const { url: rawUrl, debug, force } = req.query;

    if (!rawUrl) {
        return res.status(400).json({ error: 'Falta ?url=' });
    }

    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    const cacheKey = getCacheKey(normalizedUrl);

    // Verificar caché primero (a menos que se force)
    if (!force && CONFIG.enableCache) {
        const cached = formatCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CONFIG.cacheMaxAge * 1000) {
            console.log(`💾 Memory cache hit for ${cacheKey.substring(0, 8)}`);

            res.setHeader('Content-Type', cached.finalFormat);
            res.setHeader('Cache-Control', `public, max-age=${CONFIG.cacheMaxAge}, stale-while-revalidate=${CONFIG.staleWhileRevalidate}`);
            res.setHeader('Content-Length', String(cached.outputSize));
            res.setHeader('X-Input-Size', String(cached.inputSize));
            res.setHeader('X-Output-Size', String(cached.outputSize));
            res.setHeader('X-Compressed', String(cached.compressed));
            res.setHeader('X-Processor', cached.processor);
            res.setHeader('X-Proxy-Used', cached.provider);
            res.setHeader('X-Limit-60KB', cached.limitCheck);
            res.setHeader('X-Quality-Used', String(cached.qualityUsed));
            res.setHeader('X-Effort-Used', String(cached.effortUsed));
            res.setHeader('X-Compression-Stage', cached.compressionStage);
            res.setHeader('X-Compression-Ratio', cached.compressionRatio);
            res.setHeader('X-Cache-Status', 'HIT');

            if (debug === 'true') {
                return res.json({
                    ...cached.debugData,
                    cache_status: 'HIT'
                });
            }

            return res.send(cached.finalBuffer);
        }

        // Verificar caché en disco
        const diskCached = await getDiskCache(cacheKey);
        if (diskCached) {
            const { buffer, meta } = diskCached;

            res.setHeader('Content-Type', meta.finalFormat);
            res.setHeader('Cache-Control', `public, max-age=${CONFIG.cacheMaxAge}, stale-while-revalidate=${CONFIG.staleWhileRevalidate}`);
            res.setHeader('Content-Length', String(meta.outputSize));
            res.setHeader('X-Input-Size', String(meta.inputSize));
            res.setHeader('X-Output-Size', String(meta.outputSize));
            res.setHeader('X-Compressed', String(meta.compressed));
            res.setHeader('X-Processor', meta.processor);
            res.setHeader('X-Proxy-Used', meta.provider);
            res.setHeader('X-Limit-60KB', meta.limitCheck);
            res.setHeader('X-Quality-Used', String(meta.qualityUsed));
            res.setHeader('X-Effort-Used', String(meta.effortUsed));
            res.setHeader('X-Compression-Stage', meta.compressionStage);
            res.setHeader('X-Compression-Ratio', meta.compressionRatio);
            res.setHeader('X-Cache-Status', 'DISK_HIT');

            if (debug === 'true') {
                return res.json({
                    ...meta.debugData,
                    cache_status: 'DISK_HIT'
                });
            }

            return res.send(buffer);
        }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        // Procesar con límite de concurrencia para HF Spaces
        const result = await processWithLimit(async () => {
            const fetchResult = await fetchImage(normalizedUrl, controller);
            if (!fetchResult) {
                throw new Error('No se pudo obtener la imagen desde direct o proxies');
            }

            const { response, provider } = fetchResult;
            const inputBuffer = Buffer.from(await response.arrayBuffer());
            const inputSize = inputBuffer.length;

            let finalBuffer = inputBuffer;
            let finalFormat = response.headers.get('content-type') || 'image/webp';
            let processor = provider === 'direct' ? 'Direct Download' : `Hydra Node (${provider})`;
            let compressed = false;
            let compressionStage = 'none';
            let qualityUsed = CONFIG.localQuality;
            let effortUsed = CONFIG.localEffort;

            if (inputSize > CONFIG.maxSizeBytes) {
                const compressedResult = await compressBuffer(inputBuffer);

                if (compressedResult.buffer && compressedResult.buffer.length < inputSize) {
                    finalBuffer = compressedResult.buffer;
                    finalFormat = `image/${CONFIG.localFormat}`;
                    processor = `HF Spaces (${compressedResult.stage})`;
                    compressed = true;
                    compressionStage = compressedResult.stage;
                    qualityUsed = compressedResult.quality;
                    effortUsed = compressedResult.effort;
                } else if (compressedResult.timeout) {
                    processor = 'HF Spaces (Timeout)';
                    compressionStage = 'timeout';
                }
            }

            const outputSize = finalBuffer.length;
            const compressionRatio = inputSize > 0 ? Math.round((outputSize / inputSize) * 100) : 100;
            const limitCheck = inputSize < CONFIG.maxSizeBytes ? 'PASS' : 'OPTIMIZED';

            const resultData = {
                finalBuffer,
                finalFormat,
                inputSize,
                outputSize,
                compressed,
                processor,
                provider,
                limitCheck,
                qualityUsed,
                effortUsed,
                compressionStage,
                compressionRatio: `${compressionRatio}%`,
                debugData: {
                    status: 'Success',
                    proxy_used: provider,
                    input_size: inputSize,
                    output_size: outputSize,
                    limit_60kb: limitCheck,
                    quality_used: qualityUsed,
                    effort_used: effortUsed,
                    compression_stage: compressionStage,
                    compressed,
                    compression_ratio: `${compressionRatio}%`
                }
            };

            // Guardar en caché
            if (CONFIG.enableCache) {
                const cacheEntry = {
                    ...resultData,
                    timestamp: Date.now()
                };
                formatCache.set(cacheKey, cacheEntry);

                // Mantener tamaño del caché
                if (formatCache.size > CONFIG.cacheSize) {
                    const firstKey = formatCache.keys().next().value;
                    formatCache.delete(firstKey);
                }

                // Guardar en disco también
                await setDiskCache(cacheKey, finalBuffer, resultData);
            }

            return resultData;
        });

        // Enviar respuesta
        res.setHeader('Content-Type', result.finalFormat);
        res.setHeader('Cache-Control', `public, max-age=${CONFIG.cacheMaxAge}, stale-while-revalidate=${CONFIG.staleWhileRevalidate}`);
        res.setHeader('Content-Length', String(result.outputSize));
        res.setHeader('X-Input-Size', String(result.inputSize));
        res.setHeader('X-Output-Size', String(result.outputSize));
        res.setHeader('X-Compressed', String(result.compressed));
        res.setHeader('X-Processor', result.processor);
        res.setHeader('X-Proxy-Used', result.provider);
        res.setHeader('X-Limit-60KB', result.limitCheck);
        res.setHeader('X-Quality-Used', String(result.qualityUsed));
        res.setHeader('X-Effort-Used', String(result.effortUsed));
        res.setHeader('X-Compression-Stage', result.compressionStage);
        res.setHeader('X-Compression-Ratio', result.compressionRatio);
        res.setHeader('X-Cache-Status', 'MISS');

        if (debug === 'true') {
            return res.json({
                ...result.debugData,
                cache_status: 'MISS'
            });
        }

        return res.send(result.finalBuffer);
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

    // Intentar múltiples proxies en paralelo (limitado)
    const proxyPromises = PROVIDERS.slice(0, CONFIG.parallelFetches).map(provider => 
        tryFetch(getProxyUrl(provider, originalUrl), controller)
            .then(response => response && isImageResponse(response) ? { response, provider } : null)
    );

    for (const result of await Promise.all(proxyPromises)) {
        if (result) return result;
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
