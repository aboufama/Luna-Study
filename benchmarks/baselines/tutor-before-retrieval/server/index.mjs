import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './api.mjs';
import { createCodexOrganizer } from './codex.mjs';
import { createOpenAIOrganizer } from './openai-luna.mjs';
import { attachLiveVoice } from './live-voice.mjs';
import { createQuestionBank } from './question-bank.mjs';
import { createSessionHistory } from './session-history.mjs';
import { createUsageLedger } from './usage-ledger.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createMaterialIndexer } from './indexing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 5188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const usageLedger=createUsageLedger();
const diagnostics=createDiagnostics();
// Shared organizer interface serves indexing and private preparation on either transport.
const cliOrganizer = process.env.LUNA_ORGANIZER === 'codex-cli' ? await createCodexOrganizer({usageLedger}) : process.env.LUNA_ORGANIZER === 'openai-api' ? createOpenAIOrganizer({usageLedger,diagnostics}) : undefined;
const questionBank=createQuestionBank({organizer:cliOrganizer});
const sessionHistory=createSessionHistory({organizer:cliOrganizer,usageLedger});
const indexer=process.env.LUNA_ORGANIZER==='openai-api'?createMaterialIndexer({organizer:cliOrganizer,diagnostics}):undefined;
const api = createApiHandler({cliOrganizer,questionBank,sessionHistory,usageLedger,diagnostics,indexer,debugEnabled:!production,timeoutMs:120000});
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
let vite;
let dist;

async function serveProduction(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part.startsWith('.'))) { res.writeHead(404); res.end(); return; }
  let target = path.resolve(dist, `.${pathname}`);
  if (!target.startsWith(`${dist}${path.sep}`) && target !== dist) { res.writeHead(404); res.end(); return; }
  try {
    let info;
    try { info = await stat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info?.isFile()) {
      if (path.extname(pathname)) { res.writeHead(404); res.end(); return; }
      target = path.join(dist, 'index.html');
      info = await stat(target);
    }
    const resolved = await realpath(target);
    if (!resolved.startsWith(`${dist}${path.sep}`)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(resolved).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404); res.end(); }
}

const server = createServer(async (req, res) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) { res.writeHead(403); res.end('Use the local Luna app address.'); return; }
  try {
    if (await api(req, res)) return;
    if (production) await serveProduction(req, res);
    else vite.middlewares(req, res);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('The local app could not complete this request.'); }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
const liveVoice = attachLiveVoice(server, { cliOrganizer, questionBank, sessionHistory, usageLedger, diagnostics });

if (production) dist = await realpath(path.join(root, 'dist'));
else {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ root, server: { middlewareMode: true, ws: { server }, allowedHosts: ['localhost', '127.0.0.1'] }, appType: 'spa' });
}
server.listen(port, '127.0.0.1', () => console.log(`Luna Study is ready at http://127.0.0.1:${port}`));

async function shutdown() {
  indexer?.close();
  questionBank.close();
  await liveVoice.close();
  await sessionHistory.close();
  await usageLedger.close();
  await diagnostics.flush();
  server.close();
  server.closeAllConnections();
  if (vite) await vite.close();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
