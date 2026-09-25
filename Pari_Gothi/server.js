/**
 * server.js
 * Express & Socket.io server bootstrap for Real-Time Multiplayer Quiz Arena.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const {
  createRoom,
  getRoom,
  findRoomBySocketId,
  joinRoom,
  removePlayer,
  getLobbyPlayers,
  deleteRoom
} = require('./sockets/lobbyHandler');

const {
  startGame,
  handleAnswerSubmit,
  handleHostDisconnect
} = require('./sockets/gameEngine');

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins so clients connecting across Render URLs / dev environments connect smoothly
app.use(cors());
app.use(express.json());

// Serve static frontend files from /public directory
app.use(express.static(path.join(__dirname, 'public')));

// Basic Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Quiz Battle Arena Server is running' });
});

// Initialize Socket.io with permissive CORS for robust client connectivity
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

// Socket.io Connection & Event Routing
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  /**
   * quiz:create (Host -> Server)
   * Host initializes a new quiz room
   */
  socket.on('quiz:create', ({ hostName, category } = {}) => {
    try {
      const { pin, roomId, room } = createRoom(socket.id, hostName, category);
      socket.join(`room_${pin}`);

      console.log(`[Lobby] Host "${room.hostName}" (${socket.id}) created room PIN: ${pin}`);

      // Respond back to host with generated PIN & room ID
      socket.emit('quiz:created', { pin, roomId });
      // Emit initial empty lobby roster to the room
      io.to(`room_${pin}`).emit('lobby:update', {
        players: getLobbyPlayers(room)
      });
    } catch (err) {
      console.error('[Lobby] Error creating room:', err.message);
      socket.emit('quiz:error', { message: 'Failed to create quiz room.' });
    }
  });

  /**
   * quiz:join (Player -> Server)
   * Player enters lobby using 4-digit PIN
   */
  socket.on('quiz:join', ({ pin, playerName } = {}) => {
    const result = joinRoom(pin, socket.id, playerName);

    if (!result.success) {
      socket.emit('quiz:join_error', { message: result.message });
      return;
    }

    const { room, player } = result;
    socket.join(`room_${pin}`);

    console.log(`[Lobby] Player "${player.name}" joined room PIN: ${pin}`);

    // Confirm join to the player
    socket.emit('quiz:joined', {
      pin: room.pin,
      playerName: player.name,
      roomState: room.state
    });

    // Broadcast updated player roster to all room participants (Host + Players)
    io.to(`room_${pin}`).emit('lobby:update', {
      players: getLobbyPlayers(room)
    });
  });

  /**
   * quiz:start (Host -> Server)
   * Host starts the quiz battle
   */
  socket.on('quiz:start', ({ pin } = {}) => {
    const room = getRoom(pin);
    if (!room) {
      socket.emit('quiz:error', { message: 'Room not found.' });
      return;
    }

    if (room.hostSocketId !== socket.id) {
      socket.emit('quiz:error', { message: 'Only the host can start the game.' });
      return;
    }

    const result = startGame(io, pin);
    if (!result.success) {
      socket.emit('quiz:error', { message: result.message });
    }
  });

  /**
   * answer:submit (Player -> Server)
   * Player submits chosen option
   */
  socket.on('answer:submit', (payload) => {
    handleAnswerSubmit(io, socket.id, payload);
  });

  /**
   * Handle Socket Disconnect
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
    const found = findRoomBySocketId(socket.id);
    if (!found) return;

    const { room, role, player } = found;

    if (role === 'host') {
      handleHostDisconnect(io, room.pin);
    } else if (role === 'player') {
      console.log(`[Lobby] Player "${player.name}" disconnected from room ${room.pin}`);
      removePlayer(room.pin, socket.id);
      if (room.state === 'LOBBY') {
        io.to(`room_${room.pin}`).emit('lobby:update', {
          players: getLobbyPlayers(room)
        });
      }
    }
  });
});

// Read dynamic PORT from environment with 5000 as default
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Quiz Battle Arena Server Online!`);
  console.log(`📡 Listening on: http://localhost:${PORT}`);
  console.log(`🎮 Host Portal:   http://localhost:${PORT}/host.html`);
  console.log(`📱 Player Pad:    http://localhost:${PORT}/player.html`);
  console.log(`=========================================`);
});
