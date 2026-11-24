// Servidor estático sin dependencias para Apex Routes.
// Uso:  node tools/server.mjs [puerto]      (por defecto 8080)
// Escucha en 0.0.0.0 para poder abrir el juego desde un móvil Android en la misma red Wi-Fi.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav'
};

export function createStaticServer() {
    return http.createServer((req, res) => {
        try {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            let filePath = path.join(ROOT, urlPath);
            const relativePath = path.relative(ROOT, filePath);
            // Bloquear path traversal fuera de la carpeta del proyecto
            if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
                res.writeHead(403).end('Forbidden');
                return;
            }
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                filePath = path.join(filePath, 'index.html');
            }
            // No exponer la carpeta .git ni ficheros ocultos
            if (relativePath.split(path.sep).some(part => part.startsWith('.'))) {
                res.writeHead(404).end('Not found');
                return;
            }
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                    'Cache-Control': 'no-cache'
                });
                res.end(data);
            });
        } catch (e) {
            res.writeHead(500).end('Server error');
        }
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const port = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
    createStaticServer().listen(port, '0.0.0.0', () => {
        console.log(`\n  Apex Routes listo:`);
        console.log(`  PC:      http://localhost:${port}/`);
        for (const list of Object.values(os.networkInterfaces())) {
            for (const net of list || []) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`  Android: http://${net.address}:${port}/   (misma red Wi-Fi)`);
                }
            }
        }
        console.log('\n  Ctrl+C para detener.\n');
    });
}
