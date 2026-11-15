// Sessões "sem estado" (stateless): o cookie carrega os dados assinados com HMAC-SHA256.
// Necessário na Vercel, onde cada requisição pode cair em uma instância diferente (sem memória compartilhada).
const crypto = require('crypto');

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

function createSessions({ secret, secure = false, maxAgeMs = 8 * 3600e3, adminMaxAgeMs = 2 * 3600e3, cookieName = 'sid' }) {
  const mac = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  function sign(payload, ttl = maxAgeMs) {
    const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttl }));
    return `${body}.${mac(body)}`;
  }
  function verify(token) {
    if (typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i < 1) return null;
    const body = token.slice(0, i), sig = token.slice(i + 1);
    const good = Buffer.from(mac(body)), got = Buffer.from(sig);
    if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null; // assinatura inválida
    try {
      const p = JSON.parse(unb64(body));
      return p && p.exp > Date.now() ? p : null;
    } catch { return null; }
  }
  const readCookie = (req) => {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(cookieName + '='));
    return m ? decodeURIComponent(m.slice(cookieName.length + 1)) : '';
  };
  const attrs = (maxAge) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  function middleware(req, res, next) {
    const p = verify(readCookie(req)) || {};
    req.session = { userId: p.u || null, admin: !!p.a };
    // Grava o estado atual da sessão no cookie (login/cadastro/logout)
    res.saveSession = () => {
      const { userId, admin } = req.session;
      if (!userId && !admin) return res.append('Set-Cookie', `${cookieName}=; ${attrs(0)}`);
      const ttl = admin ? Math.min(maxAgeMs, adminMaxAgeMs) : maxAgeMs; // sessão do admin é mais curta (2 h)
      res.append('Set-Cookie', `${cookieName}=${encodeURIComponent(sign({ u: userId || undefined, a: admin || undefined }, ttl))}; ${attrs(Math.floor(ttl / 1000))}`);
    };
    next();
  }
  return { middleware, sign, verify };
}

// Limitador simples de tentativas (em memória; vale por instância — suficiente como freio contra força bruta)
function createLimiter() {
  const hits = new Map();
  return {
    blocked(key, max) { const h = hits.get(key); return !!h && h.until > Date.now() && h.n >= max; },
    fail(key, windowMs) {
      const now = Date.now(); let h = hits.get(key);
      if (!h || h.until <= now) h = { n: 0, until: now + windowMs };
      h.n++; hits.set(key, h);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    },
    reset(key) { hits.delete(key); },
  };
}

module.exports = { createSessions, createLimiter };
