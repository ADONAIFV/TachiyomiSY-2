const API_ROOT = window.location.origin + '/api/compress';
const apiUrlBox = document.getElementById('api-url');
const terminal = document.getElementById('terminal');
const detailStatus = document.getElementById('detail-status');
const detailProxy = document.getElementById('detail-proxy');
const detailFormat = document.getElementById('detail-format');
const detailQuality = document.getElementById('detail-quality');
const detailResult = document.getElementById('detail-result');
const detailRatio = document.getElementById('detail-ratio');
const placeholderMsg = document.getElementById('placeholder-msg');
const sliderContainer = document.getElementById('slider-container');
const btnAction = document.getElementById('btn-action');
const errorBox = document.getElementById('error-message');

apiUrlBox.textContent = `${API_ROOT}?url=`;

function log(msg, type = 'info') {
    const now = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line';

    let colorClass = 'log-info';
    if (type === 'success') colorClass = 'log-success';
    if (type === 'warn') colorClass = 'log-warn';

    line.innerHTML = `<span class="log-time">[${now}]</span> <span class="${colorClass}">${msg}</span>`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
}

function clearError() {
    errorBox.textContent = '';
    errorBox.style.display = 'none';
}

function setDetails(status, proxy = '-', format = '-', quality = '-', result = '-', ratio = '-') {
    detailStatus.textContent = status;
    detailProxy.textContent = proxy;
    detailFormat.textContent = format;
    detailQuality.textContent = quality;
    detailResult.textContent = result;
    detailRatio.textContent = ratio;
}

setDetails('Esperando URL', '-', '-', '-', 'Inactivo', '-');

const form = document.getElementById('compress-form');
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = document.getElementById('url-input').value.trim();
    if (!url) return;

    btnAction.disabled = true;
    btnAction.textContent = 'PROCESANDO...';
    placeholderMsg.style.display = 'none';
    sliderContainer.style.display = 'none';
    terminal.innerHTML = '';
    clearError();
    setDetails('Iniciando secuencia', '-', '-', '-', 'En progreso', '-');

    log('Iniciando secuencia de optimización...', 'info');
    log(`URL ingresada: ${url}`, 'info');

    const startTime = Date.now();

    try {
        const apiUrl = `${API_ROOT}?url=${encodeURIComponent(url)}`;
        log('Solicitando optimización al servidor...', 'info');

        const response = await fetch(apiUrl);
        const latency = Date.now() - startTime;

        if (!response.ok) {
            let errorText = `Error HTTP ${response.status}`;
            try {
                const json = await response.json();
                if (json?.error) errorText = json.error + (json.reason ? `: ${json.reason}` : '');
            } catch (extractError) {
                // ignore
            }
            throw new Error(errorText);
        }

        const inputSize = Number(response.headers.get('X-Input-Size') || 0);
        const outputSize = Number(response.headers.get('X-Output-Size') || 0);
        const proxyUsed = response.headers.get('X-Proxy-Used') || 'Desconocido';
        const processor = response.headers.get('X-Processor') || 'Desconocido';
        const contentType = response.headers.get('Content-Type') || 'image/webp';
        const qualityUsed = response.headers.get('X-Quality-Used') || 'N/A';
        const limitState = response.headers.get('X-Limit-60KB') || 'UNKNOWN';

        const blob = await response.blob();
        const optimizedUrl = URL.createObjectURL(blob);

        log(`Respuesta completa en ${latency}ms`, 'success');
        log(`Proxy utilizado: ${proxyUsed}`, 'info');
        log(`Procesador final: ${processor}`, 'info');
        log(`Peso original: ${formatBytes(inputSize)}, peso final: ${formatBytes(outputSize)}`, 'info');

        updateMetrics(latency, inputSize, outputSize);
        updateDetails(proxyUsed, contentType, qualityUsed, limitState, inputSize, outputSize);
        setupSlider(url, optimizedUrl);
        setDetails('Optimización completada', proxyUsed, contentType, qualityUsed, limitState === 'PASS' ? 'Sin cambio necesario' : 'Optimizado', `${Math.round((outputSize / inputSize) * 100)}%`);

        btnAction.disabled = false;
        btnAction.textContent = 'INICIAR SECUENCIA';
    } catch (error) {
        log(`ERROR: ${error.message}`, 'warn');
        showError(error.message);
        setDetails('Error de optimización', '-', '-', '-', 'Fallo', '-');
        placeholderMsg.style.display = 'block';
        btnAction.disabled = false;
        btnAction.textContent = 'REINTENTAR';
    }
});

function updateMetrics(latency, orig, comp) {
    document.getElementById('val-latency').textContent = `${latency}ms`;
    document.getElementById('val-orig').textContent = formatBytes(orig);
    document.getElementById('val-final').textContent = formatBytes(comp);

    const saving = orig > 0 ? Math.max(0, Math.round(((orig - comp) / orig) * 100)) : 0;
    document.getElementById('val-save').textContent = `${saving}%`;
    document.getElementById('bar-save').style.width = `${saving}%`;
}

function updateDetails(proxy, format, quality, result, orig, comp) {
    detailProxy.textContent = proxy;
    detailFormat.textContent = format;
    detailQuality.textContent = quality;
    detailResult.textContent = result;
    detailRatio.textContent = orig && comp ? `${Math.round((comp / orig) * 100)}%` : '-';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '0 B';

    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

function setupSlider(originalUrl, optimizedUrl) {
    const imgBefore = document.getElementById('img-before');
    const imgAfter = document.getElementById('img-after');
    const handle = document.querySelector('.slider-handle');

    sliderContainer.style.display = 'block';
    imgBefore.src = originalUrl;
    imgAfter.src = optimizedUrl;
    imgAfter.style.clipPath = 'polygon(0 0, 50% 0, 50% 100%, 0 100%)';
    handle.style.left = '50%';

    let isDragging = false;
    const moveHandler = (event) => {
        if (!isDragging) return;
        const rect = sliderContainer.getBoundingClientRect();
        const x = (event.clientX || event.touches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));

        handle.style.left = `${percent}%`;
        imgAfter.style.clipPath = `polygon(0 0, ${percent}% 0, ${percent}% 100%, 0 100%)`;
    };

    const startDrag = () => {
        isDragging = true;
        document.addEventListener('pointermove', moveHandler);
        document.addEventListener('pointerup', stopDrag);
    };

    const stopDrag = () => {
        isDragging = false;
        document.removeEventListener('pointermove', moveHandler);
        document.removeEventListener('pointerup', stopDrag);
    };

    handle.addEventListener('pointerdown', startDrag);
}

function copyToClipboard() {
    navigator.clipboard.writeText(apiUrlBox.textContent);
    log('Endpoint copiado al portapapeles', 'success');
}
