import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: any
    }
  }
}

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      throw new Error('No token provided')
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!)
    const user = await User.findById((decoded as any).userId)

    if (!user) {
      throw new Error('User not found')
    }

    req.user = user
    next()
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' })
  }
} 