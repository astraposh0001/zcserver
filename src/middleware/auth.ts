import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export interface AuthRequest extends Request {
  user?: any
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '')
    
    if (!token) {
      throw new Error()
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { _id: string }
    const user = await User.findOne({ _id: decoded._id })

    if (!user) {
      throw new Error()
    }

    req.user = user
    next()
  } catch (err) {
    res.status(401).json({ error: 'Please authenticate' })
  }
} 