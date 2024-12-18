export interface User {
  id: string
  socketId: string
  inQueue: boolean
  roomId?: string
  connectedAt: number
}

export interface Room {
  id: string
  users: string[] // socket IDs
  createdAt: number
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  payload: any
  from: string
  to: string
} 