'use strict';
/* Campeonato EA Sports FC 26 — cliente. Todo o estado vem do servidor via /api. */

const app = document.getElementById('app');
const carregando = document.getElementById('carregando');
const LETRAS = 'ABCDEFGH';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function paraInputData(iso) {
  return iso ? String(iso).slice(0, 16) : '';
}

let estado = null;
let abaAtiva = 'participantes';
let pendentePenalti = null; // { rodadaIdx, partidaIdx }
let intervaloAtualizacao = null;

let toastTimer;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.className = tipo;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

async function api(caminho, metodo = 'GET', corpo) {
  const opc = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (corpo) opc.body = JSON.stringify(corpo);
  const r = await fetch(caminho, opc);
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}

async function atualizarEstado(novoEstado, { silencioso } = {}) {
  const eraCampeao = estado?.campeao;
  estado = novoEstado;
  if (!eraCampeao && estado.campeao) {
    abaAtiva = 'campeao';
    toast(`🏆 ${estado.campeao} é o campeão!`, 'ok');
  }
  document.querySelectorAll('.aba-btn').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === abaAtiva));
  render();
  if (!silencioso) {} // reservado
}

async function carregarDoServidor({ inicial } = {}) {
  try {
    const dados = await api('/api/estado');
    await atualizarEstado(dados);
    if (inicial) carregando.style.display = 'none';
  } catch (e) {
    if (inicial) { carregando.textContent = 'Não foi possível conectar ao servidor.'; }
    else toast('Falha ao atualizar dados do servidor.', 'erro');
  }
}

/* ============================ AÇÕES (chamam a API) ============================ */

async function adicionarParticipante(nome) {
  const limpo = nome.trim();
  if (!limpo) return;
  try {
    const dados = await api('/api/participantes', 'POST', { nome: limpo });
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function removerParticipante(id) {
  try {
    const dados = await api(`/api/participantes/${id}`, 'DELETE');
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function definirNumGrupos(n) {
  try {
    const dados = await api('/api/config', 'POST', { numGrupos: n });
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function iniciarFaseDeGrupos() {
  try {
    const dados = await api('/api/iniciar-fase-grupos', 'POST');
    await atualizarEstado(dados);
    toast('Fase de grupos gerada! Vá em "Fase de Grupos" para lançar os placares.', 'ok');
    mudarAba('grupos');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarPlacarGrupo(grupoIdx, partidaId, golsCasa, golsFora) {
  try {
    const dados = await api(`/api/grupos/${grupoIdx}/${partidaId}/placar`, 'POST', { golsCasa, golsFora });
    const gerouMataMata = !estado.mataMata && dados.mataMata;
    await atualizarEstado(dados);
    if (gerouMataMata) toast('Fase de grupos concluída! Mata-mata gerado.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarPlacarMM(rodadaIdx, partidaIdx, golsCasa, golsFora, penVencedor) {
  try {
    const dados = await api(`/api/mata-mata/${rodadaIdx}/${partidaIdx}/placar`, 'POST', { golsCasa, golsFora, penVencedor });
    if (dados.aguardandoPenalti) {
      pendentePenalti = { rodadaIdx, partidaIdx };
    } else {
      pendentePenalti = null;
    }
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarDataGrupo(grupoIdx, partidaId, data) {
  try {
    const dados = await api(`/api/grupos/${grupoIdx}/${partidaId}/data`, 'POST', { data });
    await atualizarEstado(dados);
    toast('Data salva.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarDataMM(rodadaIdx, partidaIdx, data) {
  try {
    const dados = await api(`/api/mata-mata/${rodadaIdx}/${partidaIdx}/data`, 'POST', { data });
    await atualizarEstado(dados);
    toast('Data salva.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function reiniciarTorneio() {
  if (!confirm('Isso vai apagar participantes, grupos, placares e o campeão para todo mundo. Deseja mesmo reiniciar?')) return;
  try {
    const dados = await api('/api/reiniciar', 'POST');
    pendentePenalti = null;
    estado = null;
    abaAtiva = 'participantes';
    document.querySelectorAll('.aba-btn').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === 'participantes'));
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

function mudarAba(nome) {
  abaAtiva = nome;
  document.querySelectorAll('.aba-btn').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  render();
}

/* ============================ RENDER ============================ */

function render() {
  if (!estado) return;
  if (abaAtiva === 'participantes') return renderParticipantes();
  if (abaAtiva === 'grupos') return renderGrupos();
  if (abaAtiva === 'mataMata') return renderMataMata();
  if (abaAtiva === 'campeao') return renderCampeao();
}

function renderParticipantes() {
  const grupos = estado.gruposPorTime || [];
  const opcoesGrupo = [2, 4, 8].map((n) =>
    `<option value="${n}" ${estado.numGrupos === n ? 'selected' : ''}>${n} grupos (${n * 2} classificados para o mata-mata)</option>`
  ).join('');

  app.innerHTML = `
    <div class="card">
      <h2>1. Configuração</h2>
      <div class="linha-form">
        <select id="selNumGrupos" ${estado.faseGruposGerada ? 'disabled' : ''}>${opcoesGrupo}</select>
      </div>
      ${estado.faseGruposGerada ? '<div class="aviso">Fase de grupos já gerada. Reinicie o torneio para mudar a configuração ou os participantes.</div>' : ''}
    </div>

    <div class="card">
      <h2>2. Participantes <span class="selo">${estado.participantes.length} adicionados</span></h2>
      ${!estado.faseGruposGerada ? `
        <div class="linha-form">
          <input type="text" id="inNomeParticipante" placeholder="Nome do jogador (será o nome do time)" maxlength="30">
          <button class="btn" id="btnAddParticipante">Adicionar</button>
        </div>
      ` : ''}
      ${estado.participantes.length === 0 ? '<div class="vazio">Nenhum participante ainda. Adicione os jogadores acima.</div>' : `
        <ul class="lista-participantes">
          ${estado.participantes.map((p, i) => `
            <li>
              <span>${esc(p.nome)} <span class="tag-grupo">Grupo ${LETRAS[i % estado.numGrupos]}</span></span>
              ${!estado.faseGruposGerada ? `<button class="btn-x" data-acao="remover-participante" data-id="${p.id}">✕</button>` : ''}
            </li>
          `).join('')}
        </ul>
      `}
    </div>

    ${!estado.faseGruposGerada ? `
      <div class="grupos-grid">
        ${grupos.map((g, i) => `
          <div class="card">
            <h3>Grupo ${LETRAS[i]} <span class="selo">${g.length} jogador(es)</span></h3>
            ${g.length === 0 ? '<div class="vazio">Vazio</div>' : `<ul class="lista-participantes">${g.map((p) => `<li>${esc(p.nome)}</li>`).join('')}</ul>`}
          </div>
        `).join('')}
      </div>
      <div class="card">
        <button class="btn" id="btnGerarGrupos">Gerar fase de grupos</button>
      </div>
    ` : ''}
  `;

  document.getElementById('selNumGrupos')?.addEventListener('change', (e) => definirNumGrupos(Number(e.target.value)));
  document.getElementById('btnAddParticipante')?.addEventListener('click', () => {
    const input = document.getElementById('inNomeParticipante');
    adicionarParticipante(input.value);
    input.value = '';
    input.focus();
  });
  document.getElementById('inNomeParticipante')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnAddParticipante').click();
  });
  document.getElementById('btnGerarGrupos')?.addEventListener('click', iniciarFaseDeGrupos);
  app.querySelectorAll('[data-acao="remover-participante"]').forEach((b) =>
    b.addEventListener('click', () => removerParticipante(b.dataset.id))
  );
}

function tabelaClassificacaoHtml(grupo) {
  return `
    <table class="classificacao">
      <thead>
        <tr><th>#</th><th>Time</th><th>PJ</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr>
      </thead>
      <tbody>
        ${grupo.classificacao.map((t, i) => `
          <tr class="${i < 2 ? 'classifica' : ''}">
            <td>${i + 1}</td><td>${esc(t.time)}</td><td>${t.pj}</td><td>${t.v}</td><td>${t.e}</td><td>${t.d}</td>
            <td>${t.gp}</td><td>${t.gc}</td><td>${t.sg > 0 ? '+' : ''}${t.sg}</td><td>${t.pts}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function partidaGrupoHtml(grupoIdx, partida) {
  const jogada = partida.golsCasa != null && partida.golsFora != null;
  return `
    <div class="partida">
      <span class="data-partida">
        📅 <input type="datetime-local" class="in-data-grupo" data-grupo="${grupoIdx}" data-partida="${partida.id}" value="${paraInputData(partida.data)}">
      </span>
      <span class="time">${esc(partida.casa)}</span>
      <span class="placar">
        <input type="number" min="0" class="in-gol-casa" data-partida="${partida.id}" value="${partida.golsCasa ?? ''}">
        <span>x</span>
        <input type="number" min="0" class="in-gol-fora" data-partida="${partida.id}" value="${partida.golsFora ?? ''}">
      </span>
      <span class="time direita">${esc(partida.fora)}</span>
      <button class="btn btn-pequeno btn-secundario" data-acao="salvar-grupo" data-grupo="${grupoIdx}" data-partida="${partida.id}">Salvar</button>
      ${jogada ? '<span class="status-ok">✓ Registrado</span>' : ''}
    </div>
  `;
}

function renderGrupos() {
  if (!estado.faseGruposGerada) {
    app.innerHTML = '<div class="card"><div class="vazio">A fase de grupos ainda não foi gerada. Vá em "Participantes" para adicionar jogadores e gerar os grupos.</div></div>';
    return;
  }

  app.innerHTML = estado.grupos.map((grupo, gi) => `
    <div class="card">
      <h3>${grupo.nome} ${grupo.completo ? '<span class="selo">Concluído</span>' : ''}</h3>
      ${tabelaClassificacaoHtml(grupo)}
      <div style="margin-top:14px;">
        ${grupo.partidas.map((p) => partidaGrupoHtml(gi, p)).join('')}
      </div>
    </div>
  `).join('') + (estado.mataMata ? '<div class="aviso">Fase de grupos concluída — confira a fase eliminatória na aba Mata-Mata.</div>' : '');

  app.querySelectorAll('[data-acao="salvar-grupo"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gi = Number(btn.dataset.grupo);
      const pid = btn.dataset.partida;
      const casaEl = app.querySelector(`.in-gol-casa[data-partida="${pid}"]`);
      const foraEl = app.querySelector(`.in-gol-fora[data-partida="${pid}"]`);
      const gc = casaEl.value === '' ? null : Math.max(0, parseInt(casaEl.value, 10));
      const gf = foraEl.value === '' ? null : Math.max(0, parseInt(foraEl.value, 10));
      if (gc == null || gf == null || isNaN(gc) || isNaN(gf)) { toast('Informe os dois placares.', 'erro'); return; }
      salvarPlacarGrupo(gi, pid, gc, gf);
    });
  });
}

function nomeRodada(qtdPartidas) {
  if (qtdPartidas === 1) return 'Final';
  if (qtdPartidas === 2) return 'Semifinal';
  if (qtdPartidas === 4) return 'Quartas de Final';
  if (qtdPartidas === 8) return 'Oitavas de Final';
  return `Rodada de ${qtdPartidas * 2}`;
}

function confrontoMMHtml(rodadaIdx, partidaIdx, partida) {
  const decidido = !!partida.vencedor;
  const aguardandoTime = !partida.casa || !partida.fora;
  const aguardandoPenalti = pendentePenalti && pendentePenalti.rodadaIdx === rodadaIdx && pendentePenalti.partidaIdx === partidaIdx;

  const dataHtml = `
    <div class="data-partida">
      📅 <input type="datetime-local" class="in-data-mm" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}" value="${paraInputData(partida.data)}">
    </div>
  `;

  if (aguardandoTime) {
    return `
      <div class="confronto">
        ${dataHtml}
        <div class="time-linha"><span class="nome">${partida.casa ? esc(partida.casa) : 'A definir'}</span></div>
        <div class="time-linha"><span class="nome">${partida.fora ? esc(partida.fora) : 'A definir'}</span></div>
        <div class="aguardando">Aguardando rodada anterior</div>
      </div>
    `;
  }

  if (decidido) {
    return `
      <div class="confronto">
        ${dataHtml}
        <div class="time-linha ${partida.vencedor === partida.casa ? 'vencedor' : ''}">
          <span class="nome">${esc(partida.casa)}</span><span>${partida.golsCasa}</span>
        </div>
        <div class="time-linha ${partida.vencedor === partida.fora ? 'vencedor' : ''}">
          <span class="nome">${esc(partida.fora)}</span><span>${partida.golsFora}</span>
        </div>
        ${partida.penaltis ? `<div class="pen-tag">Decidido nos pênaltis · vencedor: ${esc(partida.vencedor)}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="confronto">
      ${dataHtml}
      <div class="time-linha">
        <span class="nome">${esc(partida.casa)}</span>
        <input type="number" min="0" class="in-mm-casa" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}" value="${partida.golsCasa ?? ''}">
      </div>
      <div class="time-linha">
        <span class="nome">${esc(partida.fora)}</span>
        <input type="number" min="0" class="in-mm-fora" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}" value="${partida.golsFora ?? ''}">
      </div>
      <button class="btn btn-pequeno btn-secundario" style="margin-top:8px;" data-acao="salvar-mm" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}">Salvar</button>
      ${aguardandoPenalti ? `
        <div class="pill-pen">
          <span style="font-size:.8rem;color:#7a5c00;width:100%;">Empate! Quem venceu nos pênaltis?</span>
          <button data-acao="pen" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}" data-vencedor="${esc(partida.casa)}">${esc(partida.casa)}</button>
          <button data-acao="pen" data-rodada="${rodadaIdx}" data-idx="${partidaIdx}" data-vencedor="${esc(partida.fora)}">${esc(partida.fora)}</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderMataMata() {
  if (!estado.mataMata) {
    app.innerHTML = '<div class="card"><div class="vazio">O mata-mata será gerado automaticamente assim que todos os jogos da fase de grupos forem registrados.</div></div>';
    return;
  }

  app.innerHTML = `
    <div class="card" style="overflow:visible;">
      <h2>Fase Eliminatória</h2>
      <div class="bracket">
        ${estado.mataMata.rounds.map((rodada, ri) => `
          <div class="rodada-col">
            <h4>${nomeRodada(rodada.length)}</h4>
            ${rodada.map((p, pi) => confrontoMMHtml(ri, pi, p)).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  app.querySelectorAll('[data-acao="salvar-mm"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ri = Number(btn.dataset.rodada), pi = Number(btn.dataset.idx);
      const casaEl = app.querySelector(`.in-mm-casa[data-rodada="${ri}"][data-idx="${pi}"]`);
      const foraEl = app.querySelector(`.in-mm-fora[data-rodada="${ri}"][data-idx="${pi}"]`);
      const gc = casaEl.value === '' ? null : Math.max(0, parseInt(casaEl.value, 10));
      const gf = foraEl.value === '' ? null : Math.max(0, parseInt(foraEl.value, 10));
      if (gc == null || gf == null || isNaN(gc) || isNaN(gf)) { toast('Informe os dois placares.', 'erro'); return; }
      salvarPlacarMM(ri, pi, gc, gf, null);
    });
  });
  app.querySelectorAll('[data-acao="pen"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ri = Number(btn.dataset.rodada), pi = Number(btn.dataset.idx);
      const partida = estado.mataMata.rounds[ri][pi];
      salvarPlacarMM(ri, pi, partida.golsCasa, partida.golsFora, btn.dataset.vencedor);
    });
  });
}

function renderCampeao() {
  if (!estado.campeao) {
    app.innerHTML = '<div class="card"><div class="vazio">O campeão será revelado aqui automaticamente ao final da fase eliminatória.</div></div>';
    return;
  }
  const confetesEmoji = ['🎉', '⚽', '🎊', '🏅', '✨'];
  const confetes = Array.from({ length: 18 }, (_, i) => {
    const esquerda = Math.round(Math.random() * 96);
    const atraso = (Math.random() * 3).toFixed(2);
    const emoji = confetesEmoji[i % confetesEmoji.length];
    return `<span class="confete" style="left:${esquerda}%; animation-delay:${atraso}s;">${emoji}</span>`;
  }).join('');

  app.innerHTML = `
    <div class="pagina-campeao">
      ${confetes}
      <div class="taca">🏆</div>
      <h2>Campeão do torneio</h2>
      <div class="nome-campeao">${esc(estado.campeao)}</div>
      <div class="subtitulo">EA Sports FC 26 — PS5</div>
    </div>
  `;
}

/* ============================ INICIALIZAÇÃO ============================ */

document.getElementById('abas').addEventListener('click', (e) => {
  const btn = e.target.closest('.aba-btn');
  if (btn) mudarAba(btn.dataset.aba);
});
document.getElementById('btnReiniciar').addEventListener('click', reiniciarTorneio);

app.addEventListener('change', (e) => {
  if (e.target.matches('.in-data-grupo')) {
    salvarDataGrupo(Number(e.target.dataset.grupo), e.target.dataset.partida, e.target.value || null);
  } else if (e.target.matches('.in-data-mm')) {
    salvarDataMM(Number(e.target.dataset.rodada), Number(e.target.dataset.idx), e.target.value || null);
  }
});

carregarDoServidor({ inicial: true });

// Mantém a página sincronizada entre todos os participantes que a acessam ao mesmo tempo.
intervaloAtualizacao = setInterval(() => carregarDoServidor(), 5000);
