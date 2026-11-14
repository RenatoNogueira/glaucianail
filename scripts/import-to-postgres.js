// Copia os dados locais (data/db.json + logo) para as tabelas do Postgres/Supabase, sem apagar nada do banco.
// Uso:
//   DATABASE_URL="postgresql://..." node scripts/import-to-postgres.js [--force]
// Por segurança, se o banco de destino já tiver clientes ou agendamentos, o script recusa (use --force para sobrescrever).
const fs = require('fs');
const path = require('path');
const { createStore } = require('../lib/store');
const { DEFAULT_SERVICES } = require('../lib/defaults');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('Defina DATABASE_URL (a string de conexão do Postgres).'); process.exit(1); }
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'db.json');
if (!fs.existsSync(file)) { console.error('Não encontrei', file); process.exit(1); }

(async () => {
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = createStore({ defaultServices: DEFAULT_SERVICES, databaseUrl: url });
  try {
    const r = await store.importDocument(local, { force: process.argv.includes('--force') });
    const ext = local.settings && local.settings.logo;
    const logo = ext && path.join(dataDir, 'uploads', 'logo.' + ext);
    if (logo && fs.existsSync(logo)) { await store.logo.put(fs.readFileSync(logo), ext); console.log('✔ Logo importada.'); }
    console.log(`✔ Importado: ${r.users} clientes, ${r.appointments} agendamentos, ${r.slots} horários, ${r.services} serviços.`);
  } catch (e) {
    if (e.code === 'HAS_DATA') { console.error(e.message, 'Nada foi alterado. Use --force para sobrescrever.'); process.exitCode = 2; }
    else { console.error('Falha:', e.message); process.exitCode = 1; }
  } finally { await store.close(); }
})();
