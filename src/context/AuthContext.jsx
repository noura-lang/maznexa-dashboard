import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider,
} from 'firebase/auth'
import { auth, googleProvider, ALLOWED_DOMAIN } from '../firebase'
import {
  fetchEmployees, fetchPermissions, parsePermissionsRow, DEFAULT_DENIED_PERMISSIONS,
} from '../api/accessSheetApi'

export const AuthContext = createContext()

// Google OAuth access tokens (unlike Firebase's own session) aren't
// refreshable silently by the Firebase SDK — they're only handed back at
// the moment signInWithPopup completes, and expire after ~1hr. Caching one
// in sessionStorage lets a same-tab page reload keep working without
// re-prompting; a token from an earlier, expired session is never reused.
const TOKEN_STORAGE_KEY = 'maznexa_google_access_token'
const TOKEN_TTL_MS = 55 * 60 * 1000 // Google tokens last ~60min; refresh a bit early

function loadCachedToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const { token, issuedAt } = JSON.parse(raw)
    if (!token || Date.now() - issuedAt > TOKEN_TTL_MS) return null
    return token
  } catch {
    return null
  }
}

function cacheToken(token) {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, issuedAt: Date.now() }))
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — token just won't
    // survive a reload; user re-authenticates via the normal sign-in screen.
  }
}

function clearCachedToken() {
  try { sessionStorage.removeItem(TOKEN_STORAGE_KEY) } catch { /* noop */ }
}

function isAllowedEmail(email) {
  return (email || '').toLowerCase().endsWith(`@${ALLOWED_DOMAIN.toLowerCase()}`)
}

// status:
//   'loading'          resolving Firebase's own auth session
//   'signed-out'        show the "Sign in with Google" screen
//   'domain-denied'     signed in with a non-@ALLOWED_DOMAIN account
//   'needs-token'       Firebase session exists but there's no usable Google
//                       access token yet (fresh browser session, or the
//                       cached one expired) — needs a re-auth popup to reach
//                       the Access Sheet
//   'not-provisioned'   email has no matching row in the Employees tab
//   'ready'             employee + permissions loaded, dashboard can render
export function AuthProvider({ children }) {
  const [status, setStatus]             = useState('loading')
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [accessToken, setAccessToken]   = useState(null)
  const [employee, setEmployee]         = useState(null)
  const [permissions, setPermissions]   = useState(null)
  const [error, setError]               = useState(null)

  const loadAccessData = useCallback(async (user, token) => {
    try {
      const email = (user.email || '').toLowerCase()
      const [employees, permissionRows] = await Promise.all([
        fetchEmployees(token),
        fetchPermissions(token),
      ])

      const employeeRow = employees.find(e => (e.Email || '').toLowerCase() === email)
      if (!employeeRow) {
        setEmployee(null)
        setPermissions(null)
        setStatus('not-provisioned')
        return
      }
      setEmployee({ name: employeeRow.Name, team: employeeRow.Team, role: employeeRow.Role })

      const permissionRow = permissionRows.find(p => (p.Email || '').toLowerCase() === email)
      setPermissions(permissionRow ? parsePermissionsRow(permissionRow) : DEFAULT_DENIED_PERMISSIONS)
      setStatus('ready')
    } catch (err) {
      console.error('Failed to load Access Sheet data:', err)
      setError(err.message)
      // Most likely cause: the cached token expired/was revoked, or the
      // signed-in account hasn't been given Drive access to the Access
      // Sheet yet — either way, a fresh sign-in is the recovery path.
      setStatus('needs-token')
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      setFirebaseUser(user)
      setError(null)

      if (!user) {
        setStatus('signed-out')
        setEmployee(null)
        setPermissions(null)
        setAccessToken(null)
        clearCachedToken()
        return
      }
      if (!isAllowedEmail(user.email)) {
        setStatus('domain-denied')
        return
      }

      const cached = loadCachedToken()
      if (cached) {
        setAccessToken(cached)
        loadAccessData(user, cached)
      } else {
        setStatus('needs-token')
      }
    })
    return unsubscribe
  }, [loadAccessData])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const email = (result.user.email || '').toLowerCase()

      if (!isAllowedEmail(email)) {
        await firebaseSignOut(auth)
        setStatus('domain-denied')
        return
      }

      const credential = GoogleAuthProvider.credentialFromResult(result)
      const token = credential?.accessToken
      if (!token) {
        setError('Google sign-in succeeded but no Sheets access token was returned. Please try again.')
        setStatus('needs-token')
        return
      }

      cacheToken(token)
      setAccessToken(token)
      await loadAccessData(result.user, token)
    } catch (err) {
      console.error('Sign-in failed:', err)
      // Ignore the user simply closing/cancelling the popup — not a real error.
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(err.message)
      }
    }
  }, [loadAccessData])

  const signOutUser = useCallback(async () => {
    clearCachedToken()
    await firebaseSignOut(auth)
  }, [])

  const refreshPermissions = useCallback(async () => {
    if (firebaseUser && accessToken) await loadAccessData(firebaseUser, accessToken)
  }, [firebaseUser, accessToken, loadAccessData])

  return (
    <AuthContext.Provider
      value={{
        status, firebaseUser, employee, permissions, accessToken, error,
        signIn, signOut: signOutUser, refreshPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
