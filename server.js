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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USAR_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const SUPABASE_TABELA = 'campeonato_ps5_estado';
const SUPABASE_ID = 'default';

const uid = () => crypto.randomBytes(5).toString('hex');

/* ============================ ESTADO ============================ */
/* Persistido no Supabase em produção (disco do Render é efêmero); cai para
   um arquivo local quando as variáveis de ambiente não estão configuradas
   (ex.: rodando localmente para testes). */

function estadoPadrao() {
  return {
    numGrupos: 2,
    faseGruposGerada: false,
    participantes: [],
    patrocinadores: [],
    carrosselIntervalo: 4,
    senhaHash: null,
    grupos: [],
    mataMata: null,
    campeao: null
  };
}

function hashSenha(senha) {
  return crypto.createHash('sha256').update(String(senha)).digest('hex');
}

function verificarSenha(senha) {
  if (!estado.senhaHash) return; // torneio sem senha configurada
  if (!senha || hashSenha(senha) !== estado.senhaHash) {
    throw new ErroApi('Senha incorreta.', 403);
  }
}

async function carregarEstado() {
  if (USAR_SUPABASE) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABELA}?id=eq.${SUPABASE_ID}&select=dados`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (!r.ok) throw new Error(`Supabase respondeu ${r.status}`);
      const linhas = await r.json();
      return linhas[0]?.dados ? { ...estadoPadrao(), ...linhas[0].dados } : estadoPadrao();
    } catch (erro) {
      console.error('Falha ao carregar estado do Supabase, iniciando vazio:', erro.message);
      return estadoPadrao();
    }
  }
  try {
    const bruto = fs.readFileSync(ARQUIVO_ESTADO, 'utf-8');
    return { ...estadoPadrao(), ...JSON.parse(bruto) };
  } catch {
    return estadoPadrao();
  }
}

let estado = estadoPadrao();

async function salvarEstado() {
  if (USAR_SUPABASE) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABELA}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ id: SUPABASE_ID, dados: estado, atualizado_em: new Date().toISOString() })
      });
      if (!r.ok) console.error('Falha ao salvar estado no Supabase:', r.status, await r.text().catch(() => ''));
    } catch (erro) {
      console.error('Falha ao salvar estado no Supabase:', erro.message);
    }
    return;
  }
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2), 'utf-8');
}

/* ============================ REGRAS DO TORNEIO ============================ */

function participantesPorGrupo() {
  const grupos = Array.from({ length: estado.numGrupos }, () => []);
  estado.participantes.forEach((p, i) => grupos[i % estado.numGrupos].push(p));
  return grupos;
}

function gerarPartidasGrupo(times) {
  // Método do polígono (circle method): cada time joga no máximo 1 vez por rodada,
  // evitando que alguém apareça em partidas consecutivas na lista.
  let atual = [...times];
  const temFolga = atual.length % 2 !== 0;
  if (temFolga) atual.push(null);
  const n = atual.length;
  const numRodadas = n - 1;
  const metade = n / 2;
  const partidas = [];

  for (let rodada = 1; rodada <= numRodadas; rodada++) {
    for (let i = 0; i < metade; i++) {
      const casa = atual[i];
      const fora = atual[n - 1 - i];
      if (casa != null && fora != null) {
        partidas.push({ id: uid(), casa, fora, golsCasa: null, golsFora: null, data: null, rodada });
      }
    }
    const fixo = atual[0];
    const resto = atual.slice(1);
    resto.unshift(resto.pop());
    atual = [fixo, ...resto];
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

function montarPreviaChaveamento() {
  if (!estado.faseGruposGerada || estado.mataMata || estado.grupos.length < 2) return null;

  const rotuloClassificado = (grupoIdx, posicao) => {
    const g = estado.grupos[grupoIdx];
    if (grupoCompleto(g)) {
      return { nome: calcularClassificacao(g)[posicao].time, definido: true };
    }
    return { nome: `${posicao === 0 ? '1º' : '2º'} ${g.nome}`, definido: false };
  };

  const rodada1 = [];
  for (let i = 0; i < estado.grupos.length; i += 2) {
    rodada1.push({ casa: rotuloClassificado(i, 0), fora: rotuloClassificado(i + 1, 1) });
    rodada1.push({ casa: rotuloClassificado(i + 1, 0), fora: rotuloClassificado(i, 1) });
  }

  const rounds = [rodada1];
  let tamanho = rodada1.length;
  while (tamanho > 1) {
    tamanho = tamanho / 2;
    rounds.push(Array.from({ length: tamanho }, () => ({
      casa: { nome: null, definido: false },
      fora: { nome: null, definido: false }
    })));
  }
  return rounds;
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
    patrocinadores: estado.patrocinadores,
    carrosselIntervalo: estado.carrosselIntervalo,
    temSenha: !!estado.senhaHash,
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
    mataMata: estado.mataMata,
    previaChaveamento: montarPreviaChaveamento(),
    destaques: calcularDestaques()
  };
}

/* ============================ AÇÕES ============================ */

class ErroApi extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

const TAMANHO_MAX_IMAGEM_BASE64 = 1_400_000; // ~1MB de imagem binária

function acaoAdicionarPatrocinador({ nome, imagem }) {
  const limpo = String(nome || '').trim();
  if (!limpo) throw new ErroApi('Informe um nome.');
  if (!imagem || !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(imagem)) {
    throw new ErroApi('Envie uma imagem para o patrocinador.');
  }
  if (imagem.length > TAMANHO_MAX_IMAGEM_BASE64) {
    throw new ErroApi('Imagem muito grande. Envie um arquivo de até ~1MB.');
  }
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada — os patrocinadores não podem mais ser alterados.');
  if (estado.patrocinadores.some((s) => s.nome.toLowerCase() === limpo.toLowerCase())) {
    throw new ErroApi('Esse patrocinador já foi adicionado.');
  }
  estado.patrocinadores.push({ id: uid(), nome: limpo, imagem });
}

function acaoRemoverPatrocinador(id) {
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada — os patrocinadores não podem mais ser alterados.');
  estado.patrocinadores = estado.patrocinadores.filter((s) => s.id !== id);
}

function acaoDefinirCarrosselIntervalo({ segundos }) {
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada.');
  const n = Number(segundos);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new ErroApi('Informe um intervalo entre 1 e 30 segundos.');
  estado.carrosselIntervalo = n;
}

function acaoAdicionarParticipante({ nome }) {
  const limpo = String(nome || '').trim();
  if (!limpo) throw new ErroApi('Informe um nome.');
  if (algumaPartidaJogada()) throw new ErroApi('O torneio já começou — não é mais possível adicionar participantes.');
  if (estado.participantes.some((p) => p.nome.toLowerCase() === limpo.toLowerCase())) {
    throw new ErroApi('Já existe um participante com esse nome.');
  }

  // Fase já gerada: só permite adicionar se houver uma vaga aberta (grupo com menos
  // times que os demais, deixada por uma remoção). Se os grupos já estiverem
  // equilibrados, não há vaga para ocupar.
  let grupoAlvo = null;
  if (estado.faseGruposGerada) {
    const tamanhos = estado.grupos.map((g) => g.times.length);
    const minimo = Math.min(...tamanhos);
    const maximo = Math.max(...tamanhos);
    if (minimo === maximo) {
      throw new ErroApi('Os grupos já estão completos e equilibrados. Remova um participante para abrir uma vaga antes de adicionar outro.');
    }
    grupoAlvo = estado.grupos.find((g) => g.times.length === minimo);
  }

  estado.participantes.push({ id: uid(), nome: limpo });

  if (grupoAlvo) {
    grupoAlvo.times.push(limpo);
    grupoAlvo.partidas = gerarPartidasGrupo(grupoAlvo.times);
  }
}

function acaoRemoverParticipante(id, senha) {
  if (algumaPartidaJogada()) throw new ErroApi('O torneio já começou — não é mais possível remover participantes.');
  const participante = estado.participantes.find((p) => p.id === id);
  if (!participante) throw new ErroApi('Participante não encontrado.', 404);
  verificarSenha(senha);
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

function acaoSortearGrupos() {
  if (estado.faseGruposGerada) throw new ErroApi('A fase de grupos já foi gerada.');
  if (estado.participantes.length < 2) throw new ErroApi('Adicione pelo menos 2 participantes antes de sortear.');
  for (let i = estado.participantes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [estado.participantes[i], estado.participantes[j]] = [estado.participantes[j], estado.participantes[i]];
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

function acaoSalvarPlacarGrupo(grupoIdx, partidaId, golsCasa, golsFora, senha, wo, woAusente) {
  const grupo = estado.grupos[grupoIdx];
  if (!grupo) throw new ErroApi('Grupo não encontrado.', 404);
  const partida = grupo.partidas.find((p) => p.id === partidaId);
  if (!partida) throw new ErroApi('Partida não encontrada.', 404);
  if (!Number.isInteger(golsCasa) || !Number.isInteger(golsFora) || golsCasa < 0 || golsFora < 0) {
    throw new ErroApi('Placar inválido.');
  }
  // Corrigir um placar já lançado exige a senha; o primeiro lançamento não.
  const jaTinhaPlacar = partida.golsCasa != null || partida.golsFora != null;
  if (jaTinhaPlacar) verificarSenha(senha);

  partida.golsCasa = golsCasa;
  partida.golsFora = golsFora;
  partida.wo = !!wo;
  partida.woAusente = wo && (woAusente === partida.casa || woAusente === partida.fora) ? woAusente : null;

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

function acaoSalvarPlacarMataMata(rodadaIdx, partidaIdx, golsCasa, golsFora, penVencedor, senha) {
  if (!estado.mataMata) throw new ErroApi('Mata-mata ainda não foi gerado.', 404);
  const rodada = estado.mataMata.rounds[rodadaIdx];
  const partida = rodada && rodada[partidaIdx];
  if (!partida) throw new ErroApi('Confronto não encontrado.', 404);
  if (!partida.casa || !partida.fora) throw new ErroApi('Aguardando definição dos times.');
  if (!Number.isInteger(golsCasa) || !Number.isInteger(golsFora) || golsCasa < 0 || golsFora < 0) {
    throw new ErroApi('Placar inválido.');
  }
  // Mudar o resultado de um confronto já decidido exige a senha (a etapa de escolher o
  // vencedor nos pênaltis não conta como "já decidido", pois o vencedor ainda está null).
  if (partida.vencedor) verificarSenha(senha);

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
      // A rodada que acabou de virar a final tinha 2 confrontos (semifinal) — os dois
      // perdedores dela se enfrentam pelo 3º lugar.
      if (finalDefinida && rodada.length === 2 && !estado.mataMata.terceiroLugar) {
        const perdedor = (m) => (m.vencedor === m.casa ? m.fora : m.casa);
        estado.mataMata.terceiroLugar = criarPartidaMM(perdedor(rodada[0]), perdedor(rodada[1]));
      }
    }
  }
  return { aguardandoPenalti: false, finalDefinida };
}

function acaoSalvarPlacarTerceiroLugar(golsCasa, golsFora, penVencedor, senha) {
  const partida = estado.mataMata?.terceiroLugar;
  if (!partida) throw new ErroApi('Disputa de 3º lugar ainda não foi gerada.', 404);
  if (!Number.isInteger(golsCasa) || !Number.isInteger(golsFora) || golsCasa < 0 || golsFora < 0) {
    throw new ErroApi('Placar inválido.');
  }
  if (partida.vencedor) verificarSenha(senha);

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
  return { aguardandoPenalti: false };
}

function acaoSalvarDataTerceiroLugar(data) {
  const partida = estado.mataMata?.terceiroLugar;
  if (!partida) throw new ErroApi('Disputa de 3º lugar ainda não foi gerada.', 404);
  partida.data = normalizarData(data);
}

function calcularFinalistas() {
  if (!estado.mataMata || estado.campeao) return null;
  const ultimaRodada = estado.mataMata.rounds[estado.mataMata.rounds.length - 1];
  if (ultimaRodada.length !== 1) return null;
  const [confronto] = ultimaRodada;
  if (!confronto.casa || !confronto.fora) return null;
  return { casa: confronto.casa, fora: confronto.fora };
}

function calcularDestaques() {
  // Sempre visível, desde antes de qualquer partida — funciona como prévia dos troféus
  // que serão premiados, preenchendo-se sozinho conforme os jogos acontecem.
  const partidas = [];
  estado.grupos.forEach((g) => g.partidas.forEach((p) => { if (p.golsCasa != null) partidas.push(p); }));
  if (estado.mataMata) {
    estado.mataMata.rounds.forEach((r) => r.forEach((p) => { if (p.golsCasa != null) partidas.push(p); }));
    if (estado.mataMata.terceiroLugar?.golsCasa != null) partidas.push(estado.mataMata.terceiroLugar);
  }

  const stats = {};
  const pega = (nome) => (stats[nome] ??= { nome, gp: 0, gc: 0, v: 0, d: 0, e: 0, jogos: 0, wo: 0 });

  partidas.forEach((p) => {
    const casa = pega(p.casa), fora = pega(p.fora);
    casa.jogos++; fora.jogos++;
    casa.gp += p.golsCasa; casa.gc += p.golsFora;
    fora.gp += p.golsFora; fora.gc += p.golsCasa;
    if (p.golsCasa > p.golsFora) { casa.v++; fora.d++; }
    else if (p.golsCasa < p.golsFora) { fora.v++; casa.d++; }
    else { casa.e++; fora.e++; }
    if (p.wo && p.woAusente) pega(p.woAusente).wo++;
  });

  const lista = Object.values(stats);
  const maiorQue = (campo) => lista.reduce((m, x) => (x[campo] > (m?.[campo] ?? -Infinity) ? x : m), null);
  const menorQue = (campo) => lista.filter((x) => x.jogos > 0).reduce((m, x) => (x[campo] < (m?.[campo] ?? Infinity) ? x : m), null);

  const artilheiroTop = maiorQue('gp');
  const muralhaTop = menorQue('gc');
  const woTop = maiorQue('wo');

  // "Parceiro do Ano": pior desempenho do torneio — mesmo critério da classificação
  // dos grupos (pontos e depois saldo de gols), só que pegando o pior em vez do melhor.
  const piorDesempenhoTop = lista
    .filter((x) => x.jogos > 0)
    .map((x) => ({ ...x, pts: x.v * 2 + x.e, saldo: x.gp - x.gc }))
    .reduce((pior, x) => {
      if (!pior) return x;
      if (x.pts < pior.pts || (x.pts === pior.pts && x.saldo < pior.saldo)) return x;
      return pior;
    }, null);

  let goleada = null;
  partidas.forEach((p) => {
    const dif = Math.abs(p.golsCasa - p.golsFora);
    if (dif > 0 && (!goleada || dif > goleada.diferenca)) {
      goleada = {
        vencedor: p.golsCasa > p.golsFora ? p.casa : p.fora,
        perdedor: p.golsCasa > p.golsFora ? p.fora : p.casa,
        diferenca: dif,
        placar: `${p.golsCasa}-${p.golsFora}`
      };
    }
  });

  let vice = null;
  if (estado.mataMata && estado.campeao) {
    const ultimaRodada = estado.mataMata.rounds[estado.mataMata.rounds.length - 1];
    const finalConfronto = ultimaRodada[0];
    vice = finalConfronto.vencedor === finalConfronto.casa ? finalConfronto.fora : finalConfronto.casa;
  }
  let terceiro = null; // null = ainda não chegou nessa fase; [nome] = decidido; [nomeA, nomeB] = em disputa
  if (estado.mataMata?.terceiroLugar) {
    const tl = estado.mataMata.terceiroLugar;
    terceiro = tl.vencedor ? [tl.vencedor] : [tl.casa, tl.fora];
  }

  return {
    torneioFinalizado: !!estado.campeao,
    podio: { primeiro: estado.campeao || null, segundo: vice, terceiro },
    artilheiro: artilheiroTop && artilheiroTop.gp > 0 ? { nome: artilheiroTop.nome, gols: artilheiroTop.gp } : null,
    muralha: muralhaTop ? { nome: muralhaTop.nome, sofridos: muralhaTop.gc } : null,
    invenciveis: lista.filter((x) => x.jogos > 0 && x.d === 0).map((x) => x.nome),
    piorDesempenho: piorDesempenhoTop ? { nome: piorDesempenhoTop.nome, pontos: piorDesempenhoTop.pts, saldo: piorDesempenhoTop.saldo } : null,
    goleada,
    maisWO: woTop && woTop.wo > 0 ? { nome: woTop.nome, vezes: woTop.wo } : null
  };
}

function acaoReiniciar({ senha } = {}) {
  if (estado.senhaHash) {
    if (!senha || hashSenha(senha) !== estado.senhaHash) {
      throw new ErroApi('Senha incorreta.', 403);
    }
  }
  estado = estadoPadrao();
}

function acaoDefinirSenha({ senha, senhaAtual }) {
  const novaSenha = String(senha ?? '').trim();

  if (estado.senhaHash) {
    // Já existe senha: só quem sabe a atual pode trocar ou remover.
    if (!senhaAtual || hashSenha(senhaAtual) !== estado.senhaHash) {
      throw new ErroApi('Senha atual incorreta.', 403);
    }
    if (!novaSenha) {
      estado.senhaHash = null; // remove a proteção
      return;
    }
    if (novaSenha.length < 4) throw new ErroApi('A nova senha deve ter pelo menos 4 caracteres.');
    estado.senhaHash = hashSenha(novaSenha);
    return;
  }

  // Ainda não tem senha: só pode ser definida na criação do torneio, antes dos
  // grupos gerados — depois disso, se ninguém definiu, o torneio fica sem essa proteção.
  if (estado.faseGruposGerada) throw new ErroApi('Só é possível definir a senha antes da fase de grupos ser gerada.');
  if (!novaSenha) throw new ErroApi('Informe uma senha.');
  if (novaSenha.length < 4) throw new ErroApi('A senha deve ter pelo menos 4 caracteres.');
  estado.senhaHash = hashSenha(novaSenha);
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
      if (dados.length > 2_000_000) req.destroy();
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

    // POST /api/patrocinadores
    if (req.method === 'POST' && partes[1] === 'patrocinadores' && partes.length === 2) {
      acaoAdicionarPatrocinador(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // DELETE /api/patrocinadores/:id
    if (req.method === 'DELETE' && partes[1] === 'patrocinadores' && partes.length === 3) {
      acaoRemoverPatrocinador(partes[2]);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/config-carrossel
    if (req.method === 'POST' && partes[1] === 'config-carrossel') {
      acaoDefinirCarrosselIntervalo(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/participantes
    if (req.method === 'POST' && partes[1] === 'participantes' && partes.length === 2) {
      acaoAdicionarParticipante(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // DELETE /api/participantes/:id
    if (req.method === 'DELETE' && partes[1] === 'participantes' && partes.length === 3) {
      const corpo = await lerCorpo(req);
      acaoRemoverParticipante(partes[2], corpo.senha);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // PATCH /api/participantes/:id
    if (req.method === 'PATCH' && partes[1] === 'participantes' && partes.length === 3) {
      const corpo = await lerCorpo(req);
      acaoEditarParticipante(partes[2], corpo.nome);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/sortear-grupos
    if (req.method === 'POST' && partes[1] === 'sortear-grupos') {
      acaoSortearGrupos();
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/config
    if (req.method === 'POST' && partes[1] === 'config') {
      acaoDefinirConfig(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/iniciar-fase-grupos
    if (req.method === 'POST' && partes[1] === 'iniciar-fase-grupos') {
      acaoIniciarFaseDeGrupos();
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/grupos/:grupoIdx/:partidaId/placar
    if (req.method === 'POST' && partes[1] === 'grupos' && partes[4] === 'placar') {
      const corpo = await lerCorpo(req);
      acaoSalvarPlacarGrupo(Number(partes[2]), partes[3], Number(corpo.golsCasa), Number(corpo.golsFora), corpo.senha, corpo.wo, corpo.woAusente);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/grupos/:grupoIdx/:partidaId/data
    if (req.method === 'POST' && partes[1] === 'grupos' && partes[4] === 'data') {
      const corpo = await lerCorpo(req);
      acaoSalvarDataGrupo(Number(partes[2]), partes[3], corpo.data);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/mata-mata/terceiro-lugar/data
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[2] === 'terceiro-lugar' && partes[3] === 'data') {
      const corpo = await lerCorpo(req);
      acaoSalvarDataTerceiroLugar(corpo.data);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/mata-mata/terceiro-lugar/placar
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[2] === 'terceiro-lugar' && partes[3] === 'placar') {
      const corpo = await lerCorpo(req);
      const resultado = acaoSalvarPlacarTerceiroLugar(Number(corpo.golsCasa), Number(corpo.golsFora), corpo.penVencedor || null, corpo.senha);
      await salvarEstado();
      return enviarJson(res, 200, { ...montarEstadoPublico(), ...resultado });
    }

    // POST /api/mata-mata/:rodadaIdx/:partidaIdx/data
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[4] === 'data') {
      const corpo = await lerCorpo(req);
      acaoSalvarDataMataMata(Number(partes[2]), Number(partes[3]), corpo.data);
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/mata-mata/:rodadaIdx/:partidaIdx/placar
    if (req.method === 'POST' && partes[1] === 'mata-mata' && partes[4] === 'placar') {
      const corpo = await lerCorpo(req);
      const resultado = acaoSalvarPlacarMataMata(
        Number(partes[2]), Number(partes[3]), Number(corpo.golsCasa), Number(corpo.golsFora), corpo.penVencedor || null, corpo.senha
      );
      await salvarEstado();
      return enviarJson(res, 200, { ...montarEstadoPublico(), ...resultado });
    }

    // POST /api/reiniciar
    if (req.method === 'POST' && partes[1] === 'reiniciar') {
      acaoReiniciar(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    // POST /api/senha
    if (req.method === 'POST' && partes[1] === 'senha') {
      acaoDefinirSenha(await lerCorpo(req));
      await salvarEstado();
      return enviarJson(res, 200, montarEstadoPublico());
    }

    return enviarJson(res, 404, { erro: 'Rota não encontrada.' });
  } catch (erro) {
    const status = erro instanceof ErroApi ? erro.status : 500;
    if (status === 500) console.error(erro);
    return enviarJson(res, status, { erro: erro.message || 'Erro interno.' });
  }
});

(async () => {
  estado = await carregarEstado();
  servidor.listen(PORTA, () => {
    console.log(`Campeonato EA Sports FC 26 rodando em http://localhost:${PORTA}`);
    console.log(`Persistência: ${USAR_SUPABASE ? 'Supabase (' + SUPABASE_URL + ')' : 'arquivo local (' + ARQUIVO_ESTADO + ')'}`);
  });
})();
