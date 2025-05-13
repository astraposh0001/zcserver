import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import { QueuedUser, Room, SignalingMessage } from './types.js'
import { randomUUID } from 'crypto'
import connectionsRoutes from './routes/connections.js'
import { setUserSocket, removeUserSocket, getUserSocket } from './utils/getUserSocket.js'
import chatsRoutes from './routes/chats.js'
import notificationsRoutes from './routes/notifications.js'

dotenv.config()

// Create Express and HTTP server
const app = express()
const httpServer = createServer(app)

// Express middleware
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json')
  next()
})

// Update CORS configuration
const allowedOrigins = [
  'https://zoye.vercel.app',
  'http://localhost:5173',
  'http://zoye.in'
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, {
    body: req.method === 'POST' ? req.body : undefined
  })
  next()
})

// Routes
app.use('/auth', authRoutes)
app.use('/api/connections', connectionsRoutes)
app.use('/api/chats', chatsRoutes)
app.use('/api/notifications', notificationsRoutes)

// Error handlers
app.use('*', (_, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found'
  })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Error:', err)
  res.status(500).json({
    success: false,
    error: 'Internal Server Error'
  })
})

// WebSocket state
const users = new Map<string, QueuedUser>()
const rooms = new Map<string, Room>()
const queue: string[] = []

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
})

// Make io available to routes
app.set('io', io)

// Socket connection handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id)
  
  const user: QueuedUser = {
    id: randomUUID(),
    socketId: socket.id,
    inQueue: false,
    connectedAt: Date.now(),
    deviceInfo: {
      browser: 'Unknown',
      os: 'Unknown',
      network: socket.handshake.address
    }
  }
  users.set(socket.id, user)

  // Emit initial state
  socket.emit('connection-success', {
    userId: user.id,
    activeUsers: users.size
  })

  // Broadcast updated user count
  io.emit('users-updated', {
    activeUsers: users.size,
    inQueue: queue.length
  })

  socket.on('join-queue', (userInfo?: { name?: string }) => {
    const user = users.get(socket.id)
    if (!user || user.inQueue || user.roomId) return

    user.name = userInfo?.name || 'Anonymous'
    user.inQueue = true
    queue.push(socket.id)
    
    const matchedId = findMatch(socket.id)
    if (matchedId) {
      matchUsers(socket.id, matchedId)
    } else {
      socket.emit('queue-joined', {
        position: queue.length,
        total: queue.length
      })
    }
  })

  socket.on('leave-queue', () => {
    leaveQueue(socket.id)
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
    cleanupUser(socket.id)
    io.emit('users-updated', {
      activeUsers: users.size,
      inQueue: queue.length
    })
  })

  // Handle connection updates
  socket.on('connection-update', (data) => {
    const { users, type } = data
    users.forEach((username: string) => {
      const userSocket = getUserSocket(username)
      if (userSocket) {
        io.to(userSocket).emit('connection-update', { type })
      }
    })
  })

  // Add username-socket mapping when user authenticates
  socket.on('auth', (data: { username: string }) => {
    setUserSocket(data.username, socket.id)
  })
})

// Helper functions
function findMatch(socketId: string): string | null {
  return queue.find(id => id !== socketId && users.get(id)?.inQueue) || null
}

function matchUsers(user1Id: string, user2Id: string) {
  const roomId = randomUUID()
  const room: Room = {
    id: roomId,
    users: [user1Id, user2Id],
    createdAt: Date.now()
  }
  
  rooms.set(roomId, room)
  
  const user1 = users.get(user1Id)
  const user2 = users.get(user2Id)
  
  if (user1 && user2) {
    user1.roomId = roomId
    user2.roomId = roomId
    user1.inQueue = false
    user2.inQueue = false
    
    queue.splice(queue.indexOf(user1Id), 1)
    queue.splice(queue.indexOf(user2Id), 1)

    io.to(user1Id).emit('matched', {
      roomId,
      initiator: true,
      peerInfo: { name: user2.name }
    })

    io.to(user2Id).emit('matched', {
      roomId,
      initiator: false,
      peerInfo: { name: user1.name }
    })
  }
}

function leaveQueue(socketId: string) {
  const user = users.get(socketId)
  if (!user || !user.inQueue) return
  
  const index = queue.indexOf(socketId)
  if (index !== -1) {
    queue.splice(index, 1)
    user.inQueue = false
    io.to(socketId).emit('queue-left')
  }
}

function cleanupUser(socketId: string) {
  const user = users.get(socketId)
  if (!user) return

  leaveQueue(socketId)

  if (user.roomId) {
    const room = rooms.get(user.roomId)
    if (room) {
      const partnerId = room.users.find(id => id !== socketId)
      if (partnerId) {
        const partner = users.get(partnerId)
        if (partner) {
          partner.roomId = undefined
          io.to(partnerId).emit('peer-disconnected')
        }
      }
      rooms.delete(room.id)
    }
  }

  users.delete(socketId)
}

// Start server
const PORT = process.env.PORT || 5000
mongoose.connect(process.env.MONGO_URL!)
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  })
  .catch(err => {
    console.error('MongoDB connection error:', err)
    process.exit(1)
  }) 
