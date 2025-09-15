import { createContext, useState } from 'react'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('auth_user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  const login = (payload) => {
    // payload from API: { client_id, email, name? }
    setUser(payload)
    try {
      localStorage.setItem('auth_user', JSON.stringify(payload))
    } catch {}
  }

  const logout = () => {
    setUser(null)
    try {
      localStorage.removeItem('auth_user')
    } catch {}
    window.location.assign('/login')
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
