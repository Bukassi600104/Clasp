// Tiny webhook receiver for verification. Logs each request's signature + body.
import http from 'http';
import fs from 'fs';
const out = process.argv[2] || '/tmp/hooks.log';
fs.writeFileSync(out, '');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(out, JSON.stringify({ sig: req.headers['x-clasp-signature'] || '', body }) + '\n');
    res.writeHead(200);
    res.end('ok');
  });
}).listen(4001, () => console.log('receiver:4001'));
