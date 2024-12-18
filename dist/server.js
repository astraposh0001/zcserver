import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
// server/src/server.ts
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type']
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    cookie: {
        name: 'io',
        path: '/',
        httpOnly: true,
        sameSite: 'none',
        secure: true
    }
});
const users = new Map();
const rooms = new Map();
const queue = []; // Socket IDs of users waiting to be matched
function getBrowserInfo(userAgent) {
    // Simple user agent parsing
    const browser = userAgent.includes('Firefox') ? 'Firefox' :
        userAgent.includes('Chrome') ? 'Chrome' :
            userAgent.includes('Safari') ? 'Safari' : 'Unknown';
    const os = userAgent.includes('Windows') ? 'Windows' :
        userAgent.includes('Mac') ? 'Mac' :
            userAgent.includes('Linux') ? 'Linux' : 'Unknown';
    return { browser, os };
}
// Enhanced matching function with preferences
function findMatch(socketId, preferences) {
    // Skip users that are already in a room or disconnected
    const eligibleUsers = queue.filter(id => {
        const user = users.get(id);
        return id !== socketId && user && !user.roomId;
    });
    if (eligibleUsers.length === 0)
        return null;
    // For now, just pick a random user. Could be enhanced with preferences later
    const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
    const matchedId = eligibleUsers[randomIndex];
    // Remove matched user from queue
    const index = queue.indexOf(matchedId);
    if (index !== -1) {
        queue.splice(index, 1);
    }
    return matchedId;
}
function createRoom(user1Id, user2Id) {
    const roomId = randomUUID();
    console.log(`Creating room ${roomId} for users:`, user1Id, user2Id);
    const room = {
        id: roomId,
        users: [user1Id, user2Id],
        createdAt: Date.now()
    };
    rooms.set(roomId, room);
    // Update users with room info
    const user1 = users.get(user1Id);
    const user2 = users.get(user2Id);
    user1.roomId = roomId;
    user2.roomId = roomId;
    user1.inQueue = false;
    user2.inQueue = false;
    console.log(`Room ${roomId} created with users:`, {
        user1: { id: user1.id, socketId: user1.socketId },
        user2: { id: user2.id, socketId: user2.socketId }
    });
    return room;
}
function cleanupUser(socketId) {
    const user = users.get(socketId);
    if (!user)
        return;
    // Remove from queue
    const queueIndex = queue.indexOf(socketId);
    if (queueIndex !== -1) {
        queue.splice(queueIndex, 1);
    }
    // Handle room cleanup
    if (user.roomId) {
        const room = rooms.get(user.roomId);
        if (room) {
            // Notify other user in room
            const partnerId = room.users.find(id => id !== socketId);
            if (partnerId) {
                const partner = users.get(partnerId);
                if (partner) {
                    partner.roomId = undefined;
                    partner.inQueue = false;
                    io.to(partnerId).emit('peer-disconnected');
                }
            }
            rooms.delete(room.id);
        }
    }
    users.delete(socketId);
}
// Add this function to log room state
function logRoomState(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`Room ${roomId} not found`);
        return;
    }
    console.log(`Room ${roomId} state:`, {
        users: room.users.map(userId => {
            const user = users.get(userId);
            return user ? {
                id: user.id,
                socketId: user.socketId,
                inQueue: user.inQueue
            } : 'User not found';
        }),
        createdAt: new Date(room.createdAt).toISOString()
    });
}
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    // Create new user with device info
    const user = {
        id: randomUUID(),
        socketId: socket.id,
        inQueue: false,
        connectedAt: Date.now(),
        deviceInfo: {
            ...getBrowserInfo(socket.handshake.headers['user-agent'] || ''),
            network: socket.handshake.address
        }
    };
    users.set(socket.id, user);
    // Send initial state with queue info
    socket.emit('connection-success', {
        userId: user.id,
        activeUsers: users.size,
        queueInfo: queue.map(id => ({
            position: queue.indexOf(id) + 1,
            deviceInfo: users.get(id)?.deviceInfo
        }))
    });
    socket.on('leave-room', () => {
        console.log('User leaving room:', socket.id);
        const user = users.get(socket.id);
        if (!user?.roomId)
            return;
        const room = rooms.get(user.roomId);
        if (!room)
            return;
        // Notify other user in room
        const partnerId = room.users.find(id => id !== socket.id);
        if (partnerId) {
            const partner = users.get(partnerId);
            if (partner) {
                partner.roomId = undefined;
                partner.inQueue = false;
                io.to(partnerId).emit('peer-disconnected');
            }
        }
        // Clean up room
        rooms.delete(room.id);
        user.roomId = undefined;
        user.inQueue = false;
        console.log('Room cleaned up:', room.id);
    });
    socket.on('join-queue', (preferences) => {
        const user = users.get(socket.id);
        if (!user || user.inQueue || user.roomId) {
            console.log('Invalid join-queue request:', {
                userId: user?.id,
                inQueue: user?.inQueue,
                hasRoom: !!user?.roomId
            });
            return;
        }
        console.log('User joining queue:', socket.id);
        user.inQueue = true;
        queue.push(socket.id);
        const position = queue.indexOf(socket.id) + 1;
        // Notify user they're in queue
        socket.emit('queue-joined', {
            position,
            queueLength: queue.length
        });
        // Notify all users about queue update
        io.emit('queue-updated', {
            queueLength: queue.length,
            queueInfo: queue
                .map((id, index) => {
                const user = users.get(id);
                return user ? {
                    position: index + 1,
                    deviceInfo: user.deviceInfo || {
                        browser: 'Unknown',
                        os: 'Unknown',
                        network: 'Unknown'
                    }
                } : null;
            })
                .filter(Boolean)
        });
        // Try to find a match
        const matchedId = findMatch(socket.id, preferences);
        if (matchedId) {
            const room = createRoom(socket.id, matchedId);
            logRoomState(room.id);
            // Notify both users they've been matched
            io.to(socket.id).emit('matched', {
                roomId: room.id,
                initiator: true,
                peerInfo: users.get(matchedId)?.deviceInfo
            });
            io.to(matchedId).emit('matched', {
                roomId: room.id,
                initiator: false,
                peerInfo: users.get(socket.id)?.deviceInfo
            });
            console.log(`Users matched in room ${room.id}:`, socket.id, matchedId);
        }
    });
    socket.on('leave-queue', () => {
        const user = users.get(socket.id);
        if (!user || !user.inQueue)
            return;
        const index = queue.indexOf(socket.id);
        if (index !== -1) {
            queue.splice(index, 1);
            user.inQueue = false;
            socket.emit('queue-left');
            console.log('User left queue:', socket.id);
        }
    });
    socket.on('signal', (message) => {
        console.log(`Signaling: ${message.type} from ${socket.id}`);
        const user = users.get(socket.id);
        if (!user?.roomId) {
            console.error('User not in room:', socket.id);
            return;
        }
        const room = rooms.get(user.roomId);
        if (!room) {
            console.error('Room not found:', user.roomId);
            return;
        }
        // Find the recipient
        const recipientId = room.users.find(id => id !== socket.id);
        if (!recipientId) {
            console.error('Recipient not found in room:', room.id);
            return;
        }
        // Forward the signaling message with room info
        console.log(`Forwarding ${message.type} from ${socket.id} to ${recipientId} in room ${room.id}`);
        io.to(recipientId).emit('signal', {
            type: message.type,
            payload: message.payload,
            from: socket.id,
            roomId: room.id,
            timestamp: Date.now()
        });
    });
    socket.on('chat-message', (message) => {
        const user = users.get(socket.id);
        if (!user?.roomId)
            return;
        const room = rooms.get(user.roomId);
        if (!room)
            return;
        // Find the other user in the room
        const recipientId = room.users.find(id => id !== socket.id);
        if (!recipientId)
            return;
        // Forward the message to the other user
        io.to(recipientId).emit('chat-message', {
            id: randomUUID(),
            text: message.text,
            senderId: user.id,
            timestamp: message.timestamp
        });
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        cleanupUser(socket.id);
        // Broadcast updated user count
        io.emit('users-updated', {
            activeUsers: users.size,
            inQueue: queue.length
        });
    });
});
// Periodic cleanup of stale rooms and users
setInterval(() => {
    const now = Date.now();
    // Clean up rooms that are too old (e.g., 1 hour)
    rooms.forEach((room, roomId) => {
        if (now - room.createdAt > 60 * 60 * 1000) {
            room.users.forEach(userId => {
                const user = users.get(userId);
                if (user) {
                    user.roomId = undefined;
                    io.to(userId).emit('room-expired');
                }
            });
            rooms.delete(roomId);
        }
    });
    // Update queue positions
    if (queue.length > 0) {
        queue.forEach((socketId, index) => {
            io.to(socketId).emit('queue-position', {
                position: index + 1,
                queueLength: queue.length
            });
        });
    }
}, 10000); // Every 10 seconds
const PORT = process.env.PORT || 3000;
httpServer.on('request', (req, res) => {
    res.end("working server");
    console.log("working server");
});
httpServer.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
