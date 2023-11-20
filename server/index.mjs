// Import necessary modules and set up the server
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const emit = function (socket, ev, ...args) {
  console.log(`Emiting ${ev} to ${socket.id} with data: ${args}`);
  socket.emit(ev, ...args);
}

const broadcast = function (room, ev, ...args) {
  console.log(`Broadcasting ${ev} to room ${room} with data: ${args}`);
  io.to(room).emit(ev, ...args);
}

const userSessions = {};
const registeredUsers = {};
const auctions = {};

function getUserIdFromCookie(cookie) {
  const userId = parseCookie(cookie);
  return userId ?? false;
}

function parseCookie(cookie) {
  try {
    const cookieData = {}; // Placeholder for parsed data
    const parts = cookie.split(';');
    for (const part of parts) {
      const [key, value] = part.trim().split('=');
      cookieData[key] = value;
    }
    return cookieData['userId'];
  } catch {
    return null;
  }
}

function generateNewCookie() {
  const userId = uuidv4();
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 1); // Expires in 1 day
  const expirationDateString = expirationDate.toUTCString();
  const newCookie = `userId=${userId}; expires=${expirationDateString}; path=/`;
  return newCookie;
}

function getParticipants(auctionId) {
  const participants = Object.values(registeredUsers)
    .filter(user => user.auctionId === auctionId && !user.master)
    .map(user => user.name);
  return participants;
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('register', ({ name, auctionId }) => {
    console.log(`Register event received from ${socket.id} with name: ${name}`);
    const userId = userSessions[socket.id];
    const duplicateNames = Object.values(registeredUsers)
      .filter(user => user.auctionId === auctionId && user.name === name);

    if (duplicateNames.length > 0) {
      emit(socket, 'retryRegister', true);
      console.log(`Duplicated Name ${name}`);
      return;
    }

    let isFirstRegister = Object.values(registeredUsers).findIndex(user => {
      return user.id !== userId && user.auctionId === auctionId;
    }) === -1;
    if (!isFirstRegister && auctions[auctionId] !== null) {
      isFirstRegister = auctions[auctionId].master == userId;
    }
    socket.join(auctionId);
    if (isFirstRegister) {
      console.log(`User ${socket.id} is the master for auctionId: ${auctionId}`);
      auctions[auctionId] = { status: 0, master: userId, invader: null };
    }
    if (auctions[auctionId].status == 0) {
      registeredUsers[userId] = { id: userId, name, auctionId, master: isFirstRegister };
    } else {
      emit(socket, 'auctionAlreadyStarted', true);
    }
    emit(socket, 'registrationSuccess', name, isFirstRegister);
    let participants = getParticipants(auctionId);
    console.log(participants);
    broadcast(auctionId, 'updateParticipants', participants);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete userSessions[socket.id]
  });

  socket.on('exitAuction', () => {
    console.log(`User exited the auction: ${socket.id}`);
    const userId = userSessions[socket.id];
    delete registeredUsers[userId];
  });

  socket.on('auth', (cookie, auctionId) => {
    // Check if the received cookie is associated with any user
    let userId = getUserIdFromCookie(cookie);

    if (userId && registeredUsers[userId]) {
      // Reconnect the client if the cookie is valid and associated with a user
      registeredUsers[userId].socketId = socket.id;
      if (auctionId == registeredUsers[userId].auctionId) {
        socket.join(registeredUsers[userId].auctionId);

        // Emit event to update participants after successful reconnection
        const participants = getParticipants(registeredUsers[userId].auctionId);
        broadcast(registeredUsers[userId].auctionId, 'updateParticipants', participants);

        emit(socket, 'reconnectSuccess', true);
        console.log(`Emit reconnectSuccess to ${socket.id}`);
        emit(socket, 'registrationSuccess', registeredUsers[userId].name, registeredUsers[userId].master);
        if (auctions[registeredUsers[userId].auctionId].status == 1) {
          emit(socket, "startingAuction");
        }
      } else {
        emit(socket, "wrongAuction", registeredUsers[userId].auctionId);
      }
    } else {
      const newCookie = generateNewCookie();
      userId = getUserIdFromCookie(newCookie);
      emit(socket, 'newCookie', newCookie);
      console.log(`Emit newCookie to ${socket.id}`);
    }
    userSessions[socket.id] = userId;
  });

  socket.on('checkAuth', (cookie, auctionId) => {
    // Check if the received cookie is associated with any user
    let userId = getUserIdFromCookie(cookie);

    if (userId && registeredUsers[userId]) {
      // Reconnect the client if the cookie is valid and associated with a user
      registeredUsers[userId].socketId = socket.id;
      if (auctionId != registeredUsers[userId].auctionId) {
        emit(socket, "wrongAuction", registeredUsers[userId].auctionId);
      }
    }
  });

  socket.on('tick', (price) => {
    try {
      const userId = userSessions[socket.id];
      broadcast(registeredUsers[userId].auctionId, 'tick', price);
    } catch (error) {
      console.log('Error registered:', error);
    }
  });

  socket.on('startAuction', () => {
    const userId = userSessions[socket.id];
    auctions[registeredUsers[userId].auctionId].status = 1;
    setTimeout(() => {
      broadcast(registeredUsers[userId].auctionId, 'startingAuction');
    }, 3000);
  });

  socket.on('endAuction', (price) => {
    const userId = userSessions[socket.id];
    auctions[registeredUsers[userId].auctionId].status = 0;
    let buyer = registeredUsers[userId].name;
    if (auctions[registeredUsers[userId].auctionId].invader !== null) {
      buyer = auctions[registeredUsers[userId].auctionId].invader;
      price = (price * 1) + 1;
    }
    broadcast(registeredUsers[userId].auctionId, 'endAuction', buyer, price);
  });

  socket.on('invade', (username) => {
    const userId = userSessions[socket.id];
    auctions[registeredUsers[userId].auctionId].invader = username;
  });

});

const PORT = 8585;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
