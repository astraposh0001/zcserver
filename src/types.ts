import { Document } from 'mongoose'

export interface User extends Document {
  username: string
  email: string
  password: string
  createdAt: Date
  comparePassword(candidatePassword: string): Promise<boolean>
}

export interface QueuedUser {
  id: string
  socketId: string
  inQueue: boolean
  roomId?: string
  connectedAt: number
  name?: string
  deviceInfo: {
    browser: string
    os: string
    network: string
  }
}

export interface Room {
  id: string
  users: string[]
  createdAt: number
}

export interface SignalingMessage {
  type: string
  payload: any
  from?: string
  to?: string
  roomId?: string
} 