const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Serves only synthetic fixtures and the distribution script on a loopback port.
const root = path.resolve(__dirname, '../..');
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const files = {
        '/': ['tests/browser/fixture.html', 'text/html; charset=utf-8'],
        '/fixture.js': ['tests/browser/fixture.js', 'text/javascript; charset=utf-8'],
        '/tracker.js': ['civitai-seen-tracker.user.js', 'text/javascript; charset=utf-8']
    };
    const route = files[url.pathname];
    if (req.method !== 'GET' || !route) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(root, route[0])));
});
server.listen(0, '127.0.0.1', () => {
    console.log(`Synthetic browser fixture: http://127.0.0.1:${server.address().port}/`);
});
