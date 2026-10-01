const socket = io();

let currentRoomId = null;
let myPlayerId = null;
let isHost = false;
let selectedDiscardCardUid = null;
let audioCtx = null;
let musicInterval = null;
let isMusicOn = false;

// SINTETIZADOR DE MÚSICA MEDIEVAL (SEM ARQUIVOS EXTERNOS)
function toggleTavernMusic() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  isMusicOn = !isMusicOn;
  document.getElementById('music-status').innerText = isMusicOn ? 'Ligada 🔊' : 'Desligada 🔇';

  if (isMusicOn) {
    playMedievalChords();
  } else {
    clearInterval(musicInterval);
  }
}

function playMedievalChords() {
  const notes = [220, 261.63, 329.63, 392, 440, 523.25]; // Escala mística em Lá Menor
  musicInterval = setInterval(() => {
    if (!isMusicOn || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const note = notes[Math.floor(Math.random() * notes.length)];

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(note, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 2.4);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 2.5);
  }, 1200);
}

// INGRESSO E SALAS
function createRoomSolo() {
  const name = document.getElementById('auth-name').value.trim();
  const contact = document.getElementById('auth-contact').value.trim();
  const diff = document.getElementById('solo-diff').value;
  const roomId = 'SOLO_' + Math.floor(1000 + Math.random() * 9000);

  socket.emit('createRoom', { roomId, password: '', playerName: name, contact, isSolo: true, aiDifficulty: diff });
}

function createMultiRoom() {
  const name = document.getElementById('auth-name').value.trim();
  const contact = document.getElementById('auth-contact').value.trim();
  const room = document.getElementById('room-code').value.trim() || 'ARCO_' + Math.floor(1000 + Math.random() * 9000);
  const pass = document.getElementById('room-pass').value.trim();

  socket.emit('createRoom', { roomId: room, password: pass, playerName: name, contact, isSolo: false });
}

function joinMultiRoom() {
  const name = document.getElementById('auth-name').value.trim();
  const contact = document.getElementById('auth-contact').value.trim();
  const room = document.getElementById('room-code').value.trim();
  const pass = document.getElementById('room-pass').value.trim();

  if (!room) return alert('Digite o código da sala!');
  socket.emit('joinRoom', { roomId: room, password: pass, playerName: name, contact });
}

// ATUALIZAÇÃO DO JOGO
socket.on('gameState', (data) => {
  document.getElementById('modal-auth').classList.add('hidden');
  document.getElementById('game-arena').classList.remove('hidden');

  currentRoomId = data.roomId;
  myPlayerId = socket.id;
  isHost = data.isHost;

  document.getElementById('lbl-room-id').innerText = data.roomId;
  document.getElementById('lbl-pot').innerText = data.pot;
  document.getElementById('lbl-turn-player').innerText = data.turnPlayerName || '---';

  if (isHost && data.phase === 'LOBBY') {
    document.getElementById('host-controls').classList.remove('hidden');
  } else {
    document.getElementById('host-controls').classList.add('hidden');
  }

  // Mostra ou esconde o Leque de Compra
  const fanContainer = document.getElementById('deck-fan-container');
  if (data.phase === 'DRAW_OR_DISCARD' && data.turnPlayerId === myPlayerId) {
    fanContainer.classList.remove('hidden');
    renderCenterFan(data.deckCount);
  } else {
    fanContainer.classList.add('hidden');
  }

  renderSeats(data.players, data.turnPlayerId);
  renderLocalPlayer(data.players.find(p => p.id === myPlayerId), data);

  if (data.toast) showToast(data.toast);
});

// ANIMAÇÃO DE EMBARALHAMENTO
socket.on('deckShuffling', ({ duration }) => {
  const box = document.getElementById('shuffle-animation');
  box.classList.remove('hidden');
  setTimeout(() => box.classList.add('hidden'), duration);
});

// RENDERIZAÇÃO DOS ASSENTOS (6 JOGADORES)
function renderSeats(players, activeTurnId) {
  for (let i = 0; i < 6; i++) {
    const seatEl = document.getElementById(`seat-${i}`);
    seatEl.innerHTML = '';
    seatEl.classList.remove('seat-active');

    const p = players[i];
    if (p) {
      if (p.id === activeTurnId) seatEl.classList.add('seat-active');
      seatEl.innerHTML = `
        <div style="font-weight:bold; color:#d4af37;">${p.name}</div>
        <div>🪙 ${p.chips} | Aposta: ${p.currentBet}</div>
        <div>Cartas: ${p.cardCount} ${p.folded ? '<span style="color:#e63946;">(Correu)</span>' : ''}</div>
      `;
    } else {
      seatEl.innerHTML = `<span style="color:#555;">[Assento Vazio]</span>`;
    }
  }
}

// RENDERIZAÇÃO DO JOGADOR LOCAL
function renderLocalPlayer(me, roomData) {
  if (!me) return;
  document.getElementById('my-chips-val').innerText = me.chips;

  // Arconte
  const arcBox = document.getElementById('my-arconte-box');
  if (me.arconte) {
    arcBox.innerHTML = `
      <div class="arconte-card">
        <div class="arconte-name">${me.arconte.name} (${me.arconte.rank})</div>
        <div style="font-size:0.65rem; color:#aaa;">${me.arconte.element}</div>
        <hr style="border-color:#444; margin:4px 0;">
        <div style="color:#d4af37; font-weight:bold;">VALOR: 7 pts</div>
      </div>
    `;
  }

  // Mão de Fluxo
  const handBox = document.getElementById('my-hand-cards');
  handBox.innerHTML = '';
  (me.hand || []).forEach(c => {
    const cardEl = document.createElement('div');
    cardEl.className = `fluxo-card suit-${c.color}`;
    if (selectedDiscardCardUid === c.uid) cardEl.classList.add('card-selected');

    cardEl.innerHTML = `
      <div>${c.label}</div>
      <div style="font-size:1.5rem; text-align:center;">${c.symbol}</div>
      <div style="text-align:right;">${c.label}</div>
    `;

    cardEl.onclick = () => selectCardToDiscard(c.uid);
    handBox.appendChild(cardEl);
  });

  const myScore = me.score !== '??' ? me.score : 7;
  document.getElementById('my-total-score').innerText = myScore;

  // Habilita descarte de alívio se > 21
  const btnDiscard = document.getElementById('btn-discard');
  if (myScore > 21 && !me.hasDiscarded && me.hand.length > 2) {
    btnDiscard.classList.remove('hidden');
  } else {
    btnDiscard.classList.add('hidden');
  }

  // Controle de turno dos botões
  const isMyTurn = roomData.turnPlayerId === myPlayerId;
  document.getElementById('btn-call').disabled = !isMyTurn || roomData.phase !== 'BETTING_ROUND';
  document.getElementById('btn-raise').disabled = !isMyTurn || roomData.phase !== 'BETTING_ROUND';
  document.getElementById('btn-stand').disabled = !isMyTurn || roomData.phase !== 'DRAW_OR_DISCARD';
  document.getElementById('btn-fold').disabled = !isMyTurn || roomData.phase !== 'BETTING_ROUND';
}

// RENDERIZA O LEQUE NO CENTRO
function renderCenterFan(count) {
  const fanEl = document.getElementById('fan-card-list');
  fanEl.innerHTML = '';
  const numToDisplay = Math.min(count, 12);

  for (let i = 0; i < numToDisplay; i++) {
    const card = document.createElement('div');
    card.className = 'fan-card-item';
    card.innerHTML = '🂠';
    card.title = 'Clique para escolher esta carta de Fluxo';
    card.onclick = () => {
      socket.emit('drawCardFromFan', { fanCardIndex: i });
      document.getElementById('deck-fan-container').classList.add('hidden');
    };
    fanEl.appendChild(card);
  }
}

function selectCardToDiscard(uid) {
  selectedDiscardCardUid = (selectedDiscardCardUid === uid) ? null : uid;
  const cards = document.querySelectorAll('.fluxo-card');
  cards.forEach(el => el.classList.remove('card-selected'));
  if (selectedDiscardCardUid) {
    showToast('Carta selecionada! Clique no botão vermelho "Descartar de Alívio" para confirmar.');
  }
}

function confirmDiscardSelected() {
  if (!selectedDiscardCardUid) return alert('Selecione uma carta na sua mão primeiro!');
  socket.emit('discardCard', { cardUid: selectedDiscardCardUid });
  selectedDiscardCardUid = null;
}

function sendBetAction(action, amount) {
  socket.emit('playerBetAction', { action, amount });
}

function sendStand() {
  socket.emit('standTurn');
}

function startHostGame() {
  socket.emit('startGame');
}

// SHOWDOWN (REVELAÇÃO FINAL)
socket.on('showdownResult', (res) => {
  const modal = document.getElementById('modal-showdown');
  modal.classList.remove('hidden');

  document.getElementById('showdown-reason').innerText = res.winReason;
  document.getElementById('showdown-pot-val').innerText = res.potWon;

  const listEl = document.getElementById('showdown-players-list');
  listEl.innerHTML = '';

  res.allPlayers.forEach(p => {
    const isWin = p.id === res.winnerId;
    const card = document.createElement('div');
    card.className = `showdown-player-card ${isWin ? 'card-winner-glow' : ''}`;

    let handStr = p.hand.map(c => `[${c.label}${c.symbol}]`).join(' ');
    card.innerHTML = `
      <h4 style="color:${isWin ? '#d4af37' : '#fff'};">${p.name} ${isWin ? '👑 (VENCEU)' : ''}</h4>
      <div style="font-size:0.8rem; margin:4px 0;">Arconte: ${p.arconte ? p.arconte.name : '-'}</div>
      <div style="font-size:0.85rem; color:#aaa;">Cartas: ${handStr}</div>
      <div style="margin-top:6px; font-weight:bold;">Total: ${p.finalScore} pts | ${p.pokerDesc}</div>
    `;
    listEl.appendChild(card);
  });

  if (isHost) {
    const nextBtn = document.getElementById('btn-next-round');
    nextBtn.classList.remove('hidden');
  }
});

function requestNextRound() {
  document.getElementById('modal-showdown').classList.add('hidden');
  socket.emit('nextRoundReady');
}

function copyInviteLink() {
  navigator.clipboard.writeText(window.location.href);
  showToast('Link da mesa copiado! Envie para seus amigos.');
}

function showToast(msg) {
  const t = document.getElementById('toast-banner');
  t.innerText = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

socket.on('errorMsg', (msg) => alert(msg));
