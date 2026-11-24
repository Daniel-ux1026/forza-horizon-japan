const { app, BrowserWindow, dialog, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const startUrl = 'apex://game/index.html';
const assetPath = /^\/(?:index\.html|manifest\.json|(?:css|js|vendor|assets)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9_-]+)+)$/i;

protocol.registerSchemesAsPrivileged([
    { scheme: 'apex', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

app.setAppUserModelId('io.github.danielux1026.apexroutes');
app.commandLine.appendSwitch('force-high-performance-gpu');

async function openGame() {
    protocol.handle('apex', (request) => {
        const url = new URL(request.url);
        if (url.host !== 'game' || !assetPath.test(url.pathname)) {
            return new Response('Recurso no disponible', { status: 404 });
        }
        return net.fetch(pathToFileURL(path.join(app.getAppPath(), url.pathname.slice(1))).href);
    });

    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 760,
        minHeight: 480,
        backgroundColor: '#0b1518',
        autoHideMenuBar: true,
        icon: path.join(app.getAppPath(), 'assets', 'apex-routes.ico'),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });

    window.webContents.on('will-navigate', (event, url) => {
        if (url !== startUrl) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL(startUrl);
}

app.whenReady().then(openGame).catch((error) => {
    dialog.showErrorBox('Apex Routes', `No se pudo iniciar el juego.\n${error.message}`);
    app.quit();
});

app.on('window-all-closed', () => app.quit());
