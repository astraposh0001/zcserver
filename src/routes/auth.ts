import express from 'express'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { auth, AuthRequest } from '../middleware/auth.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Register new user
router.post('/register', async (req, res) => {
  try {
    console.log('Register request:', req.body)
    const { username, email, password } = req.body

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      })
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      })
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    })

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: existingUser.email === email ? 'Email already exists' : 'Username already exists'
      })
    }

    // Create new user
    const user = new User({ username, email, password })
    await user.save()

    // Generate token
    const token = jwt.sign({ _id: user._id }, JWT_SECRET)

    console.log('User registered successfully:', {
      id: user._id,
      username: user.username,
      email: user.email
    })

    res.status(201).json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    })
  } catch (err) {
    console.error('Registration error:', err)
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create account'
    })
  }
})

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    // Find user
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      })
    }

    // Check password
    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      })
    }

    // Generate token
    const token = jwt.sign({ _id: user._id }, JWT_SECRET)

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    })
  } catch (err) {
    res.status(400).json({
      success: false,
      error: 'Login failed'
    })
  }
})

// Get user status
router.get('/user-status', auth, async (req: AuthRequest, res) => {
  try {
    const user = req.user
    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      }
    })
  } catch (err) {
    res.status(400).json({
      success: false,
      error: 'Failed to get user status'
    })
  }
})

export default router 