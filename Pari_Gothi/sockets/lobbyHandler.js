/**
 * lobbyHandler.js
 * In-memory room and lobby management for Quiz Battle Arena.
 * Handles room creation, collision-free PIN generation, player join/leave, and roster management.
 */

// In-memory store for all active rooms keyed by 4-digit PIN
const rooms = new Map();

/**
 * Generates a unique 4-digit numeric PIN not currently in use.
 * @returns {string} 4-digit PIN string (e.g. "4821")
 */
function generateUniquePin() {
  let pin;
  let attempts = 0;
  do {
    // Generate 4-digit number between 1000 and 9999
    pin = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
    if (attempts > 10000) {
      throw new Error('Maximum room capacity reached');
    }
  } while (rooms.has(pin));
  return pin;
}

/**
 * Creates a new quiz room for a host.
 * @param {string} hostSocketId - Socket ID of host
 * @param {string} hostName - Display name of host
 * @param {string} category - Selected quiz category
 * @returns {object} Room metadata including pin and roomId
 */
function createRoom(hostSocketId, hostName = 'Host', category = 'General Tech') {
  const pin = generateUniquePin();
  const roomId = `quiz_${pin}`;

  const room = {
    pin,
    roomId,
    hostSocketId,
    hostName: hostName || 'Host',
    category: category || 'General Tech',
    state: 'LOBBY', // 'LOBBY', 'IN_PROGRESS', 'PAUSED', 'FINISHED'
    players: new Map(), // socketId -> { socketId, name, score, connected, answeredThisRound, lastRoundScore }
    currentQuestionIndex: 0,
    isAcceptingAnswers: false,
    questionStartTime: null,
    timeLimitSeconds: 15,
    timerId: null,
    nextStepTimerId: null,
    hostDisconnectTimerId: null,
    createdAt: Date.now()
  };

  rooms.set(pin, room);
  return { pin, roomId, room };
}

/**
 * Retrieves a room by its 4-digit PIN.
 * @param {string} pin
 * @returns {object|null}
 */
function getRoom(pin) {
  if (!pin) return null;
  return rooms.get(pin.toString().trim()) || null;
}

/**
 * Finds which room a given socket ID belongs to (either as host or player).
 * @param {string} socketId
 * @returns {{ room: object, role: 'host'|'player', player?: object }|null}
 */
function findRoomBySocketId(socketId) {
  for (const [pin, room] of rooms.entries()) {
    if (room.hostSocketId === socketId) {
      return { room, role: 'host' };
    }
    if (room.players.has(socketId)) {
      return { room, role: 'player', player: room.players.get(socketId) };
    }
  }
  return null;
}

/**
 * Adds a player to a room's lobby.
 * @param {string} pin
 * @param {string} socketId
 * @param {string} playerName
 * @returns {{ success: boolean, message?: string, player?: object }}
 */
function joinRoom(pin, socketId, playerName) {
  const room = getRoom(pin);
  if (!room) {
    return { success: false, message: `Room with PIN ${pin} does not exist.` };
  }

  if (room.state === 'FINISHED') {
    return { success: false, message: 'This quiz has already ended.' };
  }

  const cleanName = (playerName || 'Player').trim().slice(0, 20);

  // Check if player name already taken in this room by an active player
  for (const [, p] of room.players.entries()) {
    if (p.name.toLowerCase() === cleanName.toLowerCase() && p.connected && p.socketId !== socketId) {
      return { success: false, message: `The nickname "${cleanName}" is already taken in this room.` };
    }
  }

  const player = {
    socketId,
    name: cleanName,
    score: 0,
    connected: true,
    answeredThisRound: false,
    lastRoundScore: 0,
    selectedOption: null
  };

  room.players.set(socketId, player);
  return { success: true, room, player };
}

/**
 * Removes or marks a player disconnected.
 * @param {string} pin
 * @param {string} socketId
 * @returns {object|null} Updated room
 */
function removePlayer(pin, socketId) {
  const room = getRoom(pin);
  if (!room) return null;

  if (room.state === 'LOBBY') {
    room.players.delete(socketId);
  } else {
    const player = room.players.get(socketId);
    if (player) {
      player.connected = false;
    }
  }
  return room;
}

/**
 * Destroys a room and cleans up all active timers.
 * @param {string} pin
 */
function deleteRoom(pin) {
  const room = getRoom(pin);
  if (room) {
    if (room.timerId) clearTimeout(room.timerId);
    if (room.nextStepTimerId) clearTimeout(room.nextStepTimerId);
    if (room.hostDisconnectTimerId) clearTimeout(room.hostDisconnectTimerId);
    rooms.delete(pin);
  }
}

/**
 * Formats the player list for lobby updates.
 * @param {object} room
 * @returns {Array<{ name: string, score: number, connected: boolean }>}
 */
function getLobbyPlayers(room) {
  const playerList = [];
  for (const [, p] of room.players.entries()) {
    if (p.connected || room.state !== 'LOBBY') {
      playerList.push({
        name: p.name,
        score: p.score,
        connected: p.connected
      });
    }
  }
  return playerList;
}

module.exports = {
  rooms,
  generateUniquePin,
  createRoom,
  getRoom,
  findRoomBySocketId,
  joinRoom,
  removePlayer,
  deleteRoom,
  getLobbyPlayers
};
