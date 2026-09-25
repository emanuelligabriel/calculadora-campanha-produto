'use strict';
/*
 * Administração de usuários (somente perfil admin).
 *   GET  /api/usuarios
 *   POST /api/usuarios            { usuario, nome, role, senha }
 *   PUT  /api/usuarios?u=usuario  { nome?, role?, ativo?, senha? }
 * Não há exclusão: um usuário desativado deixa de entrar, mas o histórico mantém o nome.
 */
const lib = require('./_lib');

async function adminsAtivos() {
  const lista = await lib.listarUsuarios();
  return lista.filter(function (u) { return u.role === 'admin' && u.ativo !== false; });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const eu = await lib.exigirUsuario(req, res, { admin: true });
    if (!eu) return undefined;

    if (req.method === 'GET') {
      const lista = (await lib.listarUsuarios()).map(lib.publico);
      lista.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
      return res.status(200).json({ users: lista });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const b = lib.corpo(req);
      if (!b) return res.status(400).json({ error: 'invalid_body' });
      const agora = new Date().toISOString();

      if (req.method === 'POST') {
        const usuario = String(b.usuario || '').trim().toLowerCase();
        const nome = String(b.nome || '').trim();
        const role = b.role === 'admin' ? 'admin' : 'user';
        const senha = String(b.senha || '');
        if (!lib.USUARIO_OK.test(usuario)) return res.status(400).json({ error: 'invalid_username' });
        if (nome.length < 2 || nome.length > 60) return res.status(400).json({ error: 'invalid_name' });
        if (senha.length < 8 || senha.length > 100) return res.status(400).json({ error: 'weak_password' });
        if (await lib.lerUsuario(usuario)) return res.status(409).json({ error: 'exists' });
        const novo = {
          usuario: usuario, nome: nome, role: role, ativo: true,
          hash: await lib.hashPassword(senha), pv: 1, mustChange: true, criadoEm: agora
        };
        await lib.gravarUsuario(novo);
        return res.status(201).json({ user: lib.publico(novo) });
      }

      const alvoId = req.query && req.query.u ? String(req.query.u).toLowerCase() : '';
      const alvo = alvoId ? await lib.lerUsuario(alvoId) : null;
      if (!alvo) return res.status(404).json({ error: 'not_found' });
      const ehEu = alvo.usuario === eu.usuario;

      if (typeof b.nome === 'string') {
        const nome = b.nome.trim();
        if (nome.length < 2 || nome.length > 60) return res.status(400).json({ error: 'invalid_name' });
        alvo.nome = nome;
      }
      if (b.role === 'admin' || b.role === 'user') {
        if (ehEu && b.role !== alvo.role) return res.status(400).json({ error: 'self_change' });
        alvo.role = b.role;
      }
      if (typeof b.ativo === 'boolean') {
        if (ehEu && b.ativo === false) return res.status(400).json({ error: 'self_change' });
        alvo.ativo = b.ativo;
      }
      if (typeof b.senha === 'string') {
        if (b.senha.length < 8 || b.senha.length > 100) return res.status(400).json({ error: 'weak_password' });
        alvo.hash = await lib.hashPassword(b.senha);
        alvo.pv = (alvo.pv || 1) + 1;
        alvo.mustChange = true;
      }

      // Nunca deixar o sistema sem administrador ativo.
      const restantes = (await adminsAtivos()).filter(function (u) { return u.usuario !== alvo.usuario; });
      const alvoContinuaAdmin = alvo.role === 'admin' && alvo.ativo !== false;
      if (!alvoContinuaAdmin && restantes.length === 0) return res.status(400).json({ error: 'last_admin' });

      await lib.gravarUsuario(alvo);
      return res.status(200).json({ user: lib.publico(alvo) });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_error' });
  }
};
