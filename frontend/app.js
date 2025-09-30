const express = require('express');
const path = require('path');

const app = express();

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/game/:sessionId', (req, res) => {
  console.log('Game page requested:', req.params.sessionId);
  res.render('games', { sessionId: req.params.sessionId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Frontend server running on http://localhost:${PORT}`);
  console.log('Make sure backend is running on http://localhost:4000');
});