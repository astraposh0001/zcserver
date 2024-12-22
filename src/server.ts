import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import authRoutes from './routes/auth.js'
import { QueuedUser, Room, SignalingMessage } from './types.js'
import { randomUUID } from 'crypto'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Create HTTP and Express server
const app = express()
const httpServer = createServer(app)

// MongoDB setup with error handling
const MONGO_URL = process.env.MONGO_URL
if (!MONGO_URL) {
  console.error('MONGO_URL not found in environment variables')
  process.exit(1)
}

mongoose.connect(MONGO_URL, {
  dbName: 'zcdatabase' // Explicitly set database name
})
  .then(() => {
    console.log('Connected to MongoDB - Database: zcdatabase')
  })
  .catch(err => {
    console.error('MongoDB connection error:', err)
    process.exit(1)
  })

// Express middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

// Debug middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`, req.body)
  next()
})

// Auth routes
app.use('/api', authRoutes)

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  })
})

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['polling', 'websocket']
})

// WebSocket state
const users = new Map<string, QueuedUser>()
const rooms = new Map<string, Room>()
const queue: string[] = []

function getBrowserInfo(userAgent: string) {
  const browser = userAgent.includes('Firefox') ? 'Firefox' : 
                 userAgent.includes('Chrome') ? 'Chrome' : 
                 userAgent.includes('Safari') ? 'Safari' : 'Unknown'
  
  const os = userAgent.includes('Windows') ? 'Windows' :
            userAgent.includes('Mac') ? 'Mac' :
            userAgent.includes('Linux') ? 'Linux' : 'Unknown'

  return { browser, os }
}

function findMatch(socketId: string): string | null {
  const eligibleUsers = queue.filter(id => {
    const user = users.get(id)
    return id !== socketId && user && !user.roomId && user.inQueue
  })

  if (eligibleUsers.length === 0) return null

  const randomIndex = Math.floor(Math.random() * eligibleUsers.length)
  return eligibleUsers[randomIndex]
}

function createRoom(user1Id: string, user2Id: string): Room {
  const roomId = randomUUID()
  const user1 = users.get(user1Id)
  const user2 = users.get(user2Id)

  console.log(`Creating room ${roomId} for users:`, {
    user1: { id: user1Id, name: user1?.name },
    user2: { id: user2Id, name: user2?.name }
  })
  
  const room: Room = {
    id: roomId,
    users: [user1Id, user2Id],
    createdAt: Date.now()
  }
  
  rooms.set(roomId, room)
  
  if (user1 && user2) {
    user1.roomId = roomId
    user2.roomId = roomId
    user1.inQueue = false
    user2.inQueue = false
  }

  return room
}

function cleanupUser(socketId: string) {
  const user = users.get(socketId)
  if (!user) return

  const queueIndex = queue.indexOf(socketId)
  if (queueIndex !== -1) {
    queue.splice(queueIndex, 1)
  }

  if (user.roomId) {
    const room = rooms.get(user.roomId)
    if (room) {
      const partnerId = room.users.find(id => id !== socketId)
      if (partnerId) {
        const partner = users.get(partnerId)
        if (partner) {
          partner.roomId = undefined
          partner.inQueue = false
          io.to(partnerId).emit('peer-disconnected')
        }
      }
      rooms.delete(room.id)
    }
  }

  users.delete(socketId)
}

// Socket connection handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id)
  
  const user: QueuedUser = {
    id: randomUUID(),
    socketId: socket.id,
    inQueue: false,
    connectedAt: Date.now(),
    deviceInfo: {
      ...getBrowserInfo(socket.handshake.headers['user-agent'] || ''),
      network: socket.handshake.address
    }
  }
  users.set(socket.id, user)

  socket.emit('connection-success', {
    userId: user.id,
    activeUsers: users.size
  })

  socket.on('join-queue', (userInfo?: { name?: string }) => {
    const user = users.get(socket.id)
    if (!user || user.inQueue || user.roomId) return

    user.name = userInfo?.name || 'Anonymous'
    user.inQueue = true
    queue.push(socket.id)
    
    const matchedId = findMatch(socket.id)
    if (matchedId) {
      const matchedUser = users.get(matchedId)
      if (!matchedUser) return

      queue.splice(queue.indexOf(socket.id), 1)
      queue.splice(queue.indexOf(matchedId), 1)

      const room = createRoom(socket.id, matchedId)

      io.to(socket.id).emit('matched', {
        roomId: room.id,
        initiator: true,
        peerInfo: {
          name: matchedUser.name,
          deviceInfo: matchedUser.deviceInfo
        }
      })

      io.to(matchedId).emit('matched', {
        roomId: room.id,
        initiator: false,
        peerInfo: {
          name: user.name,
          deviceInfo: user.deviceInfo
        }
      })
    } else {
      socket.emit('queue-joined', {
        position: queue.length,
        total: queue.length
      })
    }
  })

  socket.on('leave-queue', () => {
    const user = users.get(socket.id)
    if (!user || !user.inQueue) return
    
    const index = queue.indexOf(socket.id)
    if (index !== -1) {
      queue.splice(index, 1)
      user.inQueue = false
      socket.emit('queue-left')
    }
  })

  socket.on('signal', (message: SignalingMessage) => {
    const user = users.get(socket.id)
    if (!user?.roomId) return

    const room = rooms.get(user.roomId)
    if (!room) return

    const recipientId = room.users.find(id => id !== socket.id)
    if (!recipientId) return

    io.to(recipientId).emit('signal', {
      type: message.type,
      payload: message.payload,
      from: socket.id,
      roomId: room.id
    })
  })

  socket.on('chat-message', (message: any) => {
    const user = users.get(socket.id)
    if (!user?.roomId) return

    const room = rooms.get(user.roomId)
    if (!room) return

    const recipientId = room.users.find(id => id !== socket.id)
    if (!recipientId) return

    io.to(recipientId).emit('chat-message', message)
  })

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
    cleanupUser(socket.id)
    io.emit('users-updated', {
      activeUsers: users.size,
      inQueue: queue.length
    })
  })
})

// Periodic cleanup and queue updates
setInterval(() => {
  const now = Date.now()
  
  rooms.forEach((room, roomId) => {
    if (now - room.createdAt > 60 * 60 * 1000) {
      room.users.forEach(userId => {
        const user = users.get(userId)
        if (user) {
          user.roomId = undefined
          io.to(userId).emit('room-expired')
        }
      })
      rooms.delete(roomId)
    }
  })
  
  if (queue.length > 0) {
    queue.forEach((socketId, index) => {
      io.to(socketId).emit('queue-position', {
        position: index + 1,
        queueLength: queue.length
      })
    })
  }
}, 10000)

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
}) 