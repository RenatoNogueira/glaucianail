# Glaucia Nail — Agendamento de Manicure e Pé de Curi

Sistema de agendamento online para estúdio de unhas: a cliente escolhe serviço, dia e horário; a administradora
aprova ou recusa no painel e a resposta segue para o **WhatsApp** da cliente.

**Stack:** Node.js + Express · front-end em HTML/CSS/JS puro · PostgreSQL (Supabase) em produção · deploy na Vercel.

## Funcionalidades

- **Cliente:** cadastro/login por WhatsApp, agendamento em 3 passos (serviço → data e hora → confirmação), histórico e cancelamento.
- **Administradora:** visão geral, aprovação/recusa com mensagem de WhatsApp, agenda de horários (publicação em lote e exclusão em massa),
  CRUD de serviços (com biblioteca de ícones), clientes, nome e logo do estúdio, **edição dos textos da página inicial**, backup.
- **App instalável (PWA):** as clientes instalam o site na tela inicial do celular (botão "Instalar"). O painel admin continua só no navegador.
- Modo claro/escuro, layout responsivo (menu lateral no computador, barra de abas no celular).

## Rodando localmente

```bash
npm install
cp .env.example .env      # ajuste ADMIN_PASS e SESSION_SECRET
npm start                 # http://localhost:3000  (admin: /admin.html)
npm test                  # 75 testes automatizados
```

Sem banco configurado (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`, ou `DATABASE_URL`), os dados ficam em `data/db.json` (com backups automáticos em `data/backups`).

## Deploy (Vercel + Supabase)

Veja [DEPLOY.md](DEPLOY.md). Estrutura do banco em [supabase/schema.sql](supabase/schema.sql); relatório de QA em [docs/QA-REPORT.md](docs/QA-REPORT.md).

## Estrutura

```
server.js            API Express (exporta o app)
api/index.js         ponto de entrada serverless da Vercel
lib/                 armazenamento (arquivo/Postgres), sessões, esquema do banco
public/              site (cliente: index.html + site.js · painel: admin.html + admin.js)
scripts/             importação de dados locais para o Postgres, gerador do schema.sql
supabase/schema.sql  estrutura do banco para o SQL Editor do Supabase
tests/               testes da API e do adaptador PostgreSQL
```

> Em produção `ADMIN_PASS` e `SESSION_SECRET` são obrigatórios (e não podem ser os valores de exemplo). Nunca versione o arquivo `.env`.
