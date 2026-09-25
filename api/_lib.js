'use strict';
/*
 * Utilidades compartilhadas pelas funções da API (o "_" no nome impede que o Vercel
 * exponha este arquivo como endereço).
 *
 * Variáveis de ambiente:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (ou KV_REST_API_URL / KV_REST_API_TOKEN)
 *   SESSION_SECRET  texto longo e aleatório, usado para assinar os logins (obrigatório)
 *   APP_PASSWORD    senha do primeiro acesso: entra como usuário "admin" enquanto não existir nenhum usuário
 */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const USERS_KEY = 'calc-users:v1';
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1 };

function config() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    secret: process.env.SESSION_SECRET || '',
    bootstrap: process.env.APP_PASSWORD || process.env.ADMIN_PASSWORD || ''
  };
}

async function redis(cmd) {
  const c = config();
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  let j = {};
  try { j = await r.json(); } catch (e) { /* resposta sem corpo */ }
  if (!r.ok || j.error) throw new Error(j.error || 'redis ' + r.status);
  return j.result;
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

/* ---------- senhas ---------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, 64, SCRYPT);
  return 'scrypt$' + salt.toString('base64') + '$' + h.toString('base64');
}

async function checkPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p[0] !== 'scrypt' || p.length !== 3) return false;
  const salt = Buffer.from(p[1], 'base64');
  const esperado = Buffer.from(p[2], 'base64');
  const h = await scrypt(String(pw), salt, esperado.length, SCRYPT);
  return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
}

/* ---------- sessão (cookie assinado) ---------- */
function assinar(payload, secret) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}

function verificar(token, secret) {
  const partes = String(token || '').split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const esperado = crypto.createHmac('sha256', secret).update(partes[0]).digest('base64url');
  if (!sameText(partes[1], esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(partes[0], 'base64url').toString());
    return p && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

function cookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(function (par) {
    const i = par.indexOf('=');
    if (i > 0) { try { o[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); } catch (e) { /* ignora */ } }
  });
  return o;
}

function definirSessao(req, res, user, limpar) {
  const seguro = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  let valor = '';
  if (!limpar) {
    valor = assinar({ u: user.usuario, pv: user.pv, exp: Date.now() + SESSION_DAYS * 86400000 }, config().secret);
  }
  res.setHeader('Set-Cookie', 'op_session=' + valor + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + (limpar ? 0 : SESSION_DAYS * 86400) + (seguro ? '; Secure' : ''));
}

/* ---------- usuários ---------- */
async function lerUsuario(usuario) {
  const raw = await redis(['HGET', USERS_KEY, usuario]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function gravarUsuario(u) {
  await redis(['HSET', USERS_KEY, u.usuario, JSON.stringify(u)]);
}

async function listarUsuarios() {
  const flat = (await redis(['HGETALL', USERS_KEY])) || [];
  const lista = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { lista.push(JSON.parse(flat[i + 1])); } catch (e) { /* ignora registro corrompido */ }
  }
  return lista;
}

function publico(u) {
  return {
    usuario: u.usuario,
    nome: u.nome,
    role: u.role,
    ativo: u.ativo !== false,
    mustChange: !!u.mustChange,
    criadoEm: u.criadoEm || '',
    ultimoLogin: u.ultimoLogin || ''
  };
}

async function usuarioDaSessao(req) {
  const p = verificar(cookies(req).op_session, config().secret);
  if (!p) return null;
  const u = await lerUsuario(p.u);
  if (!u || u.ativo === false || u.pv !== p.pv) return null;
  return u;
}

function csrfOk(req) {
  return req.method === 'GET' || req.headers['x-requested-with'] === 'calc';
}

/* Confere configuração, proteção contra requisições de outros sites e sessão.
 * Devolve o usuário ou responde com o erro e devolve null. */
async function exigirUsuario(req, res, opcoes) {
  const o = opcoes || {};
  const c = config();
  if (!c.secret) { res.status(503).json({ error: 'session_secret_missing' }); return null; }
  if (!c.url || !c.token) { res.status(503).json({ error: 'storage_not_configured' }); return null; }
  if (!csrfOk(req)) { res.status(403).json({ error: 'csrf' }); return null; }
  const u = await usuarioDaSessao(req);
  if (!u) { res.status(401).json({ error: 'unauthorized' }); return null; }
  if (u.mustChange && !o.permitirTroca) { res.status(403).json({ error: 'must_change_password' }); return null; }
  if (o.admin && u.role !== 'admin') { res.status(403).json({ error: 'forbidden' }); return null; }
  return u;
}

function corpo(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}

const USUARIO_OK = /^[a-z0-9._-]{3,30}$/;

module.exports = {
  USERS_KEY, config, redis, sameText, hashPassword, checkPassword, definirSessao,
  lerUsuario, gravarUsuario, listarUsuarios, publico, exigirUsuario, corpo, USUARIO_OK
};
