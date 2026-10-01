const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Baralho de Fluxo (40 Cartas) + Arcontes
const SUITS = [
  { symbol: '♣', name: 'Terra' },
  { symbol: '♦', name: 'Luz' },
  { symbol: '♥', name: 'Água' },
  { symbol: '♠', name: 'Trevas' }
];

const RANKS = [
  { rank: 'A', value: 1 },
  { rank: '2', value: 2 },
  { rank: '3', value: 3 },
  { rank: '4', value: 4 },
  { rank: '5', value: 5 },
  { rank: '6', value: 6 },
  { rank: '7', value: 7 },
  { rank: '8', value: 8 },
  { rank: '9', value: 9 },
  { rank: '10', value: 10 }
];

const ARCONTES = [
  { name: 'Ignis', suit: '♠', element: 'Trevas', value: 7 },
  { name: 'Zephyrus', suit: '♣', element: 'Terra', value: 7 },
  { name: 'Aurelius', suit: '♦', element: 'Luz', value: 7 },
  { name: 'Thalassa', suit: '♥', element: 'Água', value: 7 }
];

function createShuffledDeck() {
  let deck = [];
  for (let s of SUITS) {
    for (let r of RANKS) {
      deck.push({ rank: r.rank, suit: s.symbol, suitName: s.name, value: r.value });
    }
  }
  // Embaralhamento Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function calculateHandSum(hand, arconte) {
  let sum = arconte ? arconte.value : 7;
  let aces = 0;
  for (let c of hand) {
    if (c.rank === 'A') {
      aces++;
      sum += 11;
    } else {
      sum += c.value;
    }
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

const rooms = {};

io.on('connection', (socket) => {
  // Criar sala
  socket.on('createRoom', ({ roomId, password, playerName, userContact }) => {
    rooms[roomId] = {
      id: roomId,
      password: password || '',
      deck: createShuffledDeck(),
      pot: 0,
      turnIndex: 0,
      phase: 'LOBBY',
      players: [
        {
          id: socket.id,
          name: playerName,
          contact: userContact,
          chips: 100,
          hand: [],
          arconte: null,
          hasStood: false,
          hasDiscarded: false,
          isAI: false
        }
      ]
    };
    socket.join(roomId);
    socket.emit('roomJoined', { roomId, isHost: true });
    io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players });
  });

  // Entrar em sala
  socket.on('joinRoom', ({ roomId, password, playerName, userContact }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('gameError', 'Sala não encontrada!');
    if (room.password && room.password !== password) return socket.emit('gameError', 'Senha incorreta!');
    if (room.players.length >= 6) return socket.emit('gameError', 'A mesa já atingiu o limite de 6 jogadores!');
    if (room.phase !== 'LOBBY') return socket.emit('gameError', 'Esta partida já começou!');

    room.players.push({
      id: socket.id,
      name: playerName,
      contact: userContact,
      chips: 100,
      hand: [],
      arconte: null,
      hasStood: false,
      hasDiscarded: false,
      isAI: false
    });

    socket.join(roomId);
    socket.emit('roomJoined', { roomId, isHost: false });
    io.to(roomId).emit('updatePlayers', { players: room.players });
  });

  // Iniciar Jogo (Solo contra IA ou Multiplayer)
  socket.on('startGame', ({ roomId, playWithAI, aiDifficulty }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (playWithAI && room.players.length === 1) {
      room.players.push({
        id: 'bot_' + Math.random().toString(36).substring(2, 6),
        name: `Arconte Bot (${aiDifficulty || 'Médio'})`,
        contact: 'ia@arconexo.local',
        chips: 100,
        hand: [],
        arconte: null,
        hasStood: false,
        hasDiscarded: false,
        isAI: true,
        difficulty: aiDifficulty || 'Médio'
      });
    }

    room.phase = 'PLAYING';
    room.pot = room.players.length * 1; // Pingo obrigatório de 1 ficha

    // Distribuição inicial (Arconte sorteado + 2 cartas de Fluxo)
    room.players.forEach((p) => {
      p.chips -= 1;
      p.arconte = ARCONTES[Math.floor(Math.random() * ARCONTES.length)];
      p.hand = [room.deck.pop(), room.deck.pop()];
      p.hasStood = false;
      p.hasDiscarded = false;
    });

    io.to(roomId).emit('gameStarted', {
      pot: room.pot,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        cardCount: p.hand.length,
        isAI: p.isAI
      }))
    });

    // Envia mão privada para cada humano
    room.players.forEach((p) => {
      if (!p.isAI) {
        io.to(p.id).emit('syncHand', {
          hand: p.hand,
          arconte: p.arconte,
          score: calculateHandSum(p.hand, p.arconte)
        });
      }
    });
  });

  // Ações do Jogador
  socket.on('playerAction', ({ roomId, action, discardIndex }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'PLAYING') return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.hasStood) return;

    if (action === 'HIT') {
      if (p.hand.length < 5 && room.deck.length > 0) {
        p.hand.push(room.deck.pop());
      }
    } else if (action === 'STAND') {
      p.hasStood = true;
    } else if (action === 'DISCARD' && !p.hasDiscarded) {
      if (typeof discardIndex === 'number' && discardIndex >= 0 && discardIndex < p.hand.length) {
        p.hand.splice(discardIndex, 1);
        p.hasDiscarded = true;
      }
    }

    const currentScore = calculateHandSum(p.hand, p.arconte);
    socket.emit('syncHand', {
      hand: p.hand,
      arconte: p.arconte,
      score: currentScore,
      hasDiscarded: p.hasDiscarded
    });

    // Processar turno do Bot (se existir)
    const bot = room.players.find(x => x.isAI);
    if (bot && !bot.hasStood) {
      runAITurn(bot, room);
    }

    // Checar se todos pararam
    const allStood = room.players.every(x => x.hasStood || x.hand.length === 5);
    if (allStood) {
      endRound(room);
    }
  });
});

function runAITurn(bot, room) {
  let botScore = calculateHandSum(bot.hand, bot.arconte);
  let threshold = 16;
  if (bot.difficulty === 'Fácil') threshold = 18; // Arrisca demais e estoura
  if (bot.difficulty === 'Médio') threshold = 16;
  if (bot.difficulty === 'Difícil') threshold = 15; // Joga conservador e estratégico

  if (botScore < threshold && bot.hand.length < 5 && room.deck.length > 0) {
    bot.hand.push(room.deck.pop());
    botScore = calculateHandSum(bot.hand, bot.arconte);
  } else {
    bot.hasStood = true;
  }

  // Se o bot estourou e pode descartar
  if (botScore > 21 && !bot.hasDiscarded && bot.hand.length > 0) {
    // Escolhe a carta mais alta para descartar
    let highestIdx = 0;
    let highestVal = 0;
    bot.hand.forEach((c, idx) => {
      if (c.value > highestVal) {
        highestVal = c.value;
        highestIdx = idx;
      }
    });
    bot.hand.splice(highestIdx, 1);
    bot.hasDiscarded = true;
  }
}

function endRound(room) {
  room.phase = 'ROUND_OVER';

  let results = room.players.map(p => {
    const score = calculateHandSum(p.hand, p.arconte);
    return {
      id: p.id,
      name: p.name,
      score: score,
      busted: score > 21,
      hand: p.hand,
      arconte: p.arconte
    };
  });

  // Vence quem chegou mais perto de 21 sem ultrapassar
  let validPlayers = results.filter(r => !r.busted);
  let winner = null;

  if (validPlayers.length > 0) {
    validPlayers.sort((a, b) => b.score - a.score);
    winner = validPlayers[0];
    const winningPlayerObj = room.players.find(p => p.id === winner.id);
    if (winningPlayerObj) winningPlayerObj.chips += room.pot;
  }

  io.to(room.id).emit('roundFinished', {
    results,
    winnerName: winner ? winner.name : 'Ninguém (Todos estouraram o Limite 21!)',
    pot: room.pot
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor ARCONEXO rodando com sucesso na porta ${PORT}`);
});
