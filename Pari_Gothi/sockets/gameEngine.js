/**
 * gameEngine.js
 * Authoritative real-time game engine for Quiz Battle Arena.
 * Manages question clocks, server-side scoring, anti-cheat validation, round transitions, and leaderboards.
 */

const path = require('path');
const fs = require('fs');
const { getRoom, deleteRoom } = require('./lobbyHandler');

// Load question bank from data/questions.json
const questionsPath = path.join(__dirname, '..', 'data', 'questions.json');
let questions = [];

try {
  const rawData = fs.readFileSync(questionsPath, 'utf8');
  questions = JSON.parse(rawData);
  console.log(`[GameEngine] Loaded ${questions.length} trivia questions from questions.json`);
} catch (err) {
  console.error('[GameEngine] Failed to load questions.json, using fallback bank:', err.message);
  questions = [
    {
      id: 1,
      question: "What JavaScript engine powers the Node.js runtime?",
      options: ["V8 (Google)", "SpiderMonkey (Mozilla)", "JavaScriptCore (Apple)", "Chakra (Microsoft)"],
      correctOptionIndex: 0,
      explanation: "Node.js is built on Google Chrome's open-source V8 high-performance JavaScript engine."
    },
    {
      id: 2,
      question: "Which protocol does Socket.io upgrade to for persistent full-duplex communication?",
      options: ["HTTP/2 Polling", "WebSocket", "gRPC over TCP", "Server-Sent Events (SSE)"],
      correctOptionIndex: 1,
      explanation: "Socket.io establishes an initial HTTP long-polling handshake and upgrades to bidirectional WebSockets."
    }
  ];
}

/**
 * Server-side authoritative speed-based scoring algorithm.
 * @param {boolean} isCorrect - Whether chosen option matches correctOptionIndex
 * @param {number} timeTakenMs - Milliseconds elapsed since question start
 * @param {number} totalTimeLimitMs - Total time limit in milliseconds (default 15000)
 * @returns {number} Calculated score between 0 and 1000
 */
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  const timeRemaining = Math.max(0, totalTimeLimitMs - timeTakenMs);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500); // up to 500 bonus points
  const baseScore = 500;
  return baseScore + speedBonus; // max 1000 points per question
}

/**
 * Generates sorted leaderboard array from active room players.
 * @param {object} room
 * @returns {Array<{ rank: number, name: string, score: number, connected: boolean, lastRoundScore: number }>}
 */
function getSortedLeaderboard(room) {
  if (!room || !room.players) return [];
  const playerList = Array.from(room.players.values());
  playerList.sort((a, b) => b.score - a.score);
  return playerList.map((p, idx) => ({
    rank: idx + 1,
    name: p.name,
    score: p.score,
    connected: p.connected,
    lastRoundScore: p.lastRoundScore || 0
  }));
}

/**
 * Starts the quiz game sequence for a room.
 * @param {object} io - Socket.io Server instance
 * @param {string} pin - 4-digit room PIN
 */
function startGame(io, pin) {
  const room = getRoom(pin);
  if (!room) return { success: false, message: 'Room not found' };

  if (room.players.size === 0) {
    return { success: false, message: 'Cannot start game without players in lobby' };
  }

  room.state = 'IN_PROGRESS';
  room.currentQuestionIndex = 0;
  console.log(`[GameEngine] Quiz started for Room ${pin} with ${room.players.size} players.`);

  sendQuestion(io, pin);
  return { success: true };
}

/**
 * Broadcasts the current question to the room and starts server-authoritative countdown.
 * @param {object} io
 * @param {string} pin
 */
function sendQuestion(io, pin) {
  const room = getRoom(pin);
  if (!room || room.state !== 'IN_PROGRESS') return;

  const qIdx = room.currentQuestionIndex;
  if (qIdx >= questions.length) {
    endQuiz(io, pin);
    return;
  }

  const currentQ = questions[qIdx];

  // Reset round state for all players
  for (const [, player] of room.players.entries()) {
    player.answeredThisRound = false;
    player.selectedOption = null;
    player.lastRoundScore = 0;
  }

  room.isAcceptingAnswers = true;
  room.questionStartTime = Date.now();
  room.timeLimitSeconds = 15;

  // Clear any existing active timer
  if (room.timerId) {
    clearTimeout(room.timerId);
    room.timerId = null;
  }
  if (room.nextStepTimerId) {
    clearTimeout(room.nextStepTimerId);
    room.nextStepTimerId = null;
  }

  // Broadcast question to room - CRITICAL: Withhold correctOption / correctOptionIndex to prevent cheating
  io.to(`room_${pin}`).emit('question:start', {
    questionIndex: qIdx + 1,
    totalQuestions: questions.length,
    question: currentQ.question,
    options: currentQ.options,
    timeLimitSeconds: room.timeLimitSeconds
  });

  // Emit initial answer count (0 / total)
  broadcastAnswerCount(io, room);

  console.log(`[GameEngine] Room ${pin} -> Question ${qIdx + 1}/${questions.length} started.`);

  // Authoritative server-side 15-second countdown timer
  room.timerId = setTimeout(() => {
    handleTimeUp(io, pin);
  }, room.timeLimitSeconds * 1000);
}

/**
 * Broadcasts how many active players have answered the current question.
 * @param {object} io
 * @param {object} room
 */
function broadcastAnswerCount(io, room) {
  if (!room) return;
  const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
  const answeredCount = connectedPlayers.filter(p => p.answeredThisRound).length;
  io.to(`room_${room.pin}`).emit('answer:count_update', {
    answeredCount,
    totalPlayers: connectedPlayers.length
  });
}

/**
 * Validates and processes a player's answer submission.
 * @param {object} io
 * @param {string} socketId
 * @param {object} payload - { pin, selectedOption, timeTakenMs }
 * @returns {object} { success: boolean, message?: string, score?: number }
 */
function handleAnswerSubmit(io, socketId, payload) {
  const { pin, selectedOption } = payload || {};
  const room = getRoom(pin);

  if (!room) {
    return { success: false, message: 'Room not found.' };
  }

  if (room.state !== 'IN_PROGRESS') {
    return { success: false, message: 'Quiz is not currently in progress.' };
  }

  const player = room.players.get(socketId);
  if (!player) {
    return { success: false, message: 'Player is not registered in this room.' };
  }

  if (player.answeredThisRound) {
    return { success: false, message: 'Answer already submitted for this question.' };
  }

  // Anti-Cheat: Reject answers if server has closed the answer window
  if (!room.isAcceptingAnswers) {
    return { success: false, message: 'Time is up! Submissions are closed.' };
  }

  const serverTimeElapsedMs = Date.now() - room.questionStartTime;
  const totalLimitMs = room.timeLimitSeconds * 1000;

  // Enforce server deadline with a 350ms network latency grace threshold
  if (serverTimeElapsedMs > totalLimitMs + 350) {
    return { success: false, message: 'Submission rejected: Server timer expired.' };
  }

  const currentQ = questions[room.currentQuestionIndex];
  if (!currentQ) {
    return { success: false, message: 'Invalid question state.' };
  }

  const isCorrect = Number(selectedOption) === currentQ.correctOptionIndex;
  const actualTimeTakenMs = Math.min(serverTimeElapsedMs, totalLimitMs);
  const pointsAwarded = calculateScore(isCorrect, actualTimeTakenMs, totalLimitMs);

  player.answeredThisRound = true;
  player.selectedOption = selectedOption;
  player.lastRoundScore = pointsAwarded;
  player.score += pointsAwarded;

  console.log(`[GameEngine] Room ${pin} -> ${player.name} answered option ${selectedOption} (${isCorrect ? 'CORRECT' : 'WRONG'}) in ${actualTimeTakenMs}ms: +${pointsAwarded} pts. Total: ${player.score}`);

  // Broadcast updated answer count
  broadcastAnswerCount(io, room);

  // Send private feedback to submitting player
  io.to(socketId).emit('answer:feedback', {
    success: true,
    isCorrect,
    pointsAwarded,
    totalScore: player.score,
    timeTakenMs: actualTimeTakenMs
  });

  // If all connected players have answered, trigger early time_up after a brief 800ms pause
  const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
  const allAnswered = connectedPlayers.length > 0 && connectedPlayers.every(p => p.answeredThisRound);

  if (allAnswered && room.timerId) {
    clearTimeout(room.timerId);
    room.timerId = setTimeout(() => {
      handleTimeUp(io, pin);
    }, 800);
  }

  return { success: true, pointsAwarded, isCorrect };
}

/**
 * Handles expiration of question timer: reveals correct answer, shows explanations, and transitions.
 * @param {object} io
 * @param {string} pin
 */
function handleTimeUp(io, pin) {
  const room = getRoom(pin);
  if (!room || room.state !== 'IN_PROGRESS') return;

  room.isAcceptingAnswers = false;
  if (room.timerId) {
    clearTimeout(room.timerId);
    room.timerId = null;
  }

  const currentQ = questions[room.currentQuestionIndex];
  if (!currentQ) return;

  console.log(`[GameEngine] Room ${pin} -> Time up for question ${room.currentQuestionIndex + 1}. Correct: ${currentQ.correctOptionIndex}`);

  // 1. Broadcast correct answer and explanation to the room
  io.to(`room_${pin}`).emit('question:time_up', {
    correctOption: currentQ.correctOptionIndex,
    explanation: currentQ.explanation
  });

  // 2. After 4.5 seconds of answer reveal, broadcast the updated dynamic leaderboard
  room.nextStepTimerId = setTimeout(() => {
    const leaderboard = getSortedLeaderboard(room);
    io.to(`room_${pin}`).emit('leaderboard:update', { leaderboard });
    console.log(`[GameEngine] Room ${pin} -> Broadcasted leaderboard.`);

    // 3. After 4.5 seconds on leaderboard, advance to next question or end quiz
    room.nextStepTimerId = setTimeout(() => {
      room.currentQuestionIndex++;
      if (room.currentQuestionIndex < questions.length) {
        sendQuestion(io, pin);
      } else {
        endQuiz(io, pin);
      }
    }, 4500);
  }, 4500);
}

/**
 * Concludes the quiz, determines the winner, and emits final ranks.
 * @param {object} io
 * @param {string} pin
 */
function endQuiz(io, pin) {
  const room = getRoom(pin);
  if (!room) return;

  room.state = 'FINISHED';
  if (room.timerId) clearTimeout(room.timerId);
  if (room.nextStepTimerId) clearTimeout(room.nextStepTimerId);

  const finalRanks = getSortedLeaderboard(room);
  const winner = finalRanks.length > 0 ? { name: finalRanks[0].name, score: finalRanks[0].score } : { name: 'None', score: 0 };

  console.log(`[GameEngine] Room ${pin} -> Quiz ended! Winner: ${winner.name} (${winner.score} pts)`);

  io.to(`room_${pin}`).emit('quiz:ended', {
    winner,
    finalRanks
  });
}

/**
 * Handles host disconnection.
 * Gives a 20-second grace window to reconnect, or cleans up the room and notifies players.
 * @param {object} io
 * @param {string} pin
 */
function handleHostDisconnect(io, pin) {
  const room = getRoom(pin);
  if (!room) return;

  console.log(`[GameEngine] Room ${pin} -> Host disconnected.`);

  if (room.state === 'LOBBY') {
    io.to(`room_${pin}`).emit('quiz:aborted', {
      message: 'Host has closed or left the room.'
    });
    deleteRoom(pin);
  } else if (room.state === 'IN_PROGRESS') {
    io.to(`room_${pin}`).emit('host:status_change', {
      connected: false,
      message: 'Host disconnected. Room will terminate in 20 seconds if host does not reconnect.'
    });

    room.hostDisconnectTimerId = setTimeout(() => {
      const currentRoom = getRoom(pin);
      if (currentRoom && currentRoom.state !== 'FINISHED') {
        io.to(`room_${pin}`).emit('quiz:aborted', {
          message: 'Game ended due to host disconnection.'
        });
        deleteRoom(pin);
      }
    }, 20000);
  }
}

module.exports = {
  questions,
  calculateScore,
  getSortedLeaderboard,
  startGame,
  sendQuestion,
  handleAnswerSubmit,
  handleTimeUp,
  endQuiz,
  handleHostDisconnect
};
