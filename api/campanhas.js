'use strict';
/*
 * API das campanhas (Vercel Function, Node.js). Exige login (cookie de sessão).
 *   GET    /api/campanhas
 *   POST   /api/campanhas
 *   PUT    /api/campanhas?id=ID                     edição (com controle de versão)
 *   PUT    /api/campanhas?id=ID&acao=andamento      { chave, feito }  marca item do andamento
 *   DELETE /api/campanhas?id=ID                     somente admin
 */
const crypto = require('crypto');
const lib = require('./_lib');

const KEY = 'calc-campanhas:v1';
const MAX_ITEMS = 500;
const MAX_BYTES = 200 * 1024;
const MODOS = ['campanha', 'projeto', 'urgencia'];
const STATUS = ['', 'planejamento', 'producao', 'publicada', 'cancelada'];
const MAX_LOG = 40;
const JANELA_LOG_MS = 10 * 60 * 1000;

// Aceita só os campos conhecidos, com tipo e tamanho controlados.
function limpar(b) {
  const txt = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const data = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const num = (v, max) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : null);
  const estado = {};
  if (b && b.estado && typeof b.estado === 'object') {
    Object.keys(b.estado).slice(0, 160).forEach(function (k) {
      const v = b.estado[k];
      if (typeof v === 'string') estado[k.slice(0, 60)] = v.slice(0, 4000);
      else if (typeof v === 'boolean') estado[k.slice(0, 60)] = v;
    });
  }
  const itens = Array.isArray(b.itens)
    ? b.itens.slice(0, 40).map(function (x) { return txt(x, 120); }).filter(Boolean)
    : [];
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
    itens: itens,
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
  const raw = await lib.redis(['HGET', KEY, id]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const eu = await lib.exigirUsuario(req, res, {});
    if (!eu) return undefined;

    const id = req.query && req.query.id ? String(req.query.id).slice(0, 40) : '';
    const acao = req.query && req.query.acao ? String(req.query.acao) : '';

    if (req.method === 'GET') {
      const flat = (await lib.redis(['HGETALL', KEY])) || [];
      const items = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { items.push(JSON.parse(flat[i + 1])); } catch (e) { /* ignora registro corrompido */ }
      }
      items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return res.status(200).json({ items: items });
    }

    if (req.method === 'DELETE') {
      if (eu.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
      if (!id) return res.status(400).json({ error: 'id_required' });
      await lib.redis(['HDEL', KEY, id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = lib.corpo(req);
      if (!body) return res.status(400).json({ error: 'invalid_body' });
      if (JSON.stringify(body).length > MAX_BYTES) return res.status(413).json({ error: 'too_large' });
      const agora = new Date().toISOString();

      if (req.method === 'POST') {
        const total = Number(await lib.redis(['HLEN', KEY])) || 0;
        if (total >= MAX_ITEMS) return res.status(400).json({ error: 'limit_reached' });
        const novo = Object.assign(limpar(body), {
          id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
          rev: 1,
          criador: eu.nome,
          autor: eu.nome,
          andamento: {},
          createdAt: agora,
          updatedAt: agora
        });
        novo.log = registrar([], { rev: 1, at: agora, autor: eu.nome, acao: 'criou', info: [novo.titulo, novo.prazo].filter(Boolean).join(' · ') });
        await lib.redis(['HSET', KEY, novo.id, JSON.stringify(novo)]);
        return res.status(201).json({ item: novo });
      }

      if (!id) return res.status(400).json({ error: 'id_required' });
      const atual = await ler(id);
      if (!atual) return res.status(404).json({ error: 'not_found' });

      if (acao === 'andamento') {
        const chave = typeof body.chave === 'string' ? body.chave.slice(0, 120) : '';
        if (!chave || (atual.itens || []).indexOf(chave) < 0 || typeof body.feito !== 'boolean') {
          return res.status(400).json({ error: 'invalid_item' });
        }
        const and = Object.assign({}, atual.andamento || {});
        and[chave] = { feito: body.feito, por: eu.nome, em: agora };
        atual.andamento = and;
        await lib.redis(['HSET', KEY, atual.id, JSON.stringify(atual)]);
        return res.status(200).json({ item: atual });
      }

      if (body.force !== true && Number(body.rev) !== atual.rev) {
        return res.status(409).json({ error: 'conflict', item: atual });
      }
      const parcial = limpar(body);
      Object.keys(parcial).forEach(function (k) { if (!(k in body)) delete parcial[k]; });
      parcial.autor = eu.nome;
      delete parcial.criador;
      const novo = Object.assign({}, atual, parcial, { id: atual.id, rev: atual.rev + 1, updatedAt: agora });
      let ac = 'editou';
      if ('arquivada' in body && (body.arquivada === true) !== (atual.arquivada === true)) ac = body.arquivada === true ? 'arquivou' : 'restaurou';
      novo.log = registrar(atual.log, { rev: novo.rev, at: agora, autor: eu.nome, acao: ac, info: [novo.titulo, novo.prazo].filter(Boolean).join(' · ') });
      await lib.redis(['HSET', KEY, novo.id, JSON.stringify(novo)]);
      return res.status(200).json({ item: novo });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_error' });
  }
};
