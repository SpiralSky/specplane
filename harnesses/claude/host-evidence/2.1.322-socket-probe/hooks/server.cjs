// Minimal Node HTTP listener on a Unix domain socket for Claude plugin probe.
// Spawned by $.process.spawn at session.start.
const http = require('node:http');
const fs = require('node:fs');

const socketPath = process.argv[2];
if (!socketPath) {
  process.stderr.write('Usage: node server.cjs <socketPath>\n');
  process.exit(1);
}

let requestCount = 0;
const pid = process.pid;
let ownsSocket = false;

function cleanup() {
  if (ownsSocket) {
    try { fs.unlinkSync(socketPath); } catch {}
    ownsSocket = false;
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let parsed = {};
    if (body) {
      try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
    }

    if (req.url === '/shutdown') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, shuttingDown: true, pid }));
      setTimeout(() => {
        server.close(() => {
          cleanup();
          process.exit(0);
        });
      }, 20);
      return;
    }

    if (req.url === '/crash') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, crashing: true, pid }));
      setTimeout(() => process.exit(42), 10);
      return;
    }

    if (req.url === '/flood') {
      const floodSize = Number.isInteger(parsed.size) ? Math.max(1, Math.min(parsed.size, 4194304)) : 65536;
      // A reply after the write callback lets a live probe observe backpressure.
      process.stdout.write('F'.repeat(floodSize) + '\n', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, flooded: floodSize, pid }));
      });
      return;
    }

    requestCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      pid,
      requestCount,
      received: parsed,
    }));
  });
});

process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', () => cleanup());

server.listen(socketPath, () => {
  ownsSocket = true;
  fs.chmodSync(socketPath, 0o600);
  process.stdout.write(`READY pid=${pid}\n`);
});
