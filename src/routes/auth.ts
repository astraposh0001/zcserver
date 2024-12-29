import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { auth } from '../middleware/auth.js'

const router = express.Router()

// Middleware to ensure JSON responses
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json')
  next()
})

router.post('/register', async (req, res) => {
  try {
    const { email, password, username, firstName, lastName } = req.body

    // Log the received data
    console.log('Registration attempt with:', { email, username, firstName, lastName })

    // Validate required fields
    if (!email || !password || !username || !firstName || !lastName) {
      return res.status(400).json({
        error: 'All fields are required'
      })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    })

    if (existingUser) {
      console.log('User already exists:', existingUser.email)
      return res.status(400).json({ 
        error: 'User with this email or username already exists' 
      })
    }

    // Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // Create new user
    const user = new User({
      email,
      username,
      firstName,
      lastName,
      password: hashedPassword
    })

    // Save user and log the result
    const savedUser = await user.save()
    console.log('User created successfully:', savedUser._id)

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    )

    // Return user data (excluding password) and token
    const userData = {
      id: user._id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }

    res.status(201).json({ user: userData, token })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ 
      error: 'Registration failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Add login route
router.post('/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body
    console.log('Login attempt:', { emailOrUsername })

    // Validate input
    if (!emailOrUsername || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email/username and password are required'
      })
    }

    // Find user
    const user = await User.findOne({
      $or: [
        { email: emailOrUsername.toLowerCase() },
        { username: emailOrUsername }
      ]
    })

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      })
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      })
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    )

    // Send response
    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName
      },
      token
    })

  } catch (error) {
    console.error('Login error:', error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
})

// Update profile endpoint
router.put('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, username } = req.body

    // Check if username is taken (if changed)
    if (username !== req.user.username) {
      const existingUser = await User.findOne({ username })
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' })
      }
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { firstName, lastName, username },
      { new: true }
    ).select('-password')

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({ user })
  } catch (error) {
    console.error('Error updating profile:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

export default router 