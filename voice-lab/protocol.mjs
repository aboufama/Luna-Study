export function pcmWav(pcm, rate = 16000) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF'); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44); return out;
}
export function validPcm(value, maxBytes = 960000) {
  if (typeof value !== 'string' || !value.length || value.length > maxBytes * 1.34 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64'); return bytes.length <= maxBytes && bytes.length % 2 === 0;
}
export async function* sseData(body) {
  const decoder = new TextDecoder(); let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 2_000_000) throw new Error('AI stream exceeded the response limit.');
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trimEnd(); pending = pending.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') return;
      if (data) yield JSON.parse(data);
    }
  }
  if (pending.startsWith('data:')) { const data = pending.slice(5).trim(); if (data && data !== '[DONE]') yield JSON.parse(data); }
}
export function localRequestAllowed(req, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || [...allowed].some(host => origin === `http://${host}`);
}
