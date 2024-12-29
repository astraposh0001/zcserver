import { Socket } from 'socket.io'

// Map to store username to socket ID mappings
const userSockets = new Map<string, string>()

export function setUserSocket(username: string, socketId: string) {
  userSockets.set(username, socketId)
}

export function removeUserSocket(username: string) {
  userSockets.delete(username)
}

export function getUserSocket(username: string): string | undefined {
  return userSockets.get(username)
}

export function clearUserSockets() {
  userSockets.clear()
} 