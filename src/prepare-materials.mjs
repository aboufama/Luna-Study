import { readMaterial } from './imports.js';
import { duplicateMaterial, fingerprintUpload } from './material-dedup.mjs';
import { MAX_FILE_BYTES } from './study.js';

// Extract independently, then let the caller accept results in original order.
// This preserves deterministic duplicate and aggregate-size decisions without
// retaining every original file buffer or launching an unbounded set of PDFs.
export async function prepareMaterials(files, {
  existing = [], concurrency = 5, onEvent, testId, signal,
  readMaterialImpl = readMaterial, fingerprintImpl = fingerprintUpload,
} = {}) {
  const list = Array.from(files || []), saved = [...existing], results = new Array(list.length);
  const limit = Math.max(1, Math.min(5, Number.isInteger(concurrency) ? concurrency : 5));
  const extractions=new Map();
  let cursor = 0, completed = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor++, file = list[index];
      let type;
      try {
        if(signal?.aborted)throw signal.reason||new DOMException('Import canceled.','AbortError');
        if (file.size > MAX_FILE_BYTES) throw Error('This file is larger than 20 MB.');
        const arrayBuffer = await file.arrayBuffer(), fingerprint = await fingerprintImpl(arrayBuffer);
        if (duplicateMaterial({ fingerprint }, saved)) {
          results[index] = { duplicate: true, reason: 'identical-bytes', fingerprint };
          type = 'duplicate';
        } else {
          let extraction=extractions.get(fingerprint);
          if(!extraction){
            extraction=Promise.resolve().then(()=>readMaterialImpl(file,{arrayBuffer,testId,fingerprint,signal}));
            extractions.set(fingerprint,extraction);
            // Failed work must remain retryable; fulfilled work can serve later
            // copies in this batch without another paid vision request.
            void extraction.catch(()=>{if(extractions.get(fingerprint)===extraction)extractions.delete(fingerprint);});
          }
          const material=await extraction;
          results[index] = { material: { ...material,name:file.name,size:file.size,fingerprint } };
          type = 'prepared';
        }
      } catch (error) {
        results[index] = { error: error instanceof Error ? error : Error(String(error)) };
        type = 'failed';
      }
      completed++;
      try { onEvent?.({ index, total: list.length, completed, type }); } catch { /* Progress must not fail an import. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results;
}
