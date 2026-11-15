// Mantém os cabeçalhos de segurança do vercel.json iguais aos de lib/security.js. Uso: npm run headers
const fs = require('fs');
const path = require('path');
const { headers } = require('../lib/security');
const file = path.join(__dirname, '..', 'vercel.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const alvo = j.headers.find((h) => h.source === '/(.*)');
alvo.headers = Object.entries(headers()).map(([key, value]) => ({ key, value }));
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
console.log('✔ vercel.json atualizado');
