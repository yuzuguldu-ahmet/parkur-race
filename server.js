// ---- Parkur Yarışı - Gerçek Zamanlı Sunucu ----
// Bu sunucu, odalar (parti) oluşturur, oyuncuları eşleştirir ve
// yarış sırasında herkesin ilerlemesini (mesafesini) diğer oyunculara
// anlık olarak iletir. Parkurun kendisi (engeller) her istemcide aynı
// "seed" (tohum) ile üretildiği için oyuncular ayrı ayrı oynasa da
// aynı parkuru görür.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // Basit bir hobi projesi için tüm kaynaklara izin veriyoruz
});

app.get('/', (req, res) => {
  res.send('Parkur Yarışı sunucusu çalışıyor 🏁');
});

// odaKodu -> { hostId, seed, started, finishDistance, players: Map(socketId -> {name, distance, finished, finishTime, placement}) }
const rooms = new Map();

const FINISH_DISTANCE = 3000;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilecek harfler (I, O, 0, 1) çıkarıldı
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function roomPlayerList(room) {
  return Array.from(room.players.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    character: p.character,
    distance: p.distance,
    finished: p.finished,
    placement: p.placement
  }));
}

function broadcastPlayerList(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('room-update', {
    players: roomPlayerList(room),
    hostId: room.hostId
  });
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('create-room', ({ name, character }) => {
    const code = generateRoomCode();
    const seed = Math.floor(Math.random() * 1e9);
    rooms.set(code, {
      hostId: socket.id,
      seed,
      started: false,
      finishDistance: FINISH_DISTANCE,
      players: new Map([[socket.id, { name: (name || 'Oyuncu').slice(0, 14), character: character || 'Kaykaycı Kai', distance: 0, finished: false, finishTime: null, placement: null }]])
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room-created', { code, seed, finishDistance: FINISH_DISTANCE, isHost: true });
    broadcastPlayerList(code);
  });

  socket.on('join-room', ({ code, name, character }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('join-error', { message: 'Böyle bir oda bulunamadı.' });
      return;
    }
    if (room.started) {
      socket.emit('join-error', { message: 'Bu yarış zaten başladı.' });
      return;
    }
    if (room.players.size >= 8) {
      socket.emit('join-error', { message: 'Oda dolu (maks. 8 kişi).' });
      return;
    }
    room.players.set(socket.id, { name: (name || 'Oyuncu').slice(0, 14), character: character || 'Kaykaycı Kai', distance: 0, finished: false, finishTime: null, placement: null });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room-joined', {
      code,
      seed: room.seed,
      finishDistance: room.finishDistance,
      isHost: room.hostId === socket.id
    });
    broadcastPlayerList(code);
  });

  socket.on('start-race', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.started = true;
    // Küçük bir gecikmeyle başlat ki herkesin ekranında geri sayım aynı anda görünsün
    const startAt = Date.now() + 3000;
    io.to(code).emit('race-started', { startAt });
  });

  socket.on('update-progress', ({ distance }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const player = room.players.get(socket.id);
    if (!player || player.finished) return;
    player.distance = Math.max(player.distance, Math.min(distance, room.finishDistance));
    broadcastPlayerList(code);
  });

  socket.on('finish-race', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.finished = true;
    player.distance = room.finishDistance;
    player.finishTime = Date.now();

    const alreadyFinished = Array.from(room.players.values()).filter(p => p.finished).length;
    player.placement = alreadyFinished; // bu oyuncudan önce bitirenler + kendisi

    broadcastPlayerList(code);

    const allFinished = Array.from(room.players.values()).every(p => p.finished);
    if (allFinished) {
      io.to(code).emit('race-over');
    }
  });

  socket.on('leave-room', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });

  function handleLeave(socket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);
    socket.data.roomCode = null;

    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }

    // Host ayrıldıysa yeni host ata (odadaki ilk oyuncu)
    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value;
    }

    broadcastPlayerList(code);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Parkur Yarışı sunucusu ${PORT} portunda çalışıyor`);
});
