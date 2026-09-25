'use strict';
/*
 * Login, logout e troca de senha.
 *   GET  /api/auth                 usuário da sessão atual
 *   POST /api/auth?acao=login      { usuario, senha }
 *   POST /api/auth?acao=logout
 *   POST /api/auth?acao=senha      { atual, nova }
 */
const lib = require('./_lib');

const MAX_FALHAS = 5;
const JANELA_SEG = 900;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const c = lib.config();
  if (!c.secret) return res.status(503).json({ error: 'session_secret_missing' });
  if (!c.url || !c.token) return res.status(503).json({ error: 'storage_not_configured' });

  const acao = req.query && req.query.acao ? String(req.query.acao) : '';

  try {
    if (req.method === 'GET') {
      const u = await lib.exigirUsuario(req, res, { permitirTroca: true });
      if (!u) return undefined;
      return res.status(200).json({ user: lib.publico(u) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (req.headers['x-requested-with'] !== 'calc') return res.status(403).json({ error: 'csrf' });

    if (acao === 'logout') {
      lib.definirSessao(req, res, null, true);
      return res.status(200).json({ ok: true });
    }

    const b = lib.corpo(req);
    if (!b) return res.status(400).json({ error: 'invalid_body' });

    if (acao === 'login') {
      const usuario = String(b.usuario || '').trim().toLowerCase().slice(0, 40);
      const senha = String(b.senha || '').slice(0, 200);
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
      const chave = 'calc-rl:' + ip + ':' + usuario;

      const falhas = Number(await lib.redis(['GET', chave])) || 0;
      if (falhas >= MAX_FALHAS) return res.status(429).json({ error: 'too_many_attempts' });

      let user = usuario ? await lib.lerUsuario(usuario) : null;
      let ok = false;
      const agora = new Date().toISOString();

      if (user) {
        ok = user.ativo !== false && (await lib.checkPassword(senha, user.hash));
      } else if (usuario === 'admin' && c.bootstrap && lib.sameText(senha, c.bootstrap)) {
        // Primeiro acesso: enquanto não existir nenhum usuário, "admin" entra com a senha do Vercel.
        const total = Number(await lib.redis(['HLEN', lib.USERS_KEY])) || 0;
        if (total === 0) {
          user = {
            usuario: 'admin', nome: 'Administrador', role: 'admin', ativo: true,
            hash: await lib.hashPassword(senha), pv: 1, mustChange: true, criadoEm: agora
          };
          await lib.gravarUsuario(user);
          ok = true;
        }
      }

      if (!ok) {
        const n = Number(await lib.redis(['INCR', chave])) || 0;
        if (n === 1) await lib.redis(['EXPIRE', chave, JANELA_SEG]);
        return res.status(401).json({ error: 'invalid_credentials' });
      }

      await lib.redis(['DEL', chave]);
      user.ultimoLogin = agora;
      await lib.gravarUsuario(user);
      lib.definirSessao(req, res, user, false);
      return res.status(200).json({ user: lib.publico(user) });
    }

    if (acao === 'senha') {
      const u = await lib.exigirUsuario(req, res, { permitirTroca: true });
      if (!u) return undefined;
      const atual = String(b.atual || '').slice(0, 200);
      const nova = String(b.nova || '');
      if (nova.length < 8 || nova.length > 100) return res.status(400).json({ error: 'weak_password' });
      if (nova.toLowerCase() === u.usuario) return res.status(400).json({ error: 'weak_password' });
      if (!(await lib.checkPassword(atual, u.hash))) return res.status(401).json({ error: 'invalid_credentials' });
      u.hash = await lib.hashPassword(nova);
      u.pv = (u.pv || 1) + 1;
      u.mustChange = false;
      await lib.gravarUsuario(u);
      lib.definirSessao(req, res, u, false);
      return res.status(200).json({ user: lib.publico(u) });
    }

    return res.status(400).json({ error: 'invalid_action' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_error' });
  }
};
