// Ponte do navegador: entrada do print (colar, menu do iOS, galeria), pixels, zoom por pinça e storage
window.sapyor = (() => {
  // Leitura em até 1000 px de largura: sobra resolução pra casa e o WASM não sofre
  const MAX_WIDTH = 1000;
  let pixels = null;
  let url = null;
  let dotnet = null;

  async function loadBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    pixels = ctx.getImageData(0, 0, width, height).data;
    bitmap.close?.();

    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    return { url, width, height };
  }

  function deliver(promise) {
    promise
      .then(info => dotnet?.invokeMethodAsync('OnImage', info))
      .catch(err => dotnet?.invokeMethodAsync('OnImageError', err?.message ?? String(err)));
  }

  async function readClipboard() {
    if (!navigator.clipboard?.read)
      throw new Error('Este navegador não deixa ler imagem da área de transferência. Use "Galeria".');

    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) return loadBlob(await item.getType(type));
    }
    throw new Error('Não tem imagem na área de transferência. Tire o print e copie antes.');
  }

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.style.display = 'none';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) deliver(loadBlob(file));
  });

  // Ouvinte nativo no document: o iOS só libera clipboard.read() dentro do toque
  document.addEventListener('click', e => {
    const target = e.target.closest?.('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'paste') deliver(readClipboard());
    else if (target.dataset.action === 'pick') picker.click();
  });

  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    deliver(loadBlob(file));
  });

  // Arrastar o arquivo pra página (no PC)
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    const file = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    deliver(loadBlob(file));
  });

  function zoomable(viewer) {
    if (!viewer || viewer.dataset.zoomable) return;
    viewer.dataset.zoomable = '1';
    let start = null;

    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    viewer.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) return;
      start = { d: dist(e.touches), z: getZoom(viewer) };
    }, { passive: true });

    viewer.addEventListener('touchmove', e => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(viewer, start.z * dist(e.touches) / start.d, mid(e.touches));
    }, { passive: false });

    viewer.addEventListener('touchend', () => { start = null; });

    // Safari manda gesture* além dos toques; sem isso a página inteira dá zoom
    viewer.addEventListener('gesturestart', e => e.preventDefault());
    viewer.addEventListener('gesturechange', e => e.preventDefault());
  }

  function getZoom(viewer) {
    return parseFloat(viewer.style.getPropertyValue('--zoom')) || 1;
  }

  function setZoom(viewer, zoom, focus) {
    const old = getZoom(viewer);
    zoom = Math.min(8, Math.max(1, zoom));
    const rect = viewer.getBoundingClientRect();
    const fx = (focus?.x ?? rect.left + rect.width / 2) - rect.left;
    const fy = (focus?.y ?? rect.top + rect.height / 2) - rect.top;
    const cx = (viewer.scrollLeft + fx) / old;
    const cy = (viewer.scrollTop + fy) / old;
    viewer.style.setProperty('--zoom', zoom);
    viewer.scrollLeft = cx * zoom - fx;
    viewer.scrollTop = cy * zoom - fy;
  }

  return {
    init(ref) { dotnet = ref; },
    open(blob) { deliver(loadBlob(blob)); },
    takePixels() {
      const data = pixels;
      pixels = null;
      return data ? new Uint8Array(data.buffer) : new Uint8Array(0);
    },
    zoomable,
    zoomBy(viewer, factor) { setZoom(viewer, getZoom(viewer) * factor); },
    zoomReset(viewer) { setZoom(viewer, 1); },
    svgPoint(svg, clientX, clientY) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: -1, y: -1 };
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    load(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    save(key, value) {
      try { localStorage.setItem(key, value); } catch { }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { }
    },
    download(name, text) {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async copyText(text) {
      await navigator.clipboard.writeText(text);
    }
  };
})();
