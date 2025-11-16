"use client";
import React, { useEffect, useRef, useState } from "react";

export default function Page() {
  const [imgURL, setImgURL] = useState<string | null>(null);
  const [clipLimit, setClipLimit] = useState(2.0); // 1.0..4.0 typical
  const [tiles, setTiles] = useState(8); // grid size (tiles × tiles)
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enhancedURL, setEnhancedURL] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Compare slider state
  const [sliderX, setSliderX] = useState(0.5);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false); // ✅ pointer events state

  // Load image and initialize both canvases so slider has size immediately
  useEffect(() => {
    if (!imgURL) return;
    const img = new Image();
    img.onload = () => {
      const before = beforeCanvasRef.current;
      const after = afterCanvasRef.current;
      if (!before) return;

      // Draw to BEFORE
      drawImageToCanvas(img, before);

      // ✅ Ensure AFTER has same size & something drawn (so overlay has dimensions)
      if (after) {
        after.width = before.width;
        after.height = before.height;
        const actx = after.getContext("2d")!;
        actx.clearRect(0, 0, after.width, after.height);
        actx.drawImage(img, 0, 0, after.width, after.height);
      }

      const afterNow = afterCanvasRef.current;
      setEnhancedURL(afterNow && afterNow.width ? afterNow.toDataURL("image/png") : null);

      if (autoRun) {
        requestAnimationFrame(() => runCLAHE());
        setAutoRun(false);
      }
    };
    img.crossOrigin = "anonymous";
    img.src = imgURL;
  }, [imgURL]);

  // Keep data URL when image changes or processing completes
  useEffect(() => {
    const after = afterCanvasRef.current;
    if (!after || !after.width) return;
    setEnhancedURL(after.toDataURL("image/png"));
  }, [imgURL, processing]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Silakan unggah file gambar (PNG/JPG/WebP).");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    setAutoRun(true);
    setImgURL(url);
  };

  function drawImageToCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement) {
    const maxW = 1200;
    const maxH = 1200;
    let { width: w, height: h } = img;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
  }

  function downloadEnhanced() {
    if (!afterCanvasRef.current) return;
    const a = document.createElement("a");
    a.href = afterCanvasRef.current.toDataURL("image/png");
    a.download = `clahe_enhanced_${Date.now()}.png`;
    a.click();
  }

  async function runCLAHE() {
    try {
      setProcessing(true);
      setError(null);
      const before = beforeCanvasRef.current;
      const after = afterCanvasRef.current;
      if (!before || !after) return;

      after.width = before.width;
      after.height = before.height;

      const bctx = before.getContext("2d")!;
      const actx = after.getContext("2d")!;

      const { data, width, height } = bctx.getImageData(0, 0, before.width, before.height);
      const out = new ImageData(width, height);

      // Convert to YCbCr and store channels
      const Y = new Uint8ClampedArray(width * height);
      const Cb = new Uint8ClampedArray(width * height);
      const Cr = new Uint8ClampedArray(width * height);

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b; // 0..255
        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
        const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
        Y[p] = y;
        Cb[p] = cb;
        Cr[p] = cr;
      }

      const tilesX = Math.max(2, Math.min(64, Math.floor(tiles)));
      const tilesY = tilesX;
      const tileW = Math.floor(width / tilesX) || 1;
      const tileH = Math.floor(height / tilesY) || 1;

      const maps: Uint8ClampedArray[] = [];
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const x0 = tx * tileW;
          const y0 = ty * tileH;
          const x1 = tx === tilesX - 1 ? width : x0 + tileW;
          const y1 = ty === tilesY - 1 ? height : y0 + tileH;
          const hist = new Uint32Array(256);
          const area = (x1 - x0) * (y1 - y0);
          for (let y = y0; y < y1; y++) {
            const row = y * width;
            for (let x = x0; x < x1; x++) {
              hist[Y[row + x]]++;
            }
          }

          const avg = area / 256;
          const limit = Math.max(1, Math.floor(avg * clipLimit));
          let excess = 0;
          for (let i = 0; i < 256; i++) {
            if (hist[i] > limit) {
              excess += hist[i] - limit;
              hist[i] = limit;
            }
          }
          const incr = Math.floor(excess / 256);
          const rem = excess % 256;
          for (let i = 0; i < 256; i++) hist[i] += incr;
          for (let i = 0; i < rem; i++) hist[i]++;

          const cdf = new Uint32Array(256);
          let c = 0;
          for (let i = 0; i < 256; i++) {
            c += hist[i];
            cdf[i] = c;
          }
          const scale = 255 / cdf[255];
          const map = new Uint8ClampedArray(256);
          for (let i = 0; i < 256; i++) {
            map[i] = Math.min(255, Math.max(0, Math.round(cdf[i] * scale)));
          }
          maps.push(map);
        }
      }

      function mapAt(x: number, y: number) {
        const tx = Math.min(tilesX - 1, Math.floor(x / tileW));
        const ty = Math.min(tilesY - 1, Math.floor(y / tileH));
        return maps[ty * tilesX + tx];
      }

      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const p = row + x;
          const mappedY = mapAt(x, y)[Y[p]];
          const yy = mappedY;
          const cb = Cb[p] - 128;
          const cr = Cr[p] - 128;
          let r = yy + 1.402 * cr;
          let g = yy - 0.344136 * cb - 0.714136 * cr;
          let b = yy + 1.772 * cb;
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;
          const i = p * 4;
          out.data[i] = r;
          out.data[i + 1] = g;
          out.data[i + 2] = b;
          out.data[i + 3] = 255;
        }
      }

      actx.putImageData(out, 0, 0);
      // Update downloadable URL after processing to avoid effect loops
      const afterNow2 = afterCanvasRef.current;
      if (afterNow2 && afterNow2.width) {
        setEnhancedURL(afterNow2.toDataURL("image/png"));
      }
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat memproses CLAHE. Coba kecilkan ukuran gambar atau ubah parameter.");
    } finally {
      setProcessing(false);
    }
  }

  // ===== Pointer Events for slider (replaces window mouse/touch listeners) =====
  function updateSliderFromClientX(clientX: number) {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(rect.left, Math.min(rect.right, clientX)) - rect.left;
    setSliderX(x / rect.width);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = sliderRef.current;
    if (!el) return;
    draggingRef.current = true;
    el.setPointerCapture?.(e.pointerId);
    updateSliderFromClientX(e.clientX); // jump to down point
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateSliderFromClientX(e.clientX);
    e.preventDefault();
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const el = sliderRef.current;
    draggingRef.current = false;
    el?.releasePointerCapture?.(e.pointerId);
  }

  const hasImage = !!imgURL;
  const hasResult = !!enhancedURL;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-50 backdrop-blur bg-white/70 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gray-900 text-white grid place-items-center font-bold">C</div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">CLAHE Image Enhancer</h1>
              <p className="text-xs text-gray-500 -mt-0.5">Contrast Limited Adaptive Histogram Equalization</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="px-3 py-2 rounded-2xl bg-gray-900 text-white text-sm shadow hover:shadow-md transition"
            >Unggah Gambar</button>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            <button
              onClick={runCLAHE}
              disabled={!hasImage || processing}
              className="px-3 py-2 rounded-2xl bg-indigo-600 text-white text-sm shadow disabled:opacity-50 hover:shadow-md transition"
            >{processing ? "Memproses…" : "Terapkan CLAHE"}</button>
            <button
              onClick={downloadEnhanced}
              disabled={!hasResult}
              className="px-3 py-2 rounded-2xl bg-white border text-sm shadow-sm disabled:opacity-50"
            >Unduh Hasil</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <section className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2 p-4 bg-white rounded-2xl shadow-sm">
            <h2 className="text-sm font-semibold mb-3">Parameter CLAHE</h2>
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Clip Limit <span className="text-gray-400">(1.0 – 4.0)</span></label>
                  <div className="text-sm tabular-nums font-medium">{clipLimit.toFixed(2)}</div>
                </div>
                <input type="range" min={1} max={4} step={0.01} value={clipLimit} onChange={(e) => setClipLimit(parseFloat(e.target.value))} className="w-full" />
                <p className="text-xs text-gray-500 mt-1">Semakin tinggi nilai, semakin agresif peningkatan kontras per ubin.</p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Tile Grid Size <span className="text-gray-400">(4 – 32)</span></label>
                  <div className="text-sm tabular-nums font-medium">{tiles} × {tiles}</div>
                </div>
                <input type="range" min={4} max={32} step={1} value={tiles} onChange={(e) => setTiles(parseInt(e.target.value))} className="w-full" />
                <p className="text-xs text-gray-500 mt-1">Ukuran kisi (jumlah ubin) memengaruhi lokalitas kontras. Nilai tinggi → detail lokal lebih kuat.</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-sm">
            <h2 className="text-sm font-semibold mb-3">Tips</h2>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>Mulai dari <span className="font-medium">Clip Limit 2.0</span> dan <span className="font-medium">Tile 8×8</span>.</li>
              <li>Jika muncul noise/blotchy, turunkan clip limit atau kurangi tile.</li>
              <li>Gambar besar akan diperkecil (maks 1200px) untuk performa.</li>
            </ul>
          </div>
        </section>

        <section className="p-4 bg-white rounded-2xl shadow-sm">
          <h2 className="text-sm font-semibold mb-3">Pratinjau Sebelum & Sesudah</h2>
          {!imgURL ? (
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">Unggah gambar untuk memulai. Format yang didukung: JPG, PNG, WebP.</div>
          ) : (
            <div className="relative overflow-hidden rounded-xl">
              <div className="relative">
                {/* Base: AFTER fills container */}
                <canvas ref={afterCanvasRef} className="block w-full h-auto" />

                {/* Overlay: full-size interactive layer (does NOT resize canvas) */}
                <div
                  ref={sliderRef}
                  className="absolute inset-0 cursor-ew-resize z-10"
                  aria-label="Compare slider"
                  style={{ touchAction: "none" }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {/* BEFORE canvas stays full size, clipped via CSS, so it won't shrink */}
                  <canvas
                    ref={beforeCanvasRef}
                    className="absolute inset-0 block w-full h-auto"
                    style={{ clipPath: `inset(0 ${100 - sliderX * 100}% 0 0)` }}
                  />

                  {/* Divider line */}
                  <div className="absolute inset-y-0" style={{ left: `${sliderX * 100}%` }}>
                    <div className="w-px h-full bg-white/80 mix-blend-difference" />
                  </div>

                  {/* Handle */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full shadow"
                    style={{ left: `${sliderX * 100}%` }}
                  >
                    <div className="w-10 h-10 bg-gray-900 text-white grid place-items-center rounded-full text-xs font-semibold select-none">⇆</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </section>

        <div className="text-xs text-gray-500 mt-6 flex items-center justify-between">
          <p>Dibuat dengan ❤️ • Metode: CLAHE pada kanal luminance (YCbCr).</p>
          <p>© {new Date().getFullYear()} — Demo Edukasi.</p>
        </div>
      </main>
    </div>
  );
}
