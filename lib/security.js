// Cabeçalhos de segurança, os mesmos no Express (server.js) e na Vercel (vercel.json, que serve os arquivos estáticos).
// O teste "cabeçalhos de segurança" garante que os dois lugares ficam iguais e que o hash do script embutido confere.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Único script embutido nas páginas (aplica o tema antes de desenhar, para não piscar). Seu hash é calculado do próprio HTML.
function inlineScriptHashes(dir = path.join(__dirname, '..', 'public')) {
  const out = new Set();
  for (const f of ['index.html', 'admin.html']) {
    const h = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) out.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return [...out];
}

function csp(hashes = inlineScriptHashes()) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // estilos em atributo style="" são usados na interface
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const headers = () => ({
  'Content-Security-Policy': csp(),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

module.exports = { headers, csp, inlineScriptHashes };
