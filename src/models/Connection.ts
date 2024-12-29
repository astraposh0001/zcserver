import mongoose from 'mongoose'

const connectionSchema = new mongoose.Schema({
  initiatorUsername: {
    type: String,
    required: true
  },
  recipientUsername: {
    type: String,
    required: true
  },
  initiatorUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipientUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  }
}, {
  timestamps: true
})

// Create compound index on usernames
connectionSchema.index(
  { initiatorUsername: 1, recipientUsername: 1 }, 
  { 
    unique: true,
    name: 'unique_connection'
  }
)

export const Connection = mongoose.model('Connection', connectionSchema) 