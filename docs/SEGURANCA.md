# Análise de segurança

Data: 15/11/2026 · Escopo: site da cliente, painel `/admin`, API Express, banco (Supabase), deploy (Vercel/GitHub).

## O que já estava protegido
| Área | Situação |
|---|---|
| Senhas | `bcrypt` (custo 10); nunca voltam pela API. Senha do admin só em variável de ambiente. |
| Sessão | Cookie assinado (HMAC-SHA256, comparação em tempo constante), `HttpOnly`, `SameSite=Lax`, `Secure` em produção. Cookie forjado/adulterado é recusado. |
| Produção | Sem `ADMIN_PASS`/`SESSION_SECRET` fortes o sistema responde 503 (não sobe com padrões públicos). |
| CSRF | Pedidos que alteram dados só valem se a origem for o próprio site. |
| Autorização | Todas as rotas `/api/admin/*` exigem login de admin; cliente só vê/cancela os próprios agendamentos. |
| Injeção | Banco acessado por funções/consultas parametrizadas; entradas validadas (datas, horários, telefone, tamanhos). Testado: SQL/NoSQL injection e poluição de protótipo não funcionam. |
| XSS | Todo texto de usuário passa por `esc()` antes de entrar no HTML; textos da página inicial usam `textContent`. |
| Upload | Só PNG/JPG/WEBP, conferido pelo conteúdo real, até 1,5 MB (SVG é recusado). |
| Banco | Supabase com RLS ligado, esquema privado, funções liberadas só para `service_role` (a chave pública não acessa nada). |
| Segredos | `.env` e `data/` no `.gitignore`; nenhuma chave no código nem no histórico do Git. `npm audit`: 0 vulnerabilidades. |
| Erros | Sempre JSON genérico, sem stack trace. Arquivos do servidor (`.env`, `server.js`, `lib/`, `.git`) não são servidos. |

## Falhas encontradas e corrigidas nesta análise
1. **Sem CSP nem cabeçalhos modernos** → adicionados `Content-Security-Policy` (scripts só do próprio site + hash do único script embutido; `frame-ancestors 'none'`, `object-src 'none'`), `Strict-Transport-Security`, `Permissions-Policy` e `Cross-Origin-Opener-Policy`, no Express **e** no `vercel.json` (que serve os arquivos estáticos). Um teste garante que os dois ficam iguais; após mudar o script embutido rode `npm run headers`.
2. **Força bruta no admin só por IP e em memória** (na Vercel cada instância tem a sua memória, então o freio era fraco) → agora há também um **freio global gravado no banco**: 20 falhas em 15 min travam o login do admin por 15 min, mesmo trocando de IP.
3. **Tempo de resposta revelava se o usuário do admin existia** → a senha é sempre conferida.
4. **Sessão do admin durava 8 h** → agora **2 h**.
5. **Cadastro de clientes sem limite** (spam de contas e uso de CPU pelo bcrypt) → máximo de 10 cadastros por hora por IP.
6. `offline.html` tinha `onclick` embutido (incompatível com a CSP) → movido para `offline.js`.

## Riscos que restam (e o que fazer)
- **Sessão não pode ser revogada individualmente** (cookie assinado, sem estado). Se suspeitar de vazamento, troque `SESSION_SECRET` na Vercel e faça Redeploy: todas as sessões caem.
- **Login de cliente**: o freio é por IP + WhatsApp, em memória (por instância). Senhas de 6 caracteres podem ser adivinhadas por quem distribui as tentativas. Se quiser mais proteção, aumente o mínimo da senha para 8.
- **Cadastro revela se um WhatsApp já existe** (mensagem "já cadastrado"). É o preço de uma boa experiência; o freio de 10 cadastros/h limita a coleta em massa.
- **Backup do admin inclui os hashes de senha das clientes.** Guarde o arquivo em local seguro e não o compartilhe.
- **Avaliações são públicas** (sem login). Há limite de 3 por hora por IP e moderação no painel (ocultar/excluir).
- **Admin sem verificação em duas etapas.** Use uma senha longa e única.

## O que só você pode fazer
1. `ADMIN_PASS` com **14+ caracteres**, única (gerenciador de senhas) e diferente de qualquer outra.
2. Ativar **verificação em duas etapas** na conta do GitHub, da Vercel e do Supabase.
3. Nunca colar `SUPABASE_SECRET_KEY`, `SESSION_SECRET` ou `ADMIN_PASS` em chats, prints ou no GitHub. Se alguma já vazou, gere outra no Supabase/Vercel.
4. No GitHub: Settings → Code security → ativar **Secret scanning** e **Dependabot alerts**.
5. Rodar o `.env` local apontando para o Supabase real grava em produção; use `DATA_DIR` temporário para testar.
6. Revisar de vez em quando Vercel → Logs e Supabase → Logs por picos de tentativas de login.
