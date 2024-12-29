import mongoose from 'mongoose'

const chatSchema = new mongoose.Schema({
  sender: {
    type: String,
    required: true
  },
  recipient: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    transform: (v: Date) => v.toISOString() // Ensure consistent date format
  }
}, {
  timestamps: true
})

// Index for faster queries
chatSchema.index({ sender: 1, recipient: 1 })
chatSchema.index({ createdAt: -1 })

export const Chat = mongoose.model('Chat', chatSchema) 