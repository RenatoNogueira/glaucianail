// Gera supabase/schema.sql a partir de lib/schema.js (fonte única da estrutura do banco).
const fs = require('fs');
const path = require('path');
const { fullSql } = require('../lib/schema');
const { DEFAULT_SERVICES } = require('../lib/defaults');
const { SCHEMA, DB_VERSION } = require('../lib/store');

const out = path.join(__dirname, '..', 'supabase', 'schema.sql');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, fullSql(SCHEMA, DEFAULT_SERVICES, DB_VERSION));
console.log('✔ Gerado', path.relative(process.cwd(), out));
