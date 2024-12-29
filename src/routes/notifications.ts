import express from 'express'
import { Notification } from '../models/Notification.js'
import { Connection } from '../models/Connection.js'
import { auth } from '../middleware/auth.js'
import { User } from '../models/User.js'

const router = express.Router()

// Get notifications
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({
      to: req.user._id,
      status: 'pending'
    })
    .populate({
      path: 'from',
      select: 'username firstName lastName'
    })
    .sort('-createdAt')

    // Transform the data to match the interface
    const formattedNotifications = notifications.map(n => ({
      _id: n._id,
      type: n.type,
      from: n.from as any, // Cast to any to avoid TS error
      status: n.status,
      createdAt: n.createdAt
    }))

    res.json({ notifications: formattedNotifications })
  } catch (error) {
    console.error('Error fetching notifications:', error)
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// Get pending notifications
router.get('/pending', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({
      to: req.user._id,
      status: 'pending',
      type: 'connection-request'
    })
    .populate('from', 'username firstName lastName')
    .sort('-createdAt')
    .limit(10) // Limit to most recent 10

    const formattedNotifications = notifications.map(n => ({
      _id: n._id,
      type: n.type,
      from: n.from as any,
      status: n.status,
      createdAt: n.createdAt
    }))

    res.json({ notifications: formattedNotifications })
  } catch (error) {
    console.error('Error fetching pending notifications:', error)
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// Accept connection request
router.post('/:id/accept', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      to: req.user._id,
      status: 'pending'
    }).populate({
      path: 'from',
      select: 'username firstName lastName'
    })

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    const fromUser = notification.from as any // Cast to avoid TS error

    // Create connection
    const connection = new Connection({
      initiatorUsername: fromUser.username,
      recipientUsername: req.user.username,
      initiatorUser: fromUser._id,
      recipientUser: req.user._id,
      status: 'accepted'
    })

    await connection.save()

    // Update notification status
    notification.status = 'accepted'
    await notification.save()

    // Notify users
    const io = req.app.get('io')
    io.emit('connection-update', {
      type: 'connected',
      users: [fromUser.username, req.user.username]
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Error accepting connection:', error)
    res.status(500).json({ error: 'Failed to accept connection' })
  }
})

// Reject connection request
router.post('/:id/reject', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        to: req.user._id,
        status: 'pending'
      },
      { status: 'rejected' }
    )

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error rejecting connection:', error)
    res.status(500).json({ error: 'Failed to reject connection' })
  }
})

export default router 