// Get session ID from URL and player name from storage
const sessionId = window.location.pathname.split('/')[2];
const playerName = sessionStorage.getItem('playerName');

console.log('Initializing game page:', { sessionId, playerName });

// Redirect if no player name
if (!playerName) {
  console.log('No player name found, redirecting to home');
  window.location.href = '/';
}

// Connect to socket.io server
console.log('Connecting to socket.io server at http://localhost:4000');
const socket = io('http://localhost:4000', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

let isMaster = false;
let gameInProgress = false;
let attempts = 3;
let timerInterval = null;
let playersMap = {}; // Store players data

// Socket connection events
socket.on('connect', () => {
  console.log('✓ Connected to server, socket id:', socket.id);
  
  // Join session immediately after connection
  console.log('Attempting to join session:', sessionId);
  socket.emit('joinSession', { sessionId, name: playerName }, (response) => {
    console.log('joinSession response:', response);
    
    if (response.error) {
      alert('Error joining game: ' + response.error);
      window.location.href = '/';
      return;
    }
    
    isMaster = response.master;
    console.log('✓ Successfully joined session. Is master:', isMaster);
  });
});

socket.on('connect_error', (error) => {
  console.error('✗ Connection error:', error);
  alert('Failed to connect to game server. Please ensure the backend server is running on port 4000.');
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server. Reason:', reason);
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
});

// Listen for session updates
socket.on('sessionUpdate', (data) => {
  console.log('📢 Session update received:', data);
  
  // Store players in map for easy lookup
  playersMap = {};
  data.players.forEach(player => {
    playersMap[player.id] = player.name;
  });
  
  // Check if current player is the master
  isMaster = (socket.id === data.masterId);
  console.log('Players map updated:', playersMap);
  console.log('Current master ID:', data.masterId, 'Am I master?', isMaster);
  
  updatePlayersList(data.players, data.masterId);
  updateScores(data.scores);
  updateUI();
});

// Listen for question set
socket.on('questionSet', (data) => {
  console.log('📝 Question set:', data);
  if (isMaster) {
    document.getElementById('questionSet').style.display = 'block';
  }
});

// Listen for game start
socket.on('gameStarted', (data) => {
  console.log('🎮 Game started:', data);
  gameInProgress = true;
  document.getElementById('displayQuestion').textContent = data.question;
  showScreen('gameScreen');
  
  if (isMaster) {
    document.getElementById('guessArea').style.display = 'none';
    document.getElementById('masterWaiting').style.display = 'block';
  } else {
    document.getElementById('guessArea').style.display = 'block';
    document.getElementById('masterWaiting').style.display = 'none';
    attempts = 3;
    updateAttemptsDisplay();
    // Clear previous results
    document.getElementById('guessResult').textContent = '';
    document.getElementById('guess').value = '';
  }
  
  startTimer(60);
});

// Listen for game end
socket.on('gameEnd', (data) => {
  console.log('🏁 Game ended:', data);
  gameInProgress = false;
  clearInterval(timerInterval);
  
  const winnerDisplay = document.getElementById('winnerDisplay');
  const answerReveal = document.getElementById('answerReveal');
  
  if (data.winner) {
    const winnerName = playersMap[data.winner] || 'Unknown Player';
    winnerDisplay.innerHTML = `🎉 <strong>${winnerName}</strong> won!`;
  } else {
    winnerDisplay.innerHTML = '⏰ Time\'s up! No winner.';
  }
  
  answerReveal.innerHTML = `The answer was: <strong>${data.answer}</strong>`;
  
  updateScores(data.scores);
  showScreen('resultsScreen');
  
  // Show ready button if master
  if (isMaster) {
    document.getElementById('newRoundBtn').style.display = 'block';
  }
});

// Set question form
const questionForm = document.getElementById('questionForm');
if (questionForm) {
  questionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = document.getElementById('question').value;
    const answer = document.getElementById('answer').value;
    
    console.log('📝 Setting question:', { question, answer });
    
    socket.emit('setQuestion', { sessionId, question, answer }, (response) => {
      console.log('setQuestion response:', response);
      if (response.error) {
        alert(response.error);
      } else {
        console.log('✓ Question set successfully');
      }
    });
  });
}

// Start game button
const startGameBtn = document.getElementById('startGameBtn');
if (startGameBtn) {
  startGameBtn.addEventListener('click', () => {
    console.log('🎮 Starting game...');
    socket.emit('startGame', { sessionId }, (response) => {
      console.log('startGame response:', response);
      if (response.error) {
        alert(response.error);
      } else {
        console.log('✓ Game started successfully');
      }
    });
  });
}

// Guess form
const guessForm = document.getElementById('guessForm');
if (guessForm) {
  guessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const guess = document.getElementById('guess').value;
    
    console.log('💭 Submitting guess:', guess);
    
    socket.emit('guess', { sessionId, guess }, (response) => {
      console.log('guess response:', response);
      const resultDiv = document.getElementById('guessResult');
      
      if (response.error) {
        resultDiv.textContent = response.error;
        resultDiv.className = 'result-message incorrect';
        return;
      }
      
      if (response.correct) {
        resultDiv.textContent = '🎉 Correct! You win!';
        resultDiv.className = 'result-message correct';
        document.getElementById('guessForm').style.display = 'none';
      } else {
        attempts = response.attempts;
        resultDiv.textContent = '❌ Incorrect! Try again.';
        resultDiv.className = 'result-message incorrect';
        updateAttemptsDisplay();
        
        if (attempts === 0) {
          document.getElementById('guessForm').style.display = 'none';
          resultDiv.textContent = '❌ No attempts left!';
        }
      }
      
      document.getElementById('guess').value = '';
    });
  });
}

// New round button
const newRoundBtn = document.getElementById('newRoundBtn');
if (newRoundBtn) {
  newRoundBtn.addEventListener('click', () => {
    console.log('🔄 Preparing new round');
    document.getElementById('questionForm').reset();
    document.getElementById('questionSet').style.display = 'none';
    document.getElementById('guessResult').textContent = '';
    document.getElementById('guessForm').style.display = 'block';
    document.getElementById('newRoundBtn').style.display = 'none';
    updateUI();
  });
}

// Leave button - FIXED
const leaveBtn = document.getElementById('leaveBtn');
if (leaveBtn) {
  leaveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('👋 Leave button clicked');
    
    // Emit leave event
    socket.emit('leaveSession', { sessionId });
    
    // Clear session storage
    sessionStorage.removeItem('playerName');
    
    // Redirect immediately (socket disconnect will be handled by browser closing connection)
    console.log('Redirecting to home page...');
    window.location.href = '/';
  });
}

// Helper functions
function updatePlayersList(players, masterId) {
  const list = document.getElementById('playersList');
  if (!list) {
    console.error('playersList element not found');
    return;
  }
  
  list.innerHTML = '';
  
  console.log('Updating players list with', players.length, 'players');
  
  if (players.length === 0) {
    list.innerHTML = '<p style="color: #999; font-style: italic; padding: 10px;">No players yet</p>';
    return;
  }
  
  players.forEach(player => {
    const div = document.createElement('div');
    div.className = 'player-item';
    if (player.id === masterId) {
      div.classList.add('master');
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name;
    div.appendChild(nameSpan);
    
    if (player.id === masterId) {
      const badge = document.createElement('span');
      badge.className = 'master-badge';
      badge.textContent = 'Master';
      div.appendChild(badge);
    }
    
    list.appendChild(div);
  });
  
  console.log('✓ Players list updated successfully');
}

function updateScores(scores) {
  const list = document.getElementById('scoresList');
  if (!list) {
    console.error('scoresList element not found');
    return;
  }
  
  list.innerHTML = '';
  
  if (!scores || Object.keys(scores).length === 0) {
    list.innerHTML = '<p style="color: #999; font-style: italic; padding: 10px;">No scores yet</p>';
    return;
  }
  
  // Sort by score
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  
  sortedScores.forEach(([playerId, score]) => {
    const div = document.createElement('div');
    div.className = 'score-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = playersMap[playerId] || 'Player';
    
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'score-value';
    scoreSpan.textContent = score;
    
    div.appendChild(nameSpan);
    div.appendChild(scoreSpan);
    list.appendChild(div);
  });
  
  console.log('✓ Scores updated successfully');
}

function updateUI() {
  console.log('🔄 Updating UI - isMaster:', isMaster, 'gameInProgress:', gameInProgress);
  
  if (gameInProgress) {
    showScreen('gameScreen');
  } else if (isMaster) {
    showScreen('masterScreen');
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) statusMsg.textContent = '';
  } else {
    showScreen('waitingScreen');
    const playerCount = Object.keys(playersMap).length;
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
      if (playerCount < 3) {
        statusMsg.textContent = `Waiting for more players... (${playerCount}/3 minimum)`;
      } else {
        statusMsg.textContent = `Ready to play! Waiting for game master to start... (${playerCount} players)`;
      }
    }
  }
}

function showScreen(screenId) {
  console.log('Showing screen:', screenId);
  const screens = document.querySelectorAll('.screen');
  screens.forEach(screen => {
    screen.style.display = 'none';
  });
  
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.style.display = 'block';
  } else {
    console.error('Screen not found:', screenId);
  }
}

function updateAttemptsDisplay() {
  const attemptsElement = document.getElementById('attemptsLeft');
  if (attemptsElement) {
    attemptsElement.textContent = `Attempts remaining: ${attempts}`;
  }
}

function startTimer(seconds) {
  let timeLeft = seconds;
  const timeLeftElement = document.getElementById('timeLeft');
  if (timeLeftElement) {
    timeLeftElement.textContent = timeLeft;
  }
  
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeftElement) {
      timeLeftElement.textContent = timeLeft;
    }
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
    }
  }, 1000);
}

console.log('✓ Game.js loaded and initialized');