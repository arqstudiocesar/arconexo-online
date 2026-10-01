const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// 12 Arcontes Oficiais
const ARCONTE_DECK = [
  { id: 'arc_1', name: 'Kaion', rank: 'K', suit: 'diamonds', element: 'Terra/Metal' },
  { id: 'arc_2', name: 'Aurelius', rank: 'Q', suit: 'diamonds', element: 'Luz/Ouro' },
  { id: 'arc_3', name: 'Doran', rank: 'J', suit: 'diamonds', element: 'Cristal' },
  { id: 'arc_4', name: 'Ignis', rank: 'K', suit: 'hearts', element: 'Fogo Primordial' },
  { id: 'arc_5', name: 'Pyra', rank: 'Q', suit: 'hearts', element: 'Chama Eterna' },
  { id: 'arc_6', name: 'Vulcan', rank: 'J', suit: 'hearts', element: 'Magma' },
  { id: 'arc_7', name: 'Zephyr', rank: 'K', suit: 'spades', element: 'Tempestade' },
  { id: 'arc_8', name: 'Aria', rank: 'Q', suit: 'spades', element: 'Ventos Etéreos' },
  { id: 'arc_9', name: 'Gale', rank: 'J', suit: 'spades', element: 'Trovão' },
  { id: 'arc_10', name: 'Nautilus', rank: 'K', suit: 'clubs', element: 'Abismo Marinho' },
  { id: 'arc_11', name: 'Marina', rank: 'Q', suit: 'clubs', element: 'Maré Lunar' },
  { id: 'arc_12', name: 'Torrent', rank: 'J', suit: 'clubs', element: 'Geleira' }
];

const SUITS = [
  { name: 'clubs', symbol: '♣', color: 'green' },
  { name: 'diamonds', symbol: '♦', color: 'orange' },
  { name: 'hearts', symbol: '♥', color: 'red' },
  { name: 'spades', symbol: '♠', color: 'purple' }
];

function generateFluxoDeck() {
  const deck = [];
  let uid = 1;
  for (const s of SUITS) {
    for (let val = 1; val <= 10; val++) {
      deck.push({
        uid: `card_${uid++}`,
        val: val,
        suit: s.name,
        symbol: s.symbol,
        color: s.color,
        label: val === 1 ? 'A' : String(val)
      });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function calculateHandValue(arconte, fluxoCards) {
  let total = 7; // Arconte vale 7 fixo
  let aces = 0;
  for (const c of fluxoCards) {
    if (c.val === 1) {
      aces++;
      total += 11;
    } else {
      total += c.val;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function evaluatePokerHand(fluxoCards) {
  if (fluxoCards.length < 2) return { rank: 0, desc: 'Carta Alta' };
  const counts = {};
  const suitCounts = {};
  fluxoCards.forEach(c => {
    counts[c.val] = (counts[c.val] || 0) + 1;
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  });
  const vals = Object.values(counts);
  const isFlush = Object.values(suitCounts).some(cnt => cnt >= 4);

  if (vals.includes(4)) return { rank: 7, desc: 'Quadra Arcana' };
  if (vals.includes(3) && vals.includes(2)) return { rank: 6, desc: 'Full House Elemental' };
  if (isFlush) return { rank: 5, desc: 'Flush Elemental' };
  if (vals.includes(3)) return { rank: 3, desc: 'Trinca Elemental' };
  if (vals.filter(v => v === 2).length >= 2) return { rank: 2, desc: 'Dois Pares' };
  if (vals.includes(2)) return { rank: 1, desc: 'Par Elemental' };
  return { rank: 0, desc: 'Carta Mais Alta' };
}

const rooms = {};

io.on('connection', (socket) => {
  socket.on('createRoom', ({ roomId, password, playerName, contact, isSolo, aiDifficulty }) => {
    if (rooms[roomId]) return socket.emit('errorMsg', 'Essa sala já existe!');
    rooms[roomId] = {
      id: roomId,
      password: password || '',
      isSolo: !!isSolo,
      aiDifficulty: aiDifficulty || 'medium',
      host: socket.id,
      phase: 'LOBBY',
      deck: [],
      pot: 0,
      currentBet: 10,
      turnIndex: 0,
      roundNumber: 1,
      players: []
    };
    joinPlayer(socket, roomId, playerName, contact);
  });

  socket.on('joinRoom', ({ roomId, password, playerName, contact }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'Sala não encontrada!');
    if (room.password && room.password !== password) return socket.emit('errorMsg', 'Senha incorreta!');
    if (room.players.length >= 6) return socket.emit('errorMsg', 'A mesa está cheia (máx 6)!');
    if (room.phase !== 'LOBBY') return socket.emit('errorMsg', 'Partida em andamento!');
    joinPlayer(socket, roomId, playerName, contact);
  });

  function joinPlayer(socket, roomId, playerName, contact) {
    const room = rooms[roomId];
    socket.join(roomId);
    socket.roomId = roomId;

    const player = {
      id: socket.id,
      name: playerName || `Guerreiro_${socket.id.slice(0, 4)}`,
      contact: contact || '',
      chips: 200,
      currentBet: 0,
      folded: false,
      hasDrawnThisTurn: false,
      hasDiscarded: false,
      arconte: null,
      hand: [],
      isAI: false
    };
    room.players.push(player);

    if (room.isSolo && room.players.length === 1) {
      addAIPlayer(room);
    }
    broadcastRoom(roomId, `${player.name} sentou-se à mesa.`);
  }

  function addAIPlayer(room) {
    const names = ['Arconte Sombra (IA)', 'Guardião Antigo (IA)', 'Vortex Arcano (IA)'];
    const aiName = names[Math.floor(Math.random() * names.length)];
    room.players.push({
      id: 'AI_BOT_1',
      name: `${aiName} [${room.aiDifficulty.toUpperCase()}]`,
      contact: 'bot@arconexo.local',
      chips: 200,
      currentBet: 0,
      folded: false,
      hasDrawnThisTurn: false,
      hasDiscarded: false,
      arconte: null,
      hand: [],
      isAI: true
    });
  }

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', 'Mínimo de 2 jogadores para iniciar.');
    startNewRound(room);
  });

  function startNewRound(room) {
    room.phase = 'SHUFFLING';
    room.pot = 0;
    room.currentBet = 10;
    room.deck = generateFluxoDeck();

    const shuffledArcontes = shuffle(ARCONTE_DECK);
    room.players.forEach((p, idx) => {
      p.arconte = shuffledArcontes[idx % shuffledArcontes.length];
      p.hand = [];
      p.folded = false;
      p.hasDrawnThisTurn = false;
      p.hasDiscarded = false;
      p.currentBet = Math.min(10, p.chips);
      p.chips -= p.currentBet;
      room.pot += p.currentBet;
    });

    io.to(room.id).emit('deckShuffling', { duration: 2500 });

    setTimeout(() => {
      // Distribui 2 cartas iniciais
      room.players.forEach(p => {
        p.hand.push(room.deck.pop());
        p.hand.push(room.deck.pop());
      });
      room.phase = 'BETTING_ROUND';
      room.turnIndex = 0;
      broadcastRoom(room.id, 'Cartas distribuídas! Início da rodada de apostas.');
      checkAITurn(room);
    }, 2600);
  }

  // Ação: Apostar / Pagar / Aumentar / Correr
  socket.on('playerBetAction', ({ action, amount }) => {
    const room = rooms[socket.roomId];
    if (!room || room.phase !== 'BETTING_ROUND') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;
    handleBetAction(room, player, action, amount);
  });

  function handleBetAction(room, player, action, amount) {
    if (action === 'fold') {
      player.folded = true;
      broadcastRoom(room.id, `${player.name} correu da rodada (Fold)!`);
    } else if (action === 'call') {
      const diff = room.currentBet - player.currentBet;
      const toPay = Math.min(diff, player.chips);
      player.chips -= toPay;
      player.currentBet += toPay;
      room.pot += toPay;
      broadcastRoom(room.id, `${player.name} pagou a aposta (${toPay} fichas).`);
    } else if (action === 'raise') {
      const raiseAmt = Number(amount) || 10;
      const targetBet = room.currentBet + raiseAmt;
      const diff = targetBet - player.currentBet;
      const toPay = Math.min(diff, player.chips);
      player.chips -= toPay;
      player.currentBet += toPay;
      room.currentBet = player.currentBet;
      room.pot += toPay;
      broadcastRoom(room.id, `${player.name} aumentou a aposta para ${room.currentBet}!`);
    }

    advanceBetTurn(room);
  }

  function advanceBetTurn(room) {
    const active = room.players.filter(p => !p.folded);
    if (active.length <= 1) {
      return endRoundShowdown(room);
    }

    // Avança índice
    let nextIdx = (room.turnIndex + 1) % room.players.length;
    let cycles = 0;
    while (room.players[nextIdx].folded && cycles < room.players.length) {
      nextIdx = (nextIdx + 1) % room.players.length;
      cycles++;
    }

    // Se todos igualaram a aposta atual, passa para a fase de Escolha de Cartas no Leque
    const allBetsEqual = active.every(p => p.currentBet === room.currentBet || p.chips === 0);
    if (allBetsEqual && nextIdx === 0) {
      room.phase = 'DRAW_OR_DISCARD';
      room.turnIndex = 0;
      room.players.forEach(p => p.hasDrawnThisTurn = false);
      broadcastRoom(room.id, 'Fase de Compra: Selecione uma carta no leque do baralho ou passe a vez!');
      checkAITurn(room);
      return;
    }

    room.turnIndex = nextIdx;
    broadcastRoom(room.id);
    checkAITurn(room);
  }

  // Ação: Puxar do Leque por Índice
  socket.on('drawCardFromFan', ({ fanCardIndex }) => {
    const room = rooms[socket.roomId];
    if (!room || room.phase !== 'DRAW_OR_DISCARD') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;

    if (player.hand.length >= 5) {
      return socket.emit('errorMsg', 'Sua mão já atingiu o limite máximo de 5 cartas de Fluxo!');
    }
    if (player.hasDrawnThisTurn) {
      return socket.emit('errorMsg', 'Você já comprou nesta rodada!');
    }

    if (room.deck.length === 0) room.deck = generateFluxoDeck();
    const pickedCard = room.deck.splice(fanCardIndex % room.deck.length, 1)[0];
    player.hand.push(pickedCard);
    player.hasDrawnThisTurn = true;

    const val = calculateHandValue(player.arconte, player.hand);
    broadcastRoom(room.id, `${player.name} puxou uma carta do leque sagrado! (Total: ${val})`);
    advanceDrawTurn(room);
  });

  // Ação: Passar a vez de comprar
  socket.on('standTurn', () => {
    const room = rooms[socket.roomId];
    if (!room || room.phase !== 'DRAW_OR_DISCARD') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;
    player.hasDrawnThisTurn = true;
    broadcastRoom(room.id, `${player.name} decidiu parar com sua mão atual.`);
    advanceDrawTurn(room);
  });

  // Ação: Descartar Carta de Alívio (se ultrapassou 21)
  socket.on('discardCard', ({ cardUid }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (player.hasDiscarded) {
      return socket.emit('errorMsg', 'Você só pode descartar 1 carta de alívio por rodada!');
    }
    if (player.hand.length <= 2) {
      return socket.emit('errorMsg', 'Você deve manter pelo menos 2 cartas de Fluxo na mão!');
    }

    const cardIndex = player.hand.findIndex(c => c.uid === cardUid);
    if (cardIndex === -1) return;

    const removed = player.hand.splice(cardIndex, 1)[0];
    player.hasDiscarded = true;
    const newVal = calculateHandValue(player.arconte, player.hand);
    broadcastRoom(room.id, `${player.name} descartou [${removed.label}${removed.symbol}] para regular a energia! (Novo total: ${newVal})`);
  });

  function advanceDrawTurn(room) {
    let nextIdx = (room.turnIndex + 1) % room.players.length;
    let cycles = 0;
    while (room.players[nextIdx].folded && cycles < room.players.length) {
      nextIdx = (nextIdx + 1) % room.players.length;
      cycles++;
    }

    // Se todos tiveram a chance de comprar ou parar
    if (nextIdx === 0 || cycles >= room.players.length) {
      return endRoundShowdown(room);
    }

    room.turnIndex = nextIdx;
    broadcastRoom(room.id);
    checkAITurn(room);
  }

  function checkAITurn(room) {
    const current = room.players[room.turnIndex];
    if (!current || !current.isAI || current.folded) return;

    setTimeout(() => {
      if (room.phase === 'BETTING_ROUND') {
        const currentVal = calculateHandValue(current.arconte, current.hand);
        if (currentVal > 22 && room.aiDifficulty === 'hard') {
          handleBetAction(room, current, 'fold', 0);
        } else if (currentVal >= 18) {
          handleBetAction(room, current, 'raise', 10);
        } else {
          handleBetAction(room, current, 'call', 0);
        }
      } else if (room.phase === 'DRAW_OR_DISCARD') {
        const val = calculateHandValue(current.arconte, current.hand);
        if (val < 16 && current.hand.length < 5) {
          // IA puxa carta do leque
          const card = room.deck.pop();
          current.hand.push(card);
          current.hasDrawnThisTurn = true;
          const newVal = calculateHandValue(current.arconte, current.hand);
          broadcastRoom(room.id, `${current.name} retirou uma carta misteriosa do leque!`);
          // Se estourou, tenta descarte de alívio
          if (newVal > 21 && !current.hasDiscarded && current.hand.length > 2) {
            current.hand.sort((a, b) => b.val - a.val);
            const discarded = current.hand.shift();
            current.hasDiscarded = true;
            broadcastRoom(room.id, `${current.name} ativou o Descarte de Alívio com [${discarded.label}${discarded.symbol}]!`);
          }
        } else {
          current.hasDrawnThisTurn = true;
          broadcastRoom(room.id, `${current.name} optou por Parar.`);
        }
        advanceDrawTurn(room);
      }
    }, 1800);
  }

  function endRoundShowdown(room) {
    room.phase = 'SHOWDOWN';

    const activePlayers = room.players.filter(p => !p.folded);
    let winner = null;
    let winReason = '';

    if (activePlayers.length === 1) {
      winner = activePlayers[0];
      winReason = 'Todos os outros guerreiros correram da aposta!';
    } else {
      activePlayers.forEach(p => {
        p.finalScore = calculateHandValue(p.arconte, p.hand);
        p.poker = evaluatePokerHand(p.hand);
      });

      // Separa quem não estourou (<=21)
      const valid = activePlayers.filter(p => p.finalScore <= 21);

      if (valid.length > 0) {
        // Ordena por: mais próximo de 21, depois força do poker
        valid.sort((a, b) => {
          if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
          return b.poker.rank - a.poker.rank;
        });
        winner = valid[0];
        if (winner.finalScore === 21) {
          winReason = `🏆 21 SUPREMO ALCANÇADO COM ${winner.poker.desc.toUpperCase()}!`;
        } else {
          winReason = `🏆 Maior pontuação segura: ${winner.finalScore} pts (${winner.poker.desc})!`;
        }
      } else {
        // Todos estouraram: vence quem estourou por menos
        activePlayers.sort((a, b) => a.finalScore - b.finalScore);
        winner = activePlayers[0];
        winReason = `Todos sobrecarregaram! Menor sobrecarga: ${winner.finalScore} pts.`;
      }
    }

    winner.chips += room.pot;
    const showdownData = {
      winnerId: winner.id,
      winnerName: winner.name,
      winReason: winReason,
      potWon: room.pot,
      allPlayers: room.players.map(p => ({
        id: p.id,
        name: p.name,
        arconte: p.arconte,
        hand: p.hand,
        finalScore: calculateHandValue(p.arconte, p.hand),
        pokerDesc: evaluatePokerHand(p.hand).desc,
        folded: p.folded,
        chips: p.chips
      }))
    };

    io.to(room.id).emit('showdownResult', showdownData);
    broadcastRoom(room.id, `${winner.name} venceu a rodada e arrematou ${room.pot} fichas arcanas!`);
  }

  socket.on('nextRoundReady', () => {
    const room = rooms[socket.roomId];
    if (!room || room.host !== socket.id) return;
    startNewRound(room);
  });

  function broadcastRoom(roomId, toastMsg) {
    const room = rooms[roomId];
    if (!room) return;

    room.players.forEach(p => {
      const publicPlayers = room.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        chips: pl.chips,
        currentBet: pl.currentBet,
        folded: pl.folded,
        arconte: pl.arconte,
        cardCount: pl.hand.length,
        // Só revela as cartas dos outros no Showdown!
        hand: (room.phase === 'SHOWDOWN' || pl.id === p.id) ? pl.hand : pl.hand.map(() => ({ hidden: true })),
        score: (room.phase === 'SHOWDOWN' || pl.id === p.id) ? calculateHandValue(pl.arconte, pl.hand) : '??'
      }));

      io.to(p.id).emit('gameState', {
        roomId: room.id,
        phase: room.phase,
        pot: room.pot,
        currentBet: room.currentBet,
        turnPlayerId: room.players[room.turnIndex]?.id,
        turnPlayerName: room.players[room.turnIndex]?.name,
        deckCount: room.deck.length,
        isHost: room.host === p.id,
        players: publicPlayers,
        toast: toastMsg || null
      });
    });
  }

  socket.on('disconnect', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[socket.roomId];
      } else {
        if (room.host === socket.id) room.host = room.players[0].id;
        broadcastRoom(socket.roomId, 'Um guerreiro abandonou a mesa.');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[ARCONEXO ONLINE v2.0] Servidor rodando na porta ${PORT}`);
});
