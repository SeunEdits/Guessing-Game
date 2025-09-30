// Entry point for the guessing game backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// In-memory store for sessions and players
const sessions = {};

// Helper functions and game logic
function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getNextGameMaster(session) {
  // Pick a random player who is not the current master
  const eligible = session.players.filter(p => p.id !== session.masterId);
  return getRandomElement(eligible);
}

function resetSession(session) {
  session.inProgress = false;
  session.question = null;
  session.answer = null;
  session.attempts = {};
  session.winnerId = null;
  session.timer = null;
}

io.on('connection', (socket) => {
  // Join or create a session
  socket.on('joinSession', ({ sessionId, name }, cb) => {
    if (!sessionId || !name) return cb({ error: 'Invalid input' });
    if (!sessions[sessionId]) {
      // Create new session
      sessions[sessionId] = {
        id: sessionId,
        players: [],
        masterId: null,
        inProgress: false,
        question: null,
        answer: null,
        attempts: {},
        winnerId: null,
        timer: null,
        scores: {},
      };
    }
    const session = sessions[sessionId];
    if (session.inProgress) return cb({ error: 'Game in progress' });
    if (session.players.find(p => p.id === socket.id)) return cb({ error: 'Already joined' });
    session.players.push({ id: socket.id, name });
    session.scores[socket.id] = session.scores[socket.id] || 0;
    socket.join(sessionId);
    // Assign master if first player or after all left
    if (!session.masterId) session.masterId = socket.id;
    io.to(sessionId).emit('sessionUpdate', {
      players: session.players.map(p => ({ id: p.id, name: p.name })),
      masterId: session.masterId,
      scores: session.scores
    });
    cb({ success: true, master: session.masterId === socket.id });
  });

  // Leave session
  socket.on('leaveSession', ({ sessionId }) => {
    const session = sessions[sessionId];
    if (!session) return;
    session.players = session.players.filter(p => p.id !== socket.id);
    delete session.scores[socket.id];
    if (session.players.length === 0) {
      clearTimeout(session.timer);
      delete sessions[sessionId];
      return;
    }
    if (session.masterId === socket.id) {
      // Assign new master at random
      const next = getRandomElement(session.players);
      session.masterId = next ? next.id : null;
    }
    io.to(sessionId).emit('sessionUpdate', {
      players: session.players.map(p => ({ id: p.id, name: p.name })),
      masterId: session.masterId,
      scores: session.scores
    });
  });

  // Game master sets question/answer
  socket.on('setQuestion', ({ sessionId, question, answer }, cb) => {
    const session = sessions[sessionId];
    if (!session || session.masterId !== socket.id || session.inProgress) return cb({ error: 'Not allowed' });
    if (!question || !answer) return cb({ error: 'Invalid input' });
    session.question = question;
    session.answer = answer.trim().toLowerCase();
    io.to(sessionId).emit('questionSet', { question });
    cb({ success: true });
  });

  // Game master starts game
  socket.on('startGame', ({ sessionId }, cb) => {
    const session = sessions[sessionId];
    if (!session || session.masterId !== socket.id || session.inProgress) return cb({ error: 'Not allowed' });
    if (session.players.length < 3) return cb({ error: 'At least 3 players required' });
    if (!session.question || !session.answer) return cb({ error: 'Set question/answer first' });
    session.inProgress = true;
    session.attempts = {};
    session.winnerId = null;
    // Start timer
    session.timer = setTimeout(() => {
      session.inProgress = false;
      io.to(sessionId).emit('gameEnd', { winner: null, answer: session.answer, scores: session.scores });
      resetSession(session);
    }, 60000);
    io.to(sessionId).emit('gameStarted', { question: session.question });
    cb({ success: true });
  });

  // Player submits guess
  socket.on('guess', ({ sessionId, guess }, cb) => {
    const session = sessions[sessionId];
    if (!session || !session.inProgress) return cb({ error: 'Game not in progress' });
    if (session.winnerId) return cb({ error: 'Game already won' });
    if (!session.players.find(p => p.id === socket.id)) return cb({ error: 'Not in session' });
    if (socket.id === session.masterId) return cb({ error: 'Master cannot guess' });
    session.attempts[socket.id] = (session.attempts[socket.id] || 0) + 1;
    if (session.attempts[socket.id] > 3) return cb({ error: 'No attempts left' });
    if (guess.trim().toLowerCase() === session.answer) {
      session.winnerId = socket.id;
      session.scores[socket.id] += 10;
      clearTimeout(session.timer);
      session.inProgress = false;
      io.to(sessionId).emit('gameEnd', { winner: socket.id, answer: session.answer, scores: session.scores });
      resetSession(session);
      return cb({ success: true, correct: true });
    }
    cb({ success: true, correct: false, attempts: 3 - session.attempts[socket.id] });
  });

  // On disconnect, treat as leave
  socket.on('disconnect', () => {
    for (const sessionId in sessions) {
      const session = sessions[sessionId];
      if (session.players.find(p => p.id === socket.id)) {
        session.players = session.players.filter(p => p.id !== socket.id);
        delete session.scores[socket.id];
        if (session.players.length === 0) {
          clearTimeout(session.timer);
          delete sessions[sessionId];
          continue;
        }
        if (session.masterId === socket.id) {
          const next = getRandomElement(session.players);
          session.masterId = next ? next.id : null;
        }
        io.to(sessionId).emit('sessionUpdate', {
          players: session.players.map(p => ({ id: p.id, name: p.name })),
          masterId: session.masterId,
          scores: session.scores
        });
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
