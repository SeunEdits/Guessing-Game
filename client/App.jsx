// This file will contain the main React component for the guessing game chat interface
// For now, this is a placeholder. The full implementation will follow after backend logic.

import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

function App() {
  const [sessionId, setSessionId] = useState('');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [masterId, setMasterId] = useState(null);
  const [scores, setScores] = useState({});
  const [isMaster, setIsMaster] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [guess, setGuess] = useState('');
  const [messages, setMessages] = useState([]);
  const [winner, setWinner] = useState(null);
  const [gameAnswer, setGameAnswer] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(3);
  const [error, setError] = useState('');

  // Join session
  const handleJoin = () => {
    setError('');
    socket.emit('joinSession', { sessionId, name }, (res) => {
      if (res.error) setError(res.error);
      else {
        setJoined(true);
        setIsMaster(res.master);
      }
    });
  };

  // Leave session
  const handleLeave = () => {
    socket.emit('leaveSession', { sessionId });
    setJoined(false);
    setIsMaster(false);
    setPlayers([]);
    setScores({});
    setQuestion('');
    setAnswer('');
    setGameStarted(false);
    setWinner(null);
    setGameAnswer('');
    setAttemptsLeft(3);
    setMessages([]);
  };

  // Set question/answer (master only)
  const handleSetQuestion = () => {
    if (!question || !answer) return setError('Enter question and answer');
    socket.emit('setQuestion', { sessionId, question, answer }, (res) => {
      if (res.error) setError(res.error);
      else setError('Question set!');
    });
  };

  // Start game (master only)
  const handleStartGame = () => {
    socket.emit('startGame', { sessionId }, (res) => {
      if (res.error) setError(res.error);
      else {
        setGameStarted(true);
        setWinner(null);
        setGameAnswer('');
        setAttemptsLeft(3);
        setMessages([]);
      }
    });
  };

  // Submit guess (player only)
  const handleGuess = () => {
    if (!guess) return;
    socket.emit('guess', { sessionId, guess }, (res) => {
      if (res.error) setError(res.error);
      else {
        setAttemptsLeft(res.attempts ?? attemptsLeft);
        if (res.correct) setError('Correct!');
        else setError('Wrong!');
      }
    });
    setGuess('');
  };

  // Socket event listeners
  useEffect(() => {
    socket.on('sessionUpdate', ({ players, masterId, scores }) => {
      setPlayers(players);
      setMasterId(masterId);
      setScores(scores);
      setIsMaster(socket.id === masterId);
    });
    socket.on('questionSet', ({ question }) => {
      setQuestion(question);
      setMessages(msgs => [...msgs, { type: 'info', text: 'Question set by master.' }]);
    });
    socket.on('gameStarted', ({ question }) => {
      setGameStarted(true);
      setQuestion(question);
      setWinner(null);
      setGameAnswer('');
      setAttemptsLeft(3);
      setMessages(msgs => [...msgs, { type: 'info', text: 'Game started!' }]);
    });
    socket.on('gameEnd', ({ winner, answer, scores }) => {
      setGameStarted(false);
      setWinner(winner);
      setGameAnswer(answer);
      setScores(scores);
      setMessages(msgs => [...msgs, { type: 'info', text: winner ? `Player ${players.find(p=>p.id===winner)?.name || winner} won!` : 'No winner.' }]);
    });
    return () => {
      socket.off('sessionUpdate');
      socket.off('questionSet');
      socket.off('gameStarted');
      socket.off('gameEnd');
    };
    // eslint-disable-next-line
  }, [players]);

  // UI
  if (!joined) {
    return (
      <div style={{ maxWidth: 400, margin: '2rem auto', padding: 20, border: '1px solid #ccc', borderRadius: 8 }}>
        <h2>Join a Game Session</h2>
        <input placeholder="Session ID" value={sessionId} onChange={e => setSessionId(e.target.value)} />
        <input placeholder="Your Name" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={handleJoin}>Join</button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: 20, border: '1px solid #ccc', borderRadius: 8 }}>
      <h2>Session: {sessionId}</h2>
      <div>Welcome, {name} {isMaster && <b>(Game Master)</b>}</div>
      <button onClick={handleLeave}>Leave Session</button>
      <hr />
      <div>
        <b>Players ({players.length}):</b> {players.map(p => <span key={p.id} style={{ marginRight: 8 }}>{p.name}{p.id === masterId ? ' 👑' : ''}</span>)}
      </div>
      <div>
        <b>Scores:</b> {Object.entries(scores).map(([id, score]) => <span key={id} style={{ marginRight: 8 }}>{players.find(p=>p.id===id)?.name || id}: {score}</span>)}
      </div>
      <hr />
      {isMaster && !gameStarted && (
        <div style={{ marginBottom: 16 }}>
          <h4>Set Question & Answer</h4>
          <input placeholder="Question" value={question} onChange={e => setQuestion(e.target.value)} />
          <input placeholder="Answer" value={answer} onChange={e => setAnswer(e.target.value)} />
          <button onClick={handleSetQuestion}>Set</button>
          <button onClick={handleStartGame} style={{ marginLeft: 8 }}>Start Game</button>
        </div>
      )}
      {!isMaster && gameStarted && (
        <div style={{ marginBottom: 16 }}>
          <h4>Question:</h4>
          <div>{question}</div>
          <input placeholder="Your Guess" value={guess} onChange={e => setGuess(e.target.value)} disabled={winner || attemptsLeft === 0} />
          <button onClick={handleGuess} disabled={winner || attemptsLeft === 0}>Guess</button>
          <div>Attempts left: {attemptsLeft}</div>
        </div>
      )}
      {gameStarted && winner && (
        <div style={{ color: 'green' }}>Winner: {players.find(p=>p.id===winner)?.name || winner} | Answer: {gameAnswer}</div>
      )}
      {gameStarted && !winner && (
        <div style={{ color: 'orange' }}>Game in progress...</div>
      )}
      {!gameStarted && gameAnswer && (
        <div style={{ color: winner ? 'green' : 'red' }}>Game ended. {winner ? `Winner: ${players.find(p=>p.id===winner)?.name}` : 'No winner.'} | Answer: {gameAnswer}</div>
      )}
      <div style={{ marginTop: 16 }}>
        <b>Messages:</b>
        <div style={{ minHeight: 40 }}>
          {messages.map((msg, i) => <div key={i} style={{ color: msg.type === 'info' ? 'blue' : 'black' }}>{msg.text}</div>)}
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}

export default App;
