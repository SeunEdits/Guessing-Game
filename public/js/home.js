console.log('Home page loaded');

document.getElementById('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const playerName = document.getElementById('playerName').value.trim();
  let sessionId = document.getElementById('sessionId').value.trim();
  
  console.log('Form submitted:', { playerName, sessionId });
  
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  
  // Generate random session ID if not provided
  if (!sessionId) {
    sessionId = generateSessionId();
    console.log('Generated session ID:', sessionId);
  }
  
  // Store player name in session storage
  sessionStorage.setItem('playerName', playerName);
  console.log('Player name stored in sessionStorage');
  
  // Redirect to game page
  console.log('Redirecting to game page:', `/game/${sessionId}`);
  window.location.href = `/game/${sessionId}`;
});

function generateSessionId() {
  return 'game-' + Math.random().toString(36).substring(2, 9);
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.classList.add('show');
  
  setTimeout(() => {
    errorDiv.classList.remove('show');
  }, 3000);
}

console.log('Home.js loaded successfully');