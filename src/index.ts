import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'

dotenv.config()

const app = express()

// Global middleware to ensure JSON
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json')
  next()
})

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// Parse JSON bodies
app.use(express.json())

// Request logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, {
    body: req.method === 'POST' ? req.body : undefined
  })
  next()
})

// Routes
app.use('/auth', authRoutes)

// Catch-all route for 404s
app.use('*', (_, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found'
  })
})

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Error:', err)
  res.status(500).json({
    success: false,
    error: 'Internal Server Error'
  })
})

// Start server
const PORT = process.env.PORT || 5000
mongoose.connect(process.env.MONGO_URL!)
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
  })
  .catch(err => {
    console.error('MongoDB connection error:', err)
    process.exit(1)
  }) 