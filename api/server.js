import express from 'express';
import handler from './compress.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7860;

// Servir archivos estáticos
app.use(express.static(join(__dirname, '../public')));

// Ruta de compresión
app.get('/api/compress', async (req, res) => {
    await handler(req, res);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error', reason: err.message });
});

app.listen(PORT, () => {
    console.log(`🚀 Compression service running on port ${PORT}`);
});
