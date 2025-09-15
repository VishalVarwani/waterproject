import PropTypes from 'prop-types'
import { NavLink, useNavigate } from 'react-router-dom'
import { useContext, useState, useRef, useEffect } from 'react'
import { AuthContext } from '../utils/authContext'

export default function Header({ title, lastUpdated, darkMode, onToggleDark }) {
  const { user, logout } = useContext(AuthContext)
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onDoc = (e) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const initials = user?.name
    ? user.name.split(/\s+/).map(s => s[0]?.toUpperCase()).slice(0,2).join('')
    : ''

  return (
    <header className="header" role="banner">
      <div className="header__left">
        <h1 className="header__title">{title}</h1>
        <p className="header__subtitle" aria-live="polite">
          {lastUpdated ? `Last updated: ${lastUpdated}` : 'No updates'}
        </p>
      </div>

      <nav className="header__nav" aria-label="Primary">
        <NavLink to="/" end className={({isActive}) => `navlink ${isActive ? 'navlink--active' : ''}`}>Dashboard</NavLink>
        <NavLink to="/analytics" className={({isActive}) => `navlink ${isActive ? 'navlink--active' : ''}`}>Analytics</NavLink>
        {!user && (
          <NavLink to="/login" className={({isActive}) => `navlink ${isActive ? 'navlink--active' : ''}`}>Login</NavLink>
          
        )}
        <NavLink to="/parameters" className={({isActive}) => `navlink ${isActive ? 'navlink--active' : ''}`}>Parameters</NavLink>

        <NavLink to="/talk2csv" className={({isActive}) => `navlink ${isActive ? 'navlink--active' : ''}`}>Talk2CSV</NavLink>




      </nav>

      <div className="header__right">
        

        {user && (
          <div className="profile" ref={menuRef}>
            <button
              className="profile__btn"
              onClick={() => setOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="Open profile menu"
            >
              <span className="avatar" aria-hidden="true">{initials || 'U'}</span>
              <span className="profile__name">{user.name}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {open && (
              <div className="profile__menu" role="menu">
                <button className="profile__item" role="menuitem" onClick={() => { setOpen(false); navigate('/'); }}>
                  Home
                </button>
               
                <button className="profile__item" role="menuitem" onClick={() => { setOpen(false); navigate('/datasets'); }}>
                  Datasets
                </button>
                <button className="profile__item" role="menuitem" onClick={() => { setOpen(false); navigate('/ingestion'); }}>
                  Ingestion
                </button>

                <div className="profile__sep" aria-hidden="true"></div>
                <button className="profile__item profile__item--danger" role="menuitem" onClick={logout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}

Header.propTypes = {
  title: PropTypes.string.isRequired,
  lastUpdated: PropTypes.string,
  darkMode: PropTypes.bool.isRequired,
  onToggleDark: PropTypes.func.isRequired
}
