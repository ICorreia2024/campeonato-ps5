'use strict';
/* Campeonato EA Sports FC 26 — servidor. Node puro (sem dependências externas). */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = process.env.PORT || 4000;
const PASTA_PUBLICA = path.join(__dirname, 'public');
const ARQUIVO_ESTADO = path.join(__dirname, 'estado.json');
const LETRAS = 'ABCDEFGH';

const uid = () => crypto.randomBytes(5).toString('hex');

/* ============================ ESTADO ============================ */

function estadoPadrao() {
  return {
    numGrupos: 2,
    faseGruposGerada: false,
    participantes: [],
    grupos: [],
    mataMata: null,
    campeao: null
  };
}

function carregarEstado() {
  try {
    const bruto = fs.readFileSync(ARQUIVO_ESTADO, 'utf-8');
    return { ...estadoPadrao(), ...JSON.parse(bruto) };
  } catch {
    return estadoPadrao();
  }
}

let estado = carregarEstado();

function salvarEstado() {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2), 'utf-8');
}

/* ============================ REGRAS DO TORNEIO ============================ */

function participantesPorGrupo() {
  const grupos = Array.from({ length: estado.numGrupos }, () => []);
  estado.participantes.forEach((p, i) => grupos[i % estado.numGrupos].push(p));
  return grupos;
}

function gerarPartidasGrupo(times) {
  const partidas = [];
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      partidas.push({ id: uid(), casa: times[i], fora: times[j], golsCasa: null, golsFora: null, data: null });
    }
  }
  return partidas;
}

function calcularClassificacao(grupo) {
  const tabela = {};
  grupo.times.forEach((t) => { tabela[t] = { time: t, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0 }; });
  grupo.partidas.forEach((p) => {
    if (p.golsCasa == null || p.golsFora == null) return;
    const casa = tabela[p.casa], fora = tabela[p.fora];
    casa.pj++; fora.pj++;
    casa.gp += p.golsCasa; casa.gc += p.golsFora;
    fora.gp += p.golsFora; fora.gc += p.golsCasa;
    if (p.golsCasa > p.golsFora) { casa.v++; casa.pts += 2; fora.d++; }
    else if (p.golsCasa < p.golsFora) { fora.v++; fora.pts += 2; casa.d++; }
    else { casa.e++; fora.e++; casa.pts += 1; fora.pts += 1; }
  });
  const lista = Object.values(tabela);
  lista.forEach((t) => { t.sg = t.gp - t.gc; });
  lista.sort((a, b) => b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.time.localeCompare(b.time));
  return lista;
}

function grupoCompleto(grupo) {
  return grupo.partidas.length > 0 && grupo.partidas.every((p) => p.golsCasa != null && p.golsFora != null);
}

function faseGruposCompleta() {
  return estado.grupos.length > 0 && estado.grupos.every(grupoCompleto);
}

function algumaPartidaJogada() {
  return estado.grupos.some((g) => g.partidas.some((p) => p.golsCasa != null || p.golsFora != null));
}

function criarPartidaMM(casa, fora) {
  return { id: uid(), casa, fora, golsCasa: null, golsFora: null, vencedor: null, penaltis: false, data: null };
}

function gerarMataMata() {
  const primeiros = estado.grupos.map((g) => calcularClassificacao(g)[0].time);
  const segundos = estado.grupos.map((g) => calcularClassificacao(g)[1].time);
  const rodada0 = [];
  for (let i = 0; i < estado.grupos.length; i += 2) {
    rodada0.push(criarPartidaMM(primeiros[i], segundos[i + 1]));
    rodada0.push(criarPartidaMM(primeiros[i + 1], segundos[i]));
  }
  estado.mataMata = { rounds: [rodada0] };
}

/* ============================ VIEW MODEL (o que a API expõe) ============================ */

function montarEstadoPublico() {
  const participantesComGrupo = estado.participantes.map((p, i) => {
    let grupoNome = null;
    if (estado.faseGruposGerada) {
      const idx = estado.grupos.findIndex((g) => g.times.includes(p.nome));
      grupoNome = idx >= 0 ? LETRAS[idx] : null;
    } else {
      grupoNome = LETRAS[i % estado.numGrupos];
    }
    return { ...p, grupoNome };
  });

  return {
    numGrupos: estado.numGrupos,
    faseGruposGerada: estado.faseGruposGerada,
    primeiraPartidaComecou: algumaPartidaJogada(),
    participantes: participantesComGrupo,
    campeao: estado.campeao,
    finalistas: calcularFinalistas(),
    gruposPorTime: estado.faseGruposGerada ? null : participantesPorGrupo(),
    grupos: estado.grupos.map((g) => ({
      nome: g.nome,
      times: g.times,
      partidas: g.partidas,
      completo: grupoCompleto(g),
      classificacao: calcularClassificacao(g)
    })),
    mataMata: estado.mataMata
  };
}

/* ============================ AÇÕES ============================ */

class ErroApi extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

function acaoAdicionarParticipante({ nome }) {
  const limpo = String(nome || '').trim();
  if (!limpo) throw new ErroApi('Informe um nome.');
  if (algumaPartidaJogada()) throw new ErroApi('O torneio já começou — não é mais possível adicionar participantes.');
  if (estado.participantes.some((p) => p.nome.toLowerCase() === limpo.toLowerCase())) {
    throw new ErroApi('Já existe um participante com esse nome.');
  }
  estado.participantes.push({ id: uid(), nome: limpo });

  if (estado.faseGruposGerada) {
    // Fase já gerada: entra no grupo com menos times (ocupa a vaga de quem foi removido).
    let grupoAlvo = estado.grupos[0];
    for (const g of estado.grupos) {
      if (g.times.length < grupoAlvo.times.length) grupoAlvo = g;
    }
    grupoAlvo.times.push(limpo);
    grupoAlvo.partidas = gerarPartidasGrupo(grupoAlvo.times);
  }
}

function acaoRemoverParticipante(id) {
  if (algumaPartidaJogada()) throw new ErroApi('O torneio já começou — não é mais possível remover participantes.');
  const participante = estado.participantes.find((p) => p.id === id);
  if (!participante) throw new ErroApi('Participante não encontrado.', 404);
  estado.participantes = estado.participantes.filter((p) => p.id !== id);
  if (estado.faseGruposGerada) {
    const grupo = estado.grupos.find((g) => g.times.includes(participante.nome));
    if (grupo) {
      grupo.times = grupo.times.filter((t) => t !== participante.nome);
      grupo.partidas = grupo.partidas.filter((p) => p.casa !== participante.nome && p.fora !== participante.nome);
    }
  }
}

function acaoEditarParticipante(id, novoNome) {
  if (algumaPartidaJogada()) throw new ErroApi('O torneio já começou — não é mais possível editar participantes.');
  const limpo = String(novoNome || '').trim();
  if (!limpo) throw new ErroApi('Informe um nome.');
  const participante = estado.participantes.find((p) => p.id === id);
  if (!participante) throw new ErroApi('Participante não encontrado.', 404);
  if (estado.participantes.some((p) => p.id !== id && p.nome.toLowerCase() === limpo.toLowerCase())) {
    throw new ErroApi('Já existe um participante com esse nome.');
  }
  const nomeAntigo = participante.nome;
  participante.nome = limpo;
  if (estado.faseGruposGerada && nomeAntigo !== limpo) {
    const grupo = estado.grupos.find((g) => g.times.includes(nomeAntigo));
    if (grupo) {
      grupo.times = grupo.times.map((t) => (t === nomeAntigo ? limpo : t));
      grupo.partidas.forEach((p) => {
        if (p.casa === nomeAntigo) p.casa = limpo;
        if (p.fora === nomeAntigo) p.fora = limpo;
      });
    }
  }
}

function acaoDefinirConfig({ numGrupos }) {
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada.');
  if (![2, 4, 8].includes(Number(numGrupos))) throw new ErroApi('Número de grupos inválido.');
  estado.numGrupos = Number(numGrupos);
}

function acaoIniciarFaseDeGrupos() {
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada.');
  const grupos = participantesPorGrupo();
  if (grupos.some((g) => g.length < 2)) {
    throw new ErroApi('Cada grupo precisa de pelo menos 2 participantes.');
  }
  estado.grupos = grupos.map((g, i) => {
    const times = g.map((p) => p.nome);
    return { nome: `Grupo ${LETRAS[i]}`, times, partidas: gerarPartidasGrupo(times) };
  });
  estado.faseGruposGerada = true;
}

function acaoSalvarPlacarGrupo(grupoIdx, partidaId, golsCasa, golsFora) {
  const grupo = estado.grupos[grupoIdx];
  if (!grupo) throw new ErroApi('Grupo não encontrado.', 404);
  const partida = grupo.partidas.find((p) => p.id === partidaId);
  if (!partida) throw new ErroApi('Partida não encontrada.', 404);
  if (!Number.isInteger(golsCasa) || !Number.isInteger(golsFora) || golsCasa < 0 || golsFora < 0) {
    throw new ErroApi('Placar inválido.');
  }
  partida.golsCasa = golsCasa;
  partida.golsFora = golsFora;

  if (faseGruposCompleta() && !estado.mataMata) {
    gerarMataMata();
  }
}

function normalizarData(data) {
  const limpo = data == null ? '' : String(data).trim();
  if (!limpo) return null;
  if (isNaN(new Date(limpo).getTime())) throw new ErroApi('Data inválida.');
  return limpo;
}

function acaoSalvarDataGrupo(grupoIdx, partidaId, data) {
  const grupo = estado.grupos[grupoIdx];
  if (!grupo) throw new ErroApi('Grupo não encontrado.', 404);
  const partida = grupo.partidas.find((p) => p.id === partidaId);
  if (!partida) throw new ErroApi('Partida não encontrada.', 404);
  partida.data = normalizarData(data);
}

function acaoSalvarDataMataMata(rodadaIdx, partidaIdx, data) {
  if (!estado.mataMata) throw new ErroApi('Mata-mata ainda não foi gerado.', 404);
  const rodada = estado.mataMata.rounds[rodadaIdx];
  const partida = rodada && rodada[partidaIdx];
  if (!partida) throw new ErroApi('Confronto não encontrado.', 404);
  partida.data = normalizarData(data);
}

function acaoSalvarPlacarMataMata(rodadaIdx, partidaIdx, golsCasa, golsFora, penVencedor) {
  if (!estado.mataMata) throw new ErroApi('Mata-mata ainda não foi gerado.', 404);
  const rodada = estado.mataMata.rounds[rodadaIdx];
  const partida = rodada && rodada[partidaIdx];
  if (!partida) throw new ErroApi('Confronto não encontrado.', 404);
  if (!partida.casa || !partida.fora) throw new ErroApi('Aguardando definição dos times.');
  if (!Number.isInteger(golsCasa) || !Number.isInteger(golsFora) || golsCasa < 0 || golsFora < 0) {
    throw new ErroApi('Placar inválido.');
  }

  partida.golsCasa = golsCasa;
  partida.golsFora = golsFora;

  if (golsCasa === golsFora) {
    if (!penVencedor || (penVencedor !== partida.casa && penVencedor !== partida.fora)) {
      partida.vencedor = null;
      return { aguardandoPenalti: true };
    }
    partida.vencedor = penVencedor;
    partida.penaltis = true;
  } else {
    partida.vencedor = golsCasa > golsFora ? partida.casa : partida.fora;
    partida.penaltis = false;
  }

  let finalDefinida = false;
  const rodadaCompleta = rodada.every((m) => m.vencedor);
  if (rodadaCompleta) {
    if (rodada.length === 1) {
      estado.campeao = rodada[0].vencedor;
    } else if (!estado.mataMata.rounds[rodadaIdx + 1]) {
      const proxima = [];
      for (let i = 0; i < rodada.length; i += 2) {
        proxima.push(criarPartidaMM(rodada[i].vencedor, rodada[i + 1].vencedor));
      }
      estado.mataMata.rounds.push(proxima);
      finalDefinida = proxima.length === 1;
    }
  }
  return { aguardandoPenalti: false, finalDefinida };
}

function calcularFinalistas() {
  if (!estado.mataMata || estado.campeao) return null;
  const ultimaRodada = estado.mataMata.rounds[estado.mataMata.rounds.length - 1];
  if (ultimaRodada.length !== 1) return null;
  const [confronto] = ultimaRodada;
  if (!confronto.casa || !confronto.fora) return null;
  return { casa: confronto.casa, fora: confronto.fora };
}

function acaoReiniciar() {
  estado = estadoPadrao();
}

/* ============================ SERVIDOR HTTP ============================ */

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => {
      dados += chunk;
      if (dados.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); } catch { reject(new ErroApi('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function enviarJson(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(texto);
}

function servirArquivoEstatico(req, res) {
  let caminho = decodeURIComponent(req.url.split('?')[0]);
  if (caminho === '/') caminho = '/index.html';
  const arquivo = path.join(PASTA_PUBLICA, caminho);
  if (!arquivo.startsWith(PASTA_PUBLICA)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const partes = url.pathname.split('/').filter(Boolean); // ex.: ['api','grupos','0','abc123','placar']

  if (partes[0] !== 'api') return servirArquivoEstatico(req, res);

  try {
    // GET /api/estado
    if (req.method === 'GET' && partes[1] === 'estado') {
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/participantes
    if (req.method === 'POST' && partes[1] === 'participantes' && partes.length === 2) {
      acaoAdicionarParticipante(await lerCorpo(req));
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // DELETE /api/participantes/:id
    if (req.method === 'DELETE' && partes[1] === 'participantes' && partes.length === 3) {
      acaoRemoverParticipante(partes[2]);
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // PATCH /api/participantes/:id
    if (req.method === 'PATCH' && partes[1] === 'participantes' && partes.length === 3) {
      const corpo = await lerCorpo(req);
      acaoEditarParticipante(partes[2], corpo.nome);
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/config
    if (req.method === 'POST' && partes[1] === 'config') {
      acaoDefinirConfig(await lerCorpo(req));
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/iniciar-fase-grupos
    if (req.method === 'POST' && partes[1] === 'iniciar-fase-grupos') {
      acaoIniciarFaseDeGrupos();
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/grupos/:grupoIdx/:partidaId/placar
    if (req.method === 'POST' && partes[1] === 'grupos' && partes[4] === 'placar') {
      const corpo = await lerCorpo(req);
      acaoSalvarPlacarGrupo(Number(partes[2]), partes[3], Number(corpo.golsCasa), Number(corpo.golsFora));
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/grupos/:grupoIdx/:partidaId/data
    if (req.method === 'POST' && partes[1] === 'grupos' && partes[4] === 'data') {
      const corpo = await lerCorpo(req);
      acaoSalvarDataGrupo(Number(partes[2]), partes[3], corpo.data);
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/mata-mata/:rodadaIdx/:partidaIdx/data
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[4] === 'data') {
      const corpo = await lerCorpo(req);
      acaoSalvarDataMataMata(Number(partes[2]), Number(partes[3]), corpo.data);
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/mata-mata/:rodadaIdx/:partidaIdx/placar
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[4] === 'placar') {
      const corpo = await lerCorpo(req);
      const resultado = acaoSalvarPlacarMataMata(
        Number(partes[2]), Number(partes[3]), Number(corpo.golsCasa), Number(corpo.golsFora), corpo.penVencedor || null
      );
      salvarEstado();
      return enviarJson(res, 200, { ...montarEstadoPublico(), ...resultado });
    }

    // POST /api/reiniciar
    if (req.method === 'POST' && partes[1] === 'reiniciar') {
      acaoReiniciar();
      salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    return enviarJson(res, 404, { erro: 'Rota não encontrada.' });
  } catch (erro) {
    const status = erro instanceof ErroApi ? erro.status : 500;
    if (status === 500) console.error(erro);
    return enviarJson(res, status, { erro: erro.message || 'Erro interno.' });
  }
});

servidor.listen(PORTA, () => console.log(`Campeonato EA Sports FC 26 rodando em http://localhost:${PORTA}`));
