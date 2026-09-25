'use strict';
/*
 * API das campanhas (Vercel Function, Node.js).
 * Guarda tudo em um Redis (Upstash, instalado pelo Marketplace da Vercel) usando a API REST,
 * sem nenhuma dependência de npm.
 *
 * Variáveis de ambiente:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (ou KV_REST_API_URL / KV_REST_API_TOKEN)
 *   APP_PASSWORD  senha única da equipe (opcional, mas recomendada)
 */
const crypto = require('crypto');

const KEY = 'calc-campanhas:v1';
const MAX_ITEMS = 500;
const MAX_BYTES = 200 * 1024;
const MODOS = ['campanha', 'projeto', 'urgencia'];
const STATUS = ['', 'planejamento', 'producao', 'publicada', 'cancelada'];
const MAX_LOG = 40;
const JANELA_LOG_MS = 10 * 60 * 1000;

function config() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    pass: process.env.APP_PASSWORD || ''
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

// Aceita só os campos conhecidos, com tipo e tamanho controlados.
function limpar(b) {
  const txt = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const data = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const num = (v, max) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : null);
  const estado = {};
  if (b && b.estado && typeof b.estado === 'object') {
    Object.keys(b.estado).slice(0, 120).forEach(function (k) {
      const v = b.estado[k];
      if (typeof v === 'string') estado[k.slice(0, 60)] = v.slice(0, 4000);
      else if (typeof v === 'boolean') estado[k.slice(0, 60)] = v;
    });
  }
  return {
    nome: txt(b.nome, 120) || 'Sem nome',
    modo: txt(b.modo, 20),
    k: MODOS.indexOf(b.k) >= 0 ? b.k : 'campanha',
    titulo: txt(b.titulo, 80),
    prazo: txt(b.prazo, 80),
    entrega: txt(b.entrega, 80),
    resumo: txt(b.resumo, 8000),
    produto: txt(b.produto, 8000),
    autor: txt(b.autor, 60),
    porte: txt(b.porte, 30),
    soma: num(b.soma, 99),
    status: STATUS.indexOf(b.status) >= 0 ? b.status : '',
    comunicacao: data(b.comunicacao),
    publicacaoReal: data(b.publicacaoReal),
    prevLo: num(b.prevLo, 999),
    prevHi: num(b.prevHi, 999),
    diasReais: num(b.diasReais, 999),
    arquivada: b.arquivada === true,
    estado: estado
  };
}

function registrar(log, entrada) {
  const lista = Array.isArray(log) ? log.slice() : [];
  const ult = lista[lista.length - 1];
  if (ult && entrada.acao === 'editou' && ult.acao === 'editou' && ult.autor === entrada.autor &&
      Date.parse(entrada.at) - Date.parse(ult.at) < JANELA_LOG_MS) {
    lista[lista.length - 1] = entrada;
  } else {
    lista.push(entrada);
  }
  return lista.slice(-MAX_LOG);
}

async function ler(id) {
  const raw = await redis(['HGET', KEY, id]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const c = config();
  const protegido = !!c.pass;

  if (protegido && !sameText(req.headers['x-app-password'] || '', c.pass)) {
    return res.status(401).json({ error: 'unauthorized', protected: true });
  }
  if (!c.url || !c.token) {
    return res.status(503).json({ error: 'storage_not_configured', protected: protegido });
  }

  const id = req.query && req.query.id ? String(req.query.id).slice(0, 40) : '';

  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', KEY])) || [];
      const items = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { items.push(JSON.parse(flat[i + 1])); } catch (e) { /* ignora registro corrompido */ }
      }
      items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return res.status(200).json({ items: items, protected: protegido });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id_required' });
      await redis(['HDEL', KEY, id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });
      if (JSON.stringify(body).length > MAX_BYTES) return res.status(413).json({ error: 'too_large' });
      const agora = new Date().toISOString();

      if (req.method === 'POST') {
        const total = Number(await redis(['HLEN', KEY])) || 0;
        if (total >= MAX_ITEMS) return res.status(400).json({ error: 'limit_reached' });
        const novo = Object.assign(limpar(body), {
          id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
          rev: 1,
          createdAt: agora,
          updatedAt: agora
        });
        novo.log = registrar([], { rev: 1, at: agora, autor: novo.autor, acao: 'criou', info: [novo.titulo, novo.prazo].filter(Boolean).join(' · ') });
        await redis(['HSET', KEY, novo.id, JSON.stringify(novo)]);
        return res.status(201).json({ item: novo });
      }

      if (!id) return res.status(400).json({ error: 'id_required' });
      const atual = await ler(id);
      if (!atual) return res.status(404).json({ error: 'not_found' });
      if (body.force !== true && Number(body.rev) !== atual.rev) {
        return res.status(409).json({ error: 'conflict', item: atual });
      }
      const parcial = limpar(body);
      Object.keys(parcial).forEach(function (k) { if (!(k in body)) delete parcial[k]; });
      const novo = Object.assign({}, atual, parcial, { id: atual.id, rev: atual.rev + 1, updatedAt: agora });
      let acao = 'editou';
      if ('arquivada' in body && (body.arquivada === true) !== (atual.arquivada === true)) acao = body.arquivada === true ? 'arquivou' : 'restaurou';
      novo.log = registrar(atual.log, { rev: novo.rev, at: agora, autor: novo.autor || '', acao: acao, info: [novo.titulo, novo.prazo].filter(Boolean).join(' · ') });
      await redis(['HSET', KEY, novo.id, JSON.stringify(novo)]);
      return res.status(200).json({ item: novo });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_error' });
  }
};
