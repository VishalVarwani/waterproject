// src/pages/Login.jsx
import { useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../utils/authContext'
import { api } from '../utils/api'
import '../styles/login.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { login } = useContext(AuthContext)

  const deriveName = (mail) => {
    const left = (mail || '').split('@')[0]
    if (!left) return 'User'
    const parts = left.split(/[.\-_]+/).filter(Boolean)
    const name = parts.map(p => p[0]?.toUpperCase() + p.slice(1)).join(' ')
    return name || 'User'
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await api.login(email, password) // { client_id, email }
      // augment with a friendly name so Header can show initials
      const payload = { ...res, name: deriveName(res.email) }
      login(payload)
      // you can use `remember` later for token lifetime; we already persist in localStorage
      navigate('/')
    } catch (err) {
      setError(String(err.message || err))
    }
  }

  return (
    <div className="login">
      <div className="login-orb login-orb--left" aria-hidden="true"></div>
      <div className="login-orb login-orb--right" aria-hidden="true"></div>

      <div className="login-wrap">
        {/* Brand / left */}
        <section className="login-brand" aria-hidden="true">
          <div className="brand-card">
            <div className="brand-head">
              <span className="brand-dot" aria-hidden="true"></span>
              <span className="brand-title">e.wai</span>
            </div>
            <h2 className="brand-big">Welcome to e.wai</h2>
            <p className="brand-sub">
              Secure access to your water-quality datasets, dashboards, and analytics.
            </p>
            <div className="brand-badge">● SWIM Platform • Secure by design</div>

            <div className="brand-kpis">
              <div className="kpi"><h4>Uptime</h4><div className="kpi-v">99.98%</div></div>
              <div className="kpi"><h4>Data Points</h4><div className="kpi-v">12.6M</div></div>
              <div className="kpi"><h4>Lakes & Rivers</h4><div className="kpi-v">184</div></div>
            </div>
          </div>
        </section>

        {/* Auth / right */}
        <section className="login-auth" role="main" aria-label="Sign in form">
          <div className="auth-card">
            <div className="auth-head">
              <div className="brand-mini">
                <span className="brand-dot brand-dot--mini" aria-hidden="true"></span>
                <span>Sign in to <strong>e.wai</strong></span>
              </div>
              <span className="muted">Access your client workspace</span>
            </div>

            <form onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="pwd-row">
                  <input
                    id="password"
                    name="password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-pwd"
                    onClick={() => setShowPwd((s) => !s)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    {showPwd ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="row">
                <label className="remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span className="muted">Remember me</span>
                </label>
                <a
                  className="link"
                  href="#"
                  onClick={(e) => { e.preventDefault(); alert('Hook your password-reset route here') }}
                >
                  Forgot password?
                </a>
              </div>

              <button className="btn" type="submit">Sign in</button>

              <div className="hr" aria-hidden="true">
                <span className="hr-line"></span>
                <small className="muted">or</small>
                <span className="hr-line"></span>
              </div>

              <button
                className="btn-ghost"
                type="button"
                onClick={() => alert('Hook your SSO/Google OAuth here')}
              >
                Continue with SSO
              </button>

              {error && <div className="error" role="alert">{error}</div>}

              <div className="foot">
                By continuing you agree to our <a className="link" href="#">Terms</a> and <a className="link" href="#">Privacy</a>.
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
