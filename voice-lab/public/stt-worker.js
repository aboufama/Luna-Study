let transcriber, busy = false;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const start = performance.now();
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      const model = data.model === 'whisper' ? 'Xenova/whisper-tiny.en' : 'onnx-community/moonshine-tiny-ONNX';
      transcriber = await pipeline('automatic-speech-recognition', model, {
        device: 'wasm', dtype: 'q8', progress_callback: p => self.postMessage({ type: 'progress', file: p.file, progress: p.progress, status: p.status }),
      });
      await transcriber(new Float32Array(8000), { max_new_tokens: 2 });
      self.postMessage({ type: 'loaded', ms: performance.now() - start });
    }
    if (data.type === 'transcribe') {
      if (!transcriber || busy) throw new Error('Local speech recognition is busy or not ready.');
      busy = true; const start = performance.now();
      try {
        const result = await transcriber(data.audio, { max_new_tokens: 160 });
        self.postMessage({ type: 'result', id: data.id, text: result.text?.trim() || '', ms: performance.now() - start });
      } finally { busy = false; }
    }
  } catch (e) { self.postMessage({ type: 'error', id: data.id, message: e.message || 'Local transcription failed.' }); }
};
