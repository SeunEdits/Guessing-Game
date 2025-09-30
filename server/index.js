// Entry point for the guessing game backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

// Debug endpoint to see sessions
app.get('/api/sessions', (req, res) => {
  const sessionList = Object.keys(sessions).map(id => ({
    id,
    playerCount: sessions[id].players.length,
    inProgress: sessions[id].inProgress
  }));
  res.json(sessionList);
});

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
      // Create new session
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
    
    // Check if player already in session
    const existingPlayer = session.players.find(p => p.id === socket.id);
    if (existingPlayer) {
      console.log('Player already in session');
      return cb({ error: 'Already joined' });
    }
    
    // Add player to session
    session.players.push({ id: socket.id, name });
    session.scores[socket.id] = session.scores[socket.id] || 0;
    socket.join(sessionId);
    
    // Assign master if first player
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
    
    // Send update to all players in session
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
    
    // Remove player from session
    const playerBefore = session.players.length;
    session.players = session.players.filter(p => p.id !== socket.id);
    delete session.scores[socket.id];
    delete session.attempts[socket.id];
    
    // Leave the socket.io room
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
    
    // Assign new master if needed
    if (session.masterId === socket.id) {
      const next = getRandomElement(session.players);
      session.masterId = next ? next.id : null;
      console.log('New master assigned:', session.masterId);
      
      // If game was in progress and master left, end the game
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
    
    // Notify remaining players
    io.to(sessionId).emit('sessionUpdate', {
      players: session.players.map(p => ({ id: p.id, name: p.name })),
      masterId: session.masterId,
      scores: session.scores
    });
    
    console.log('Leave session completed');
  });

  // Game master sets question/answer
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

  // Game master starts game
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
    
    // Start timer
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

  // Player submits guess
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
    
    // Track attempts
    session.attempts[socket.id] = (session.attempts[socket.id] || 0) + 1;
    
    if (session.attempts[socket.id] > 3) {
      console.log('No attempts left');
      return cb({ error: 'No attempts left' });
    }
    
    // Check if guess is correct
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

  // On disconnect, treat as leave
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
        
        // Assign new master if needed
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

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});