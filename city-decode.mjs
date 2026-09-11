// Serialized into a Blob Worker: no imports, network requests or credentials.
export function cityDecodeWorkerMain(decodeIndices) {
  self.onmessage = async ({ data }) => {
    const { id, buffer, metadata } = data;
    try {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      const decoded = metadata?.codec ? decodeIndices(inflated, metadata) : inflated;
      self.postMessage({ id, buffer: decoded.buffer }, [decoded.buffer]);
    } catch (error) {
      self.postMessage({ id, error: String(error?.message || error) });
    }
  };
}

// Kept self-contained so the original game entry can install it before its
// inline fetch shim without introducing another blocking module request.
export function installCityDecoder(workerMain, decodeIndices) {
  const jobs = new Map();
  let worker = null, disabled = false, nextId = 0;
  function stop(error) {
    disabled = true;
    worker?.terminate();
    worker = null;
    for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(error); }
    jobs.clear();
  }
  function getWorker() {
    if (disabled) return null;
    if (worker) return worker;
    if (typeof Worker !== 'function' || typeof DecompressionStream !== 'function') {
      disabled = true;
      return null;
    }
    let blobUrl;
    try {
      blobUrl = URL.createObjectURL(new Blob([
        `(${workerMain.toString()})(${decodeIndices.toString()});`,
      ], { type: 'text/javascript' }));
      worker = new Worker(blobUrl, { name: 'SF map decoder' });
      worker.onmessage = ({ data }) => {
        const job = jobs.get(data.id);
        if (!job) return;
        jobs.delete(data.id);
        clearTimeout(job.timer);
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(new Uint8Array(data.buffer));
      };
      worker.onerror = event => {
        event.preventDefault?.();
        stop(new Error('Map decoder worker unavailable'));
      };
      worker.onmessageerror = () => stop(new Error('Map decoder message failed'));
    } catch (error) { stop(error); }
    finally { if (blobUrl) URL.revokeObjectURL(blobUrl); }
    return worker;
  }
  function fallback(compressed, metadata) {
    const inflated = window.__sfGunzip(compressed);
    return metadata?.codec ? decodeIndices(inflated, metadata) : inflated;
  }
  window.__sfDecodeCityAsset = async (compressed, metadata) => {
    const target = getWorker();
    if (!target) return fallback(compressed, metadata);
    try {
      return await new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => stop(new Error('Map decoder timed out')), 20000);
        jobs.set(id, { resolve, reject, timer });
        // Preserve the compressed fetch cache; only transfer this worker copy.
        const copy = new Uint8Array(compressed);
        try { target.postMessage({ id, buffer: copy.buffer, metadata }, [copy.buffer]); }
        catch (error) { stop(error); }
      });
    } catch { return fallback(compressed, metadata); }
  };
  window.addEventListener('pagehide', () => {
    // Worker state survives bfcache only through the safe synchronous fallback.
    stop(new Error('Map decoder document closed'));
  }, { once: true });
}

export function injectCityDecoder(html, decodeIndices) {
  const marker = '<script id="sf-city-assets"';
  if (html.split(marker).length !== 2 || typeof decodeIndices !== 'function') {
    throw new Error('City decoder insertion target changed');
  }
  return html.replace(marker,
    `<script>(${installCityDecoder.toString()})(${cityDecodeWorkerMain.toString()},${decodeIndices.toString()});</script>\n${marker}`);
}
