// Gera os ícones do app instalável (public/icon-*.png e apple-touch-icon.png) sem depender de nenhuma biblioteca de imagem.
// Desenho: fundo rosa em degradê com um coração branco. Uso:  npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public');
const C1 = [224, 102, 143], C2 = [163, 53, 90]; // degradê diagonal (rosa claro -> rosa escuro)

// ---- PNG (RGBA 8 bits) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Desenho ----
// Coração: (x²+y²−1)³ − x²y³ ≤ 0
const inHeart = (x, y) => Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0;
const SS = 4; // supersampling 4x4 para bordas suaves

function icone(size, { heart = 0.5, radius = 0 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const unit = (size * heart) / 2.6, cx = size / 2, cy = size / 2 + unit * 0.08; // centraliza o desenho (o coração é mais "pesado" em cima)
  const r = radius * size;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let hearts = 0, inside = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = px + (sx + 0.5) / SS, fy = py + (sy + 0.5) / SS;
      // cantos arredondados (ícone "any"); com radius 0 o quadrado é cheio (maskable / apple-touch)
      let ok = true;
      if (r) { const dx = Math.max(r - fx, 0, fx - (size - r)), dy = Math.max(r - fy, 0, fy - (size - r)); ok = dx * dx + dy * dy <= r * r; }
      if (!ok) continue;
      inside++;
      if (inHeart((fx - cx) / unit, -(fy - cy) / unit)) hearts++;
    }
    const t = (px + py) / (2 * size);
    const bg = C1.map((c, i) => c + (C2[i] - c) * t);
    const i = (py * size + px) * 4, n = SS * SS;
    const a = hearts / n;
    buf[i] = Math.round(bg[0] * (1 - a) + 255 * a); buf[i + 1] = Math.round(bg[1] * (1 - a) + 255 * a); buf[i + 2] = Math.round(bg[2] * (1 - a) + 255 * a);
    buf[i + 3] = Math.round((inside / n) * 255);
  }
  return encodePng(size, size, buf);
}

const arquivos = {
  'icon-192.png': icone(192, { heart: 0.5, radius: 0.22 }),
  'icon-512.png': icone(512, { heart: 0.5, radius: 0.22 }),
  'icon-maskable-512.png': icone(512, { heart: 0.36 }),   // coração menor: cabe na "zona segura" de 80% usada por máscaras redondas
  'apple-touch-icon.png': icone(180, { heart: 0.5 }),     // o iOS aplica os cantos sozinho
};
for (const [nome, dados] of Object.entries(arquivos)) { fs.writeFileSync(path.join(OUT, nome), dados); console.log('✔', nome, dados.length, 'bytes'); }
