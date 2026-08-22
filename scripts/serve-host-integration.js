const fs = require('fs');
const http = require('http');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const debugRoot = path.join(projectRoot, 'debug');
const embedRoot = path.join(projectRoot, 'dist', 'embed');

const argument = process.argv.indexOf('--port');
const port = argument === -1 ? 8090 : Number(process.argv[argument + 1]);
if (!Number.isInteger(port) || port < 1 || 65535 < port) {
  throw new Error('--port must be an integer between 1 and 65535');
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const safeEmbedPath = (pathname) => {
  const relative = pathname.slice('/embed/'.length);
  const resolved = path.resolve(embedRoot, relative);
  return resolved.startsWith(`${embedRoot}${path.sep}`) ? resolved : null;
};

const requestedFile = (pathname) => {
  if (pathname === '/') {
    return path.join(debugRoot, 'host-integration.html');
  }
  if (pathname === '/host-integration.js') {
    return path.join(debugRoot, 'host-integration.js');
  }
  return pathname.startsWith('/embed/') ? safeEmbedPath(pathname) : null;
};

const respond = (
  response,
  status,
  body,
  type = 'text/plain; charset=utf-8'
) => {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': type,
  });
  response.end(body);
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const file = requestedFile(url.pathname);
  if (file === null) {
    respond(response, 404, 'Not found');
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error !== null) {
      respond(response, error.code === 'ENOENT' ? 404 : 500, error.message);
      return;
    }
    const type = contentTypes[path.extname(file)] ?? 'application/octet-stream';
    respond(response, 200, body, type);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Host integration debug server: http://127.0.0.1:${port}/`);
});
