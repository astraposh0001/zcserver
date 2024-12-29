import express from 'express'
import { Connection } from '../models/Connection.js'
import { auth } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { Notification } from '../models/Notification.js'
import { getUserSocket } from '../utils/getUserSocket.js'
import { Chat } from '../models/Chat.js'

const router = express.Router()

router.post('/', auth, async (req, res) => {
  try {
    const { recipientUsername } = req.body
    const initiatorUsername = req.user.username

    // Check if trying to connect with self
    if (initiatorUsername === recipientUsername) {
      return res.status(400).json({
        error: 'Cannot connect with yourself'
      })
    }

    // Validate both users exist
    const [initiator, recipient] = await Promise.all([
      User.findOne({ username: initiatorUsername }),
      User.findOne({ username: recipientUsername })
    ])

    if (!initiator || !recipient) {
      return res.status(404).json({
        error: 'One or both users not found'
      })
    }

    // Check for existing connection
    const existingConnection = await Connection.findOne({
      $or: [
        { initiatorUsername, recipientUsername },
        { initiatorUsername: recipientUsername, recipientUsername: initiatorUsername }
      ]
    })

    if (existingConnection) {
      return res.status(400).json({
        error: 'Connection already exists',
        connection: existingConnection
      })
    }

    // Create new connection
    const connection = new Connection({
      initiatorUsername,
      recipientUsername,
      initiatorUser: initiator._id,
      recipientUser: recipient._id,
      status: 'pending'
    })

    await connection.save()

    // Return connection with user details
    const populatedConnection = await connection
      .populate([
        { 
          path: 'initiatorUser',
          select: 'username firstName lastName'
        },
        { 
          path: 'recipientUser',
          select: 'username firstName lastName'
        }
      ])

    res.status(201).json({ 
      connection: populatedConnection,
      message: `Connection request sent to ${recipient.username}`
    })
  } catch (error) {
    console.error('Connection error:', error)
    res.status(500).json({ error: 'Failed to create connection' })
  }
})

// Get user's connections
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id

    const connections = await Connection.find({
      $or: [
        { initiatorUser: userId },
        { recipientUser: userId }
      ]
    })
    .populate('initiatorUser', 'username firstName lastName')
    .populate('recipientUser', 'username firstName lastName')
    .sort('-createdAt')

    res.json({ connections })
  } catch (error) {
    console.error('Error fetching connections:', error)
    res.status(500).json({ error: 'Failed to fetch connections' })
  }
})

// Add status check endpoint
router.get('/status/:username', auth, async (req, res) => {
  try {
    const { username } = req.params
    const currentUser = req.user.username

    const connection = await Connection.findOne({
      $or: [
        { initiatorUsername: currentUser, recipientUsername: username },
        { initiatorUsername: username, recipientUsername: currentUser }
      ]
    })

    res.json({ isConnected: !!connection })
  } catch (error) {
    console.error('Error checking connection status:', error)
    res.status(500).json({ error: 'Failed to check connection status' })
  }
})

// Add disconnect endpoint
router.delete('/', auth, async (req, res) => {
  try {
    const { recipientUsername } = req.body
    const initiatorUsername = req.user.username

    // Delete connection
    const connection = await Connection.findOneAndDelete({
      $or: [
        { initiatorUsername, recipientUsername },
        { initiatorUsername: recipientUsername, recipientUsername: initiatorUsername }
      ]
    })

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' })
    }

    // Delete all chat messages between users
    await Chat.deleteMany({
      $or: [
        { sender: initiatorUsername, recipient: recipientUsername },
        { sender: recipientUsername, recipient: initiatorUsername }
      ]
    })

    // Notify users about disconnection
    const io = req.app.get('io')
    io.emit('connection-update', {
      type: 'disconnected',
      users: [initiatorUsername, recipientUsername]
    })

    res.json({ message: 'Disconnected successfully' })
  } catch (error) {
    console.error('Error disconnecting:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Add get connected users endpoint
router.get('/connected-users', auth, async (req, res) => {
  try {
    const currentUsername = req.user.username

    // Find all connections for current user
    const connections = await Connection.find({
      $or: [
        { initiatorUsername: currentUsername },
        { recipientUsername: currentUsername }
      ]
    }).populate([
      {
        path: 'initiatorUser',
        select: 'username firstName lastName'
      },
      {
        path: 'recipientUser',
        select: 'username firstName lastName'
      }
    ])

    // Map connections to connected users
    const connectedUsers = connections.map(connection => {
      const isInitiator = connection.initiatorUsername === currentUsername
      const connectedUser = isInitiator ? 
        connection.recipientUser as any : 
        connection.initiatorUser as any

      return {
        username: connectedUser.username,
        name: `${connectedUser.firstName} ${connectedUser.lastName}`,
        icon: connectedUser.firstName.charAt(0).toUpperCase(),
        connectionId: connection._id
      }
    })

    res.json({ connectedUsers })
  } catch (error) {
    console.error('Error fetching connected users:', error)
    res.status(500).json({ error: 'Failed to fetch connected users' })
  }
})

// Add real-time notification when connection status changes
router.post('/notify', auth, async (req, res) => {
  try {
    const { recipientUsername, action } = req.body
    const initiatorUsername = req.user.username

    // Emit event through Socket.IO
    req.app.get('io').emit('connection-update', {
      type: action,
      users: [initiatorUsername, recipientUsername]
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Error sending notification:', error)
    res.status(500).json({ error: 'Failed to send notification' })
  }
})

// Add connection info endpoint
router.get('/info/:username', auth, async (req, res) => {
  try {
    const { username } = req.params
    const currentUser = req.user.username

    const connection = await Connection.findOne({
      $or: [
        { initiatorUsername: currentUser, recipientUsername: username },
        { initiatorUsername: username, recipientUsername: currentUser }
      ]
    }).select('createdAt status')

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' })
    }

    res.json({
      connectionDate: connection.createdAt,
      status: connection.status
    })
  } catch (error) {
    console.error('Error fetching connection info:', error)
    res.status(500).json({ error: 'Failed to fetch connection info' })
  }
})

// Send connection request
router.post('/request', auth, async (req, res) => {
  try {
    const { recipientUsername } = req.body
    const initiator = req.user

    // Check if recipient exists
    const recipient = await User.findOne({ username: recipientUsername })
    if (!recipient) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Check for existing connection
    const existingConnection = await Connection.findOne({
      $or: [
        { initiatorUsername: initiator.username, recipientUsername },
        { initiatorUsername: recipientUsername, recipientUsername: initiator.username }
      ]
    })

    if (existingConnection) {
      return res.status(400).json({ error: 'Connection already exists' })
    }

    // Check for existing pending request
    const existingRequest = await Notification.findOne({
      type: 'connection-request',
      from: initiator._id,
      to: recipient._id,
      status: 'pending'
    })

    if (existingRequest) {
      return res.status(400).json({ error: 'Request already sent' })
    }

    // Create notification
    const notification = new Notification({
      type: 'connection-request',
      from: initiator._id,
      to: recipient._id
    })

    await notification.save()

    // Send real-time notification
    const io = req.app.get('io')
    const recipientSocket = getUserSocket(recipientUsername)
    if (recipientSocket) {
      io.to(recipientSocket).emit('new-notification', {
        _id: notification._id,
        type: 'connection-request',
        from: {
          username: initiator.username,
          firstName: initiator.firstName,
          lastName: initiator.lastName
        },
        status: 'pending',
        createdAt: notification.createdAt
      })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error sending connection request:', error)
    res.status(500).json({ error: 'Failed to send request' })
  }
})

export default router 