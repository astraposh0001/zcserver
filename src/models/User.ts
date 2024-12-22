import mongoose, { Document, Model } from 'mongoose'
import bcrypt from 'bcrypt'

// Interface for User methods
interface IUserMethods {
  comparePassword(candidatePassword: string): Promise<boolean>
}

// Interface for User document
export interface IUser extends Document {
  username: string
  email: string
  password: string
  createdAt: Date
  comparePassword(candidatePassword: string): Promise<boolean>
}

// Interface for User model
interface UserModel extends Model<IUser, {}, IUserMethods> {}

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'users'
})

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()

  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (err) {
    next(err as Error)
  }
})

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password)
  } catch (err) {
    console.error('Password comparison error:', err)
    return false
  }
}

export const User = mongoose.model<IUser, UserModel>('User', userSchema) 