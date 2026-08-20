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
let editandoParticipanteId = null;
let jaSorteado = false;
let notasAbertas = new Set();
let mostrarFormSenha = false;
let carrosselIndice = 0;
let carrosselTickAcumulado = 0;
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

function pedirSenhaSeNecessario(precisa) {
  if (!precisa || !estado.temSenha) return { ok: true, senha: null };
  const senha = prompt('Essa ação exige a senha do torneio:');
  if (senha === null) return { ok: false, senha: null };
  return { ok: true, senha };
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

function lerArquivoComoDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

// Redimensiona e comprime a imagem no navegador antes de enviar — fotos tiradas
// direto do celular costumam vir com vários MB, e isso garante um arquivo pequeno
// sem depender do tamanho original. O fundo branco também combina com a moldura
// do carrossel/lista de patrocinadores.
function comprimirImagem(arquivo, larguraMax = 640, alturaMax = 320, qualidade = 0.85) {
  return new Promise((resolve, reject) => {
    lerArquivoComoDataUrl(arquivo).then((dataUrl) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, larguraMax / img.width, alturaMax / img.height);
        const largura = Math.max(1, Math.round(img.width * escala));
        const altura = Math.max(1, Math.round(img.height * escala));
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, largura, altura);
        ctx.drawImage(img, 0, 0, largura, altura);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => reject(new Error('Não foi possível processar a imagem. Tente outro arquivo.'));
      img.src = dataUrl;
    }).catch(reject);
  });
}

const TAMANHO_MAX_ARQUIVO_ORIGINAL = 15_000_000; // ~15MB antes de comprimir

function comIntervaloMaximo(promessa, ms, mensagemErro) {
  return Promise.race([
    promessa,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensagemErro)), ms))
  ]);
}

async function adicionarPatrocinador(nome, arquivo) {
  const limpo = nome.trim();
  if (!limpo) { toast('Informe o nome do patrocinador.', 'erro'); return; }
  if (!arquivo) { toast('Selecione uma imagem para o patrocinador.', 'erro'); return; }
  if (arquivo.size > TAMANHO_MAX_ARQUIVO_ORIGINAL) { toast('Imagem muito grande — escolha um arquivo menor.', 'erro'); return; }

  let imagem;
  try {
    imagem = await comIntervaloMaximo(comprimirImagem(arquivo), 20000, 'Demorou demais para processar a imagem.');
  } catch {
    // Plano B: se o navegador não conseguiu processar a imagem (formato não suportado,
    // demorou demais etc.), tenta enviar o arquivo original, se não for grande demais.
    if (arquivo.size <= 1_200_000) {
      try {
        imagem = await lerArquivoComoDataUrl(arquivo);
      } catch {
        toast('Não foi possível processar essa imagem. Tente uma captura de tela ou outra foto.', 'erro');
        return;
      }
    } else {
      toast('Não foi possível processar essa imagem neste navegador. Tente uma captura de tela ou outra foto.', 'erro');
      return;
    }
  }

  try {
    const dados = await api('/api/patrocinadores', 'POST', { nome: limpo, imagem });
    await atualizarEstado(dados);
    toast('Patrocinador adicionado!', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function removerPatrocinador(id) {
  try {
    const dados = await api(`/api/patrocinadores/${id}`, 'DELETE');
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function definirCarrosselIntervalo(segundos) {
  try {
    const dados = await api('/api/config-carrossel', 'POST', { segundos });
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function removerParticipante(id) {
  if (!confirm('Remover este participante?')) return;
  const { ok, senha } = pedirSenhaSeNecessario(true);
  if (!ok) return;
  try {
    const dados = await api(`/api/participantes/${id}`, 'DELETE', { senha });
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

function editarParticipante(id) {
  editandoParticipanteId = id;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.in-editar-nome[data-id="${id}"]`)?.focus();
  });
}

function cancelarEdicaoParticipante() {
  editandoParticipanteId = null;
  render();
}

async function salvarEdicaoParticipante(id, novoNome) {
  const limpo = novoNome.trim();
  if (!limpo) { toast('Informe um nome.', 'erro'); return; }
  try {
    const dados = await api(`/api/participantes/${id}`, 'PATCH', { nome: limpo });
    editandoParticipanteId = null;
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function definirNumGrupos(n) {
  try {
    const dados = await api('/api/config', 'POST', { numGrupos: n });
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function sortearGrupos() {
  try {
    const dados = await api('/api/sortear-grupos', 'POST');
    jaSorteado = true;
    await atualizarEstado(dados);
    toast('🎲 Grupos sorteados!', 'ok');
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
  const partidaAtual = estado.grupos[grupoIdx]?.partidas.find((p) => p.id === partidaId);
  const jaTinhaPlacar = !!partidaAtual && (partidaAtual.golsCasa != null || partidaAtual.golsFora != null);
  const { ok, senha } = pedirSenhaSeNecessario(jaTinhaPlacar);
  if (!ok) return;
  try {
    const dados = await api(`/api/grupos/${grupoIdx}/${partidaId}/placar`, 'POST', { golsCasa, golsFora, senha });
    const gerouMataMata = !estado.mataMata && dados.mataMata;
    await atualizarEstado(dados);
    if (gerouMataMata) toast('Fase de grupos concluída! Mata-mata gerado.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarPlacarMM(rodadaIdx, partidaIdx, golsCasa, golsFora, penVencedor) {
  const partidaAtual = estado.mataMata?.rounds[rodadaIdx]?.[partidaIdx];
  const jaDecidida = !!partidaAtual?.vencedor;
  const { ok, senha } = pedirSenhaSeNecessario(jaDecidida);
  if (!ok) return;
  try {
    const dados = await api(`/api/mata-mata/${rodadaIdx}/${partidaIdx}/placar`, 'POST', { golsCasa, golsFora, penVencedor, senha });
    if (dados.aguardandoPenalti) {
      pendentePenalti = { rodadaIdx, partidaIdx };
    } else {
      pendentePenalti = null;
    }
    await atualizarEstado(dados);
    if (dados.finalDefinida && dados.finalistas) {
      toast(`🏁 Final definida: ${dados.finalistas.casa} x ${dados.finalistas.fora}!`, 'ok');
    }
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
  let senha = null;
  if (estado.temSenha) {
    senha = prompt('Este torneio é protegido. Digite a senha para reiniciar:');
    if (senha === null) return; // cancelou
  } else if (!confirm('Isso vai apagar participantes, grupos, placares e o campeão para todo mundo. Deseja mesmo reiniciar?')) {
    return;
  }
  try {
    const dados = await api('/api/reiniciar', 'POST', { senha });
    pendentePenalti = null;
    editandoParticipanteId = null;
    jaSorteado = false;
    mostrarFormSenha = false;
    estado = null;
    abaAtiva = 'participantes';
    document.querySelectorAll('.aba-btn').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === 'participantes'));
    await atualizarEstado(dados);
  } catch (e) { toast(e.message, 'erro'); }
}

async function definirSenhaTorneio(senha) {
  const limpa = senha.trim();
  if (!limpa) { toast('Informe uma senha.', 'erro'); return; }
  try {
    const dados = await api('/api/senha', 'POST', { senha: limpa });
    await atualizarEstado(dados);
    toast('🔒 Senha definida! Guarde bem — só quem souber consegue reiniciar o torneio.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function alterarOuRemoverSenha(senhaAtual, novaSenha) {
  if (!senhaAtual.trim()) { toast('Informe a senha atual.', 'erro'); return; }
  try {
    const dados = await api('/api/senha', 'POST', { senha: novaSenha.trim(), senhaAtual: senhaAtual.trim() });
    mostrarFormSenha = false;
    await atualizarEstado(dados);
    toast(novaSenha.trim() ? 'Senha alterada!' : 'Senha removida — o torneio ficou sem proteção.', 'ok');
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

function alternarNota(chave) {
  if (notasAbertas.has(chave)) notasAbertas.delete(chave); else notasAbertas.add(chave);
  render();
}

function botaoNotaHtml(chave) {
  return `<button type="button" class="btn-nota" data-acao="toggle-nota" data-chave="${chave}" title="Mostrar/ocultar explicação">ℹ️</button>`;
}

function secaoSenhaHtml() {
  if (estado.temSenha) {
    return `
      <div class="linha-form">
        <span class="selo">🔒 Torneio protegido por senha</span>
        <button class="btn btn-secundario btn-pequeno" id="btnToggleSenha">${mostrarFormSenha ? 'Cancelar' : 'Alterar/remover senha'}</button>
      </div>
      ${mostrarFormSenha ? `
        <div class="linha-form">
          <input type="password" id="inSenhaAtual" placeholder="Senha atual" autocomplete="off">
          <input type="password" id="inSenhaNova" placeholder="Nova senha (em branco remove)" autocomplete="off">
          <button class="btn btn-pequeno" id="btnSalvarSenha">Salvar</button>
        </div>
      ` : ''}
    `;
  }
  if (estado.faseGruposGerada) return '';
  return `
    <div class="linha-form">
      <input type="password" id="inNovaSenhaTorneio" placeholder="Senha do torneio (opcional)" maxlength="40" autocomplete="off">
      <button class="btn btn-secundario" id="btnDefinirSenha">Definir senha</button>
    </div>
    <div class="aviso">⚠️ Se a senha for esquecida, não tem como recuperá-la depois — guarde em um lugar seguro assim que definir.</div>
  `;
}

function carrosselHtml(lista) {
  if (lista.length === 0) return '';
  const indiceAtual = carrosselIndice % lista.length;
  const atual = lista[indiceAtual];
  return `
    <div class="carrossel-patrocinadores">
      <div class="carrossel-frame">
        <img id="carrossel-img" src="${atual.imagem}" alt="${esc(atual.nome)}">
      </div>
      <div class="carrossel-legenda" id="carrossel-nome">${esc(atual.nome)}</div>
      ${lista.length > 1 ? `
        <div class="carrossel-dots" id="carrossel-dots">
          ${lista.map((_, i) => `<span class="dot ${i === indiceAtual ? 'ativo' : ''}"></span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function secaoPatrocinadoresHtml() {
  const podeEditar = !estado.faseGruposGerada;
  const lista = estado.patrocinadores || [];
  if (!podeEditar && lista.length === 0) return '';
  return `
    <div class="card">
      <h2>Patrocinadores</h2>
      ${podeEditar ? `
        <p class="texto-explicativo">Moldura de exibição: <strong>320×160px</strong> (proporção 2:1). Pode enviar qualquer foto ou logo — o tamanho é ajustado e comprimido automaticamente.</p>
        <div class="linha-form linha-form-patrocinador">
          <input type="text" id="inNomePatrocinador" placeholder="Nome do patrocinador" maxlength="40">
          <input type="file" id="inImagemPatrocinador" accept="image/*">
          <button class="btn" id="btnAddPatrocinador">Adicionar</button>
        </div>
        <div class="linha-form">
          <label for="inIntervaloCarrossel" class="rotulo-inline">Intervalo do carrossel:</label>
          <input type="number" id="inIntervaloCarrossel" min="1" max="30" value="${estado.carrosselIntervalo}" style="width:70px;">
          <span class="rotulo-inline">segundos</span>
        </div>
        ${lista.length === 0 ? '<div class="vazio">Nenhum patrocinador adicionado.</div>' : `
          <ul class="lista-participantes">
            ${lista.map((s) => `
              <li>
                <span class="item-patrocinador"><img class="miniatura-patrocinador" src="${s.imagem}" alt=""> ${esc(s.nome)}</span>
                <button class="btn-x" data-acao="remover-patrocinador" data-id="${s.id}" title="Remover">✕</button>
              </li>
            `).join('')}
          </ul>
        `}
      ` : ''}
      ${carrosselHtml(lista)}
    </div>
  `;
}

function renderParticipantes() {
  const grupos = estado.gruposPorTime || [];
  const opcoesGrupo = [2, 4, 8].map((n) =>
    `<option value="${n}" ${estado.numGrupos === n ? 'selected' : ''}>${n} grupos (${n * 2} classificados para o mata-mata)</option>`
  ).join('');

  const podeEditarLista = !estado.primeiraPartidaComecou;
  let notaConfigTexto = '';
  if (estado.primeiraPartidaComecou) {
    notaConfigTexto = 'O torneio já começou. Não é mais possível alterar participantes nem a configuração — reinicie o torneio para começar do zero.';
  } else if (estado.faseGruposGerada) {
    notaConfigTexto = 'Fase de grupos já gerada — não dá mais para mudar o número de grupos. Você ainda pode editar ou remover participantes até a primeira partida ser jogada; um novo só pode ser adicionado se algum grupo estiver com menos jogadores que os outros (vaga aberta por uma remoção).';
  }

  app.innerHTML = `
    <div class="card">
      <h2>1. Configuração ${notaConfigTexto ? botaoNotaHtml('config') : ''}</h2>
      ${notaConfigTexto && notasAbertas.has('config') ? `<div class="aviso">${notaConfigTexto}</div>` : ''}
      <div class="linha-form">
        <select id="selNumGrupos" ${estado.faseGruposGerada ? 'disabled' : ''}>${opcoesGrupo}</select>
      </div>
      ${secaoSenhaHtml()}
    </div>

    ${secaoPatrocinadoresHtml()}

    <div class="card">
      <h2>2. Participantes <span class="selo">${estado.participantes.length} adicionados</span></h2>
      ${podeEditarLista ? `
        <div class="linha-form">
          <input type="text" id="inNomeParticipante" placeholder="Nome do jogador (será o nome do time)" maxlength="30">
          <button class="btn" id="btnAddParticipante">Adicionar</button>
        </div>
      ` : ''}
      ${estado.participantes.length === 0 ? '<div class="vazio">Nenhum participante ainda. Adicione os jogadores acima.</div>' : `
        <ul class="lista-participantes">
          ${estado.participantes.map((p) => {
            if (editandoParticipanteId === p.id) {
              return `
                <li>
                  <span class="linha-edicao">
                    <input type="text" class="in-editar-nome" data-id="${p.id}" value="${esc(p.nome)}" maxlength="30">
                    <button class="btn btn-pequeno" data-acao="salvar-edicao" data-id="${p.id}">Salvar</button>
                    <button class="btn btn-pequeno btn-secundario" data-acao="cancelar-edicao">Cancelar</button>
                  </span>
                </li>
              `;
            }
            return `
              <li>
                <span>${esc(p.nome)} ${p.grupoNome ? `<span class="tag-grupo">Grupo ${p.grupoNome}</span>` : ''}</span>
                ${podeEditarLista ? `
                  <span class="acoes-participante">
                    <button class="btn-icone" data-acao="editar-participante" data-id="${p.id}" title="Editar nome">✎</button>
                    <button class="btn-x" data-acao="remover-participante" data-id="${p.id}" title="Remover">✕</button>
                  </span>
                ` : ''}
              </li>
            `;
          }).join('')}
        </ul>
      `}
    </div>

    ${!estado.faseGruposGerada ? `
      <div class="card">
        <h2>3. Sorteio dos Grupos ${botaoNotaHtml('sorteio')}</h2>
        ${notasAbertas.has('sorteio') ? '<p class="texto-explicativo">Os grupos abaixo são montados por sorteio aleatório — sem escolha manual — pra garantir que ninguém possa favorecer um lado. Pode sortear de novo quantas vezes quiser antes de gerar a fase de grupos.</p>' : ''}
        <button class="btn btn-ouro" id="btnSortear" ${estado.participantes.length < 2 ? 'disabled' : ''}>🎲 ${jaSorteado ? 'Sortear novamente' : 'Sortear grupos'}</button>
      </div>
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

  document.getElementById('btnSortear')?.addEventListener('click', sortearGrupos);
  document.getElementById('selNumGrupos')?.addEventListener('change', (e) => definirNumGrupos(Number(e.target.value)));
  document.getElementById('btnDefinirSenha')?.addEventListener('click', () => {
    const input = document.getElementById('inNovaSenhaTorneio');
    definirSenhaTorneio(input.value);
  });
  document.getElementById('btnToggleSenha')?.addEventListener('click', () => {
    mostrarFormSenha = !mostrarFormSenha;
    render();
  });
  document.getElementById('btnSalvarSenha')?.addEventListener('click', () => {
    const senhaAtual = document.getElementById('inSenhaAtual').value;
    const senhaNova = document.getElementById('inSenhaNova').value;
    alterarOuRemoverSenha(senhaAtual, senhaNova);
  });
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
  app.querySelectorAll('[data-acao="editar-participante"]').forEach((b) =>
    b.addEventListener('click', () => editarParticipante(b.dataset.id))
  );
  app.querySelectorAll('[data-acao="cancelar-edicao"]').forEach((b) =>
    b.addEventListener('click', cancelarEdicaoParticipante)
  );
  app.querySelectorAll('[data-acao="salvar-edicao"]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = app.querySelector(`.in-editar-nome[data-id="${b.dataset.id}"]`);
      salvarEdicaoParticipante(b.dataset.id, input.value);
    })
  );
  app.querySelector('.in-editar-nome')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.target.closest('.linha-edicao').querySelector('[data-acao="salvar-edicao"]').click(); }
    if (e.key === 'Escape') cancelarEdicaoParticipante();
  });
  app.querySelectorAll('[data-acao="toggle-nota"]').forEach((b) =>
    b.addEventListener('click', () => alternarNota(b.dataset.chave))
  );
  document.getElementById('btnAddPatrocinador')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const inputNome = document.getElementById('inNomePatrocinador');
    const inputImagem = document.getElementById('inImagemPatrocinador');
    const arquivo = inputImagem.files[0];
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = arquivo ? 'Processando imagem…' : 'Adicionar';
    try {
      await adicionarPatrocinador(inputNome.value, arquivo);
      inputNome.value = '';
      inputImagem.value = '';
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
  document.getElementById('inNomePatrocinador')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnAddPatrocinador').click();
  });
  document.getElementById('inIntervaloCarrossel')?.addEventListener('change', (e) => {
    definirCarrosselIntervalo(Number(e.target.value));
  });
  app.querySelectorAll('[data-acao="remover-patrocinador"]').forEach((b) =>
    b.addEventListener('click', () => removerPatrocinador(b.dataset.id))
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

function corpoPartidasGrupo(grupo, gi) {
  const temRodadas = grupo.partidas.some((p) => p.rodada != null);
  if (!temRodadas) {
    return grupo.partidas.map((p) => partidaGrupoHtml(gi, p)).join('');
  }
  const porRodada = {};
  grupo.partidas.forEach((p) => {
    const r = p.rodada ?? 0;
    (porRodada[r] = porRodada[r] || []).push(p);
  });
  return Object.keys(porRodada).map(Number).sort((a, b) => a - b).map((r) => `
    <h4 class="titulo-rodada">${r}ª RODADA</h4>
    ${porRodada[r].map((p) => partidaGrupoHtml(gi, p)).join('')}
  `).join('');
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
        ${corpoPartidasGrupo(grupo, gi)}
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

function confrontoPreviaHtml(par) {
  const casaTxt = par.casa.nome || 'A definir';
  const foraTxt = par.fora.nome || 'A definir';
  return `
    <div class="confronto confronto-previa">
      <div class="time-linha ${par.casa.definido ? '' : 'provisorio'}"><span class="nome">${esc(casaTxt)}</span></div>
      <div class="time-linha ${par.fora.definido ? '' : 'provisorio'}"><span class="nome">${esc(foraTxt)}</span></div>
    </div>
  `;
}

function renderMataMata() {
  if (!estado.mataMata) {
    if (!estado.previaChaveamento) {
      app.innerHTML = '<div class="card"><div class="vazio">O chaveamento aparece aqui assim que a fase de grupos for gerada.</div></div>';
      return;
    }
    app.innerHTML = `
      <div class="card" style="overflow:visible;">
        <h2>Fase Eliminatória (prévia)</h2>
        <div class="bracket">
          ${estado.previaChaveamento.map((rodada) => `
            <div class="rodada-col">
              <h4>${nomeRodada(rodada.length)}</h4>
              ${rodada.map((p) => confrontoPreviaHtml(p)).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return;
  }

  const bannerFinal = estado.finalistas ? `
    <div class="banner-final">
      🏁 <strong>Grande Final definida!</strong><br>
      ${esc(estado.finalistas.casa)} <span class="vs">×</span> ${esc(estado.finalistas.fora)}
    </div>
  ` : '';

  app.innerHTML = `
    ${bannerFinal}
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

function patrocinadoresListaHtml() {
  const lista = estado.patrocinadores || [];
  if (lista.length === 0) return '';
  return `
    <div class="secao-patrocinadores-campeao">
      <h3 class="titulo-patrocinadores">PATROCINADORES</h3>
      <div class="lista-patrocinadores-estatica">
        ${lista.map((s) => `
          <div class="patrocinador-estatico">
            <img src="${s.imagem}" alt="${esc(s.nome)}">
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCampeao() {
  if (!estado.campeao) {
    app.innerHTML = `
      <div class="card"><div class="vazio">O campeão será revelado aqui automaticamente ao final da fase eliminatória.</div></div>
      ${patrocinadoresListaHtml()}
      <div class="rodape">
        <button id="btnReiniciar" class="btn btn-perigo btn-pequeno">Reiniciar torneio</button>
      </div>
    `;
    document.getElementById('btnReiniciar').addEventListener('click', reiniciarTorneio);
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
    ${patrocinadoresListaHtml()}
    <div class="rodape">
      <button id="btnReiniciar" class="btn btn-perigo btn-pequeno">Reiniciar torneio</button>
    </div>
  `;
  document.getElementById('btnReiniciar').addEventListener('click', reiniciarTorneio);
}

/* ============================ INICIALIZAÇÃO ============================ */

document.getElementById('abas').addEventListener('click', (e) => {
  const btn = e.target.closest('.aba-btn');
  if (btn) mudarAba(btn.dataset.aba);
});
app.addEventListener('change', (e) => {
  if (e.target.matches('.in-data-grupo')) {
    salvarDataGrupo(Number(e.target.dataset.grupo), e.target.dataset.partida, e.target.value || null);
  } else if (e.target.matches('.in-data-mm')) {
    salvarDataMM(Number(e.target.dataset.rodada), Number(e.target.dataset.idx), e.target.value || null);
  }
});

function haRascunhoNaoSalvo() {
  // Cobre o caso em que o foco sai do campo sem o usuário ter terminado — por exemplo,
  // enquanto o seletor de foto nativo do celular está aberto — o que faria a atualização
  // automática apagar o que já tinha sido preenchido.
  if (editandoParticipanteId != null) return true;
  if (document.getElementById('inNomePatrocinador')?.value.trim()) return true;
  if (document.getElementById('inImagemPatrocinador')?.files?.length) return true;
  if (document.getElementById('inNovaSenhaTorneio')?.value) return true;
  if (document.getElementById('inSenhaAtual')?.value || document.getElementById('inSenhaNova')?.value) return true;
  return false;
}

function usuarioDigitando() {
  const el = document.activeElement;
  if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return true;
  return haRascunhoNaoSalvo();
}

carregarDoServidor({ inicial: true });

// Mantém a página sincronizada entre todos os participantes que a acessam ao mesmo tempo.
// Pula a atualização enquanto alguém estiver digitando, para não perder o foco do campo (e o teclado, no celular).
intervaloAtualizacao = setInterval(() => {
  if (usuarioDigitando()) return;
  carregarDoServidor();
}, 5000);

// Avança o carrossel de patrocinadores sozinho, mexendo só na imagem (sem re-renderizar
// a página inteira, pra não interromper quem estiver digitando em outro campo).
setInterval(() => {
  const img = document.getElementById('carrossel-img');
  if (!img || !estado) return;
  const lista = estado.patrocinadores || [];
  if (lista.length < 2) return;
  const intervalo = estado.carrosselIntervalo || 4;
  carrosselTickAcumulado++;
  if (carrosselTickAcumulado < intervalo) return;
  carrosselTickAcumulado = 0;
  carrosselIndice = (carrosselIndice + 1) % lista.length;
  const atual = lista[carrosselIndice];
  img.src = atual.imagem;
  img.alt = atual.nome;
  const legenda = document.getElementById('carrossel-nome');
  if (legenda) legenda.textContent = atual.nome;
  const dots = document.getElementById('carrossel-dots');
  if (dots) {
    dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('ativo', i === carrosselIndice));
  }
}, 1000);
