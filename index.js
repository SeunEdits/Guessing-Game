// Unified server for guessing game - Frontend + Backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// In-memory store for sessions and players
const sessions = {};

// ========================
// FRONTEND ROUTES
// ========================

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/game/:sessionId', (req, res) => {
  console.log('Game page requested:', req.params.sessionId);
  res.render('games', { sessionId: req.params.sessionId });
});

// Debug endpoint to see sessions
app.get('/api/sessions', (req, res) => {
  const sessionList = Object.keys(sessions).map(id => ({
    id,
    playerCount: sessions[id].players.length,
    inProgress: sessions[id].inProgress
  }));
  res.json(sessionList);
});

// ========================
// HELPER FUNCTIONS
// ========================

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getNextGameMaster(session) {
  const eligible = session.players.filter(p => p.id !== session.masterId);
  return eligible.length > 0 ? getRandomElement(eligible) : null;
}

function resetSession(session) {
  session.inProgress = false;
  session.question = null;
  session.answer = null;
  session.attempts = {};
  session.winnerId = null;
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}

// ========================
// SOCKET.IO BACKEND LOGIC
// ========================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join or create a session
  socket.on('joinSession', ({ sessionId, name }, cb) => {
    console.log('joinSession request:', { socketId: socket.id, sessionId, name });
    
    if (!sessionId || !name) {
      console.log('Invalid input');
      return cb({ error: 'Invalid input' });
    }
    
    if (!sessions[sessionId]) {
      console.log('Creating new session:', sessionId);
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
    
    if (session.inProgress) {
      console.log('Game already in progress');
      return cb({ error: 'Game in progress' });
    }
    
    const existingPlayer = session.players.find(p => p.id === socket.id);
    if (existingPlayer) {
      console.log('Player already in session');
      return cb({ error: 'Already joined' });
    }
    
    session.players.push({ id: socket.id, name });
    session.scores[socket.id] = session.scores[socket.id] || 0;
    socket.join(sessionId);
    
    if (!session.masterId) {
      session.masterId = socket.id;
      console.log('Assigned master:', socket.id);
    }
    
    console.log('Player joined. Session state:', {
      sessionId,
      playerCount: session.players.length,
      masterId: session.masterId,
      players: session.players.map(p => ({ id: p.id, name: p.name }))
    });
    
    io.to(sessionId).emit('sessionUpdate', {
      players: session.players.map(p => ({ id: p.id, name: p.name })),
      masterId: session.masterId,
      scores: session.scores
    });
    
    cb({ success: true, master: session.masterId === socket.id });
  });

  // Leave session
  socket.on('leaveSession', ({ sessionId }) => {
    console.log('leaveSession:', { socketId: socket.id, sessionId });
    
    const session = sessions[sessionId];
    if (!session) {
      console.log('Session not found for leave');
      return;
    }
    
    const playerBefore = session.players.length;
    session.players = session.players.filter(p => p.id !== socket.id);
    delete session.scores[socket.id];
    delete session.attempts[socket.id];
    
    socket.leave(sessionId);
    
    console.log(`Player removed. Players before: ${playerBefore}, after: ${session.players.length}`);
    
    if (session.players.length === 0) {
      console.log('Last player left, deleting session:', sessionId);
      if (session.timer) {
        clearTimeout(session.timer);
      }
      delete sessions[sessionId];
      return;
    }
    
    if (session.masterId === socket.id) {
      const next = getRandomElement(session.players);
      session.masterId = next ? next.id : null;
      console.log('New master assigned:', session.masterId);
      
      if (session.inProgress) {
        console.log('Master left during game, ending game');
        session.inProgress = false;
        if (session.timer) {
          clearTimeout(session.timer);
        }
        io.to(sessionId).emit('gameEnd', { 
          winner: null, 
          answer: session.answer || 'N/A', 
          scores: session.scores 
        });
        resetSession(session);
      }
    }
    
    io.to(sessionId).emit('sessionUpdate', {
      players: session.players.map(p => ({ id: p.id, name: p.name })),
      masterId: session.masterId,
      scores: session.scores
    });
    
    console.log('Leave session completed');
  });

  // Set question/answer
  socket.on('setQuestion', ({ sessionId, question, answer }, cb) => {
    console.log('setQuestion:', { socketId: socket.id, sessionId, question });
    
    const session = sessions[sessionId];
    if (!session) {
      console.log('Session not found');
      return cb({ error: 'Session not found' });
    }
    
    if (session.masterId !== socket.id) {
      console.log('Not the master');
      return cb({ error: 'Only master can set question' });
    }
    
    if (session.inProgress) {
      console.log('Game in progress');
      return cb({ error: 'Game already in progress' });
    }
    
    if (!question || !answer) {
      console.log('Invalid question/answer');
      return cb({ error: 'Invalid input' });
    }
    
    session.question = question;
    session.answer = answer.trim().toLowerCase();
    
    console.log('Question set successfully');
    io.to(sessionId).emit('questionSet', { question });
    cb({ success: true });
  });

  // Start game
  socket.on('startGame', ({ sessionId }, cb) => {
    console.log('startGame:', { socketId: socket.id, sessionId });
    
    const session = sessions[sessionId];
    if (!session) {
      console.log('Session not found');
      return cb({ error: 'Session not found' });
    }
    
    if (session.masterId !== socket.id) {
      console.log('Not the master');
      return cb({ error: 'Only master can start game' });
    }
    
    if (session.inProgress) {
      console.log('Game already in progress');
      return cb({ error: 'Game already in progress' });
    }
    
    if (session.players.length < 3) {
      console.log('Not enough players:', session.players.length);
      return cb({ error: 'At least 3 players required' });
    }
    
    if (!session.question || !session.answer) {
      console.log('Question/answer not set');
      return cb({ error: 'Set question/answer first' });
    }
    
    session.inProgress = true;
    session.attempts = {};
    session.winnerId = null;
    
    console.log('Game started successfully');
    
    session.timer = setTimeout(() => {
      console.log('Game timer expired:', sessionId);
      session.inProgress = false;
      io.to(sessionId).emit('gameEnd', { 
        winner: null, 
        answer: session.answer, 
        scores: session.scores 
      });
      resetSession(session);
    }, 60000);
    
    io.to(sessionId).emit('gameStarted', { question: session.question });
    cb({ success: true });
  });

  // Submit guess
  socket.on('guess', ({ sessionId, guess }, cb) => {
    console.log('guess:', { socketId: socket.id, sessionId, guess });
    
    const session = sessions[sessionId];
    if (!session) {
      console.log('Session not found');
      return cb({ error: 'Session not found' });
    }
    
    if (!session.inProgress) {
      console.log('Game not in progress');
      return cb({ error: 'Game not in progress' });
    }
    
    if (session.winnerId) {
      console.log('Game already won');
      return cb({ error: 'Game already won' });
    }
    
    if (!session.players.find(p => p.id === socket.id)) {
      console.log('Player not in session');
      return cb({ error: 'Not in session' });
    }
    
    if (socket.id === session.masterId) {
      console.log('Master cannot guess');
      return cb({ error: 'Master cannot guess' });
    }
    
    session.attempts[socket.id] = (session.attempts[socket.id] || 0) + 1;
    
    if (session.attempts[socket.id] > 3) {
      console.log('No attempts left');
      return cb({ error: 'No attempts left' });
    }
    
    if (guess.trim().toLowerCase() === session.answer) {
      console.log('Correct guess!');
      session.winnerId = socket.id;
      session.scores[socket.id] += 10;
      clearTimeout(session.timer);
      session.inProgress = false;
      
      io.to(sessionId).emit('gameEnd', { 
        winner: socket.id, 
        answer: session.answer, 
        scores: session.scores 
      });
      
      resetSession(session);
      return cb({ success: true, correct: true });
    }
    
    console.log('Incorrect guess. Attempts left:', 3 - session.attempts[socket.id]);
    cb({ 
      success: true, 
      correct: false, 
      attempts: 3 - session.attempts[socket.id] 
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    for (const sessionId in sessions) {
      const session = sessions[sessionId];
      const playerIndex = session.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        console.log('Removing player from session:', sessionId);
        session.players = session.players.filter(p => p.id !== socket.id);
        delete session.scores[socket.id];
        delete session.attempts[socket.id];
        
        if (session.players.length === 0) {
          console.log('Session empty, deleting:', sessionId);
          clearTimeout(session.timer);
          delete sessions[sessionId];
          continue;
        }
        
        if (session.masterId === socket.id) {
          const next = getRandomElement(session.players);
          session.masterId = next ? next.id : null;
          console.log('New master after disconnect:', session.masterId);
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

// ========================
// START SERVER
// ========================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🎮 Guessing Game Server Started');
  console.log('=================================');
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`Open your browser to: http://localhost:${PORT}`);
  console.log('=================================');
});