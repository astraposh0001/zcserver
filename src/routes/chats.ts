import express from 'express'
import { Chat } from '../models/Chat.js'
import { auth } from '../middleware/auth.js'
import { Connection } from '../models/Connection.js'
import { Server } from 'socket.io'

const router = express.Router()

// Get chat history
router.get('/:username', auth, async (req, res) => {
  try {
    const { username } = req.params
    const currentUser = req.user.username

    const messages = await Chat.find({
      $or: [
        { sender: currentUser, recipient: username },
        { sender: username, recipient: currentUser }
      ]
    })
    .sort({ createdAt: 1 })

    // Get connection info for empty state
    if (messages.length === 0) {
      const connection = await Connection.findOne({
        $or: [
          { initiatorUsername: currentUser, recipientUsername: username },
          { initiatorUsername: username, recipientUsername: currentUser }
        ]
      }).select('createdAt')

      return res.json({
        messages: [],
        hasChats: false,
        connectionDate: connection?.createdAt
      })
    }

    res.json({
      messages,
      hasChats: true
    })
  } catch (error) {
    console.error('Error fetching chat history:', error)
    res.status(500).json({ error: 'Failed to fetch chat history' })
  }
})

// Send message
router.post('/', auth, async (req, res) => {
  try {
    const { recipient, message } = req.body
    const sender = req.user.username

    const chat = new Chat({
      sender,
      recipient,
      message
    })

    await chat.save()

    // Get the Socket.IO instance
    const io: Server = req.app.get('io')

    // Emit real-time update with the saved chat document
    io.emit('new-message', {
      _id: chat._id,
      sender,
      recipient,
      message,
      timestamp: chat.createdAt
    })

    res.status(201).json({ 
      chat: {
        _id: chat._id,
        sender,
        recipient,
        message,
        timestamp: chat.createdAt
      }
    })
  } catch (error) {
    console.error('Error sending message:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

export default router 