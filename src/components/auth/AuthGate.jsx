import { useAuth } from '../../context/AuthContext'

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5c-7.7 0-14.4 4.3-17.7 10.6.1.2-.1.4 0 .6z" />
      <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4C29.6 35.7 26.9 36.5 24 36.5c-5.3 0-9.7-3.5-11.3-8.4l-6.7 5.2C9.5 39.9 16.2 44.5 24 44.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.6l6.6 5.4C41.5 35.7 44.5 30.4 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
    </svg>
  )
}

function AuthScreen({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm card p-8 flex flex-col items-center gap-6 text-center
                       bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                       from-brand-200/70 via-brand-100/30 to-transparent">
        <img
          src="/logo.png"
          alt="Maznexa"
          className="h-10 w-auto object-contain"
          onError={e => { e.target.style.display = 'none' }}
        />
        {children}
      </div>
    </div>
  )
}

function GoogleSignInButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium
                 bg-white text-brand-900 border border-brand-200 shadow-sm
                 hover:bg-brand-50 transition-colors"
    >
      <GoogleIcon />
      {label}
    </button>
  )
}

export default function AuthGate({ children }) {
  const { status, error, signIn, signOut } = useAuth()

  if (status === 'loading') {
    return (
      <AuthScreen>
        <div className="w-8 h-8 rounded-full border-4 border-brand-600/30 border-t-brand-600 animate-spin" />
        <p className="text-sm dark:text-white/50 text-brand-500">Loading…</p>
      </AuthScreen>
    )
  }

  if (status === 'signed-out') {
    return (
      <AuthScreen>
        <p className="text-sm dark:text-white/60 text-brand-600">
          Sign in with your Maznexa Google account to continue.
        </p>
        <GoogleSignInButton label="Sign in with Google" onClick={signIn} />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </AuthScreen>
    )
  }

  if (status === 'needs-token') {
    return (
      <AuthScreen>
        <p className="text-sm dark:text-white/60 text-brand-600">
          Your session needs to be refreshed to continue.
        </p>
        <GoogleSignInButton label="Continue with Google" onClick={signIn} />
        <button
          type="button"
          onClick={signOut}
          className="text-xs dark:text-white/40 text-brand-400 hover:underline"
        >
          Sign out instead
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </AuthScreen>
    )
  }

  if (status === 'domain-denied') {
    return (
      <AuthScreen>
        <p className="text-base font-semibold dark:text-white text-brand-900">
          هذا الحساب غير مصرح له بالدخول
        </p>
        <p className="text-sm dark:text-white/60 text-brand-600">
          This account isn't authorized. Please sign in with your @maznexa.sa Google account.
        </p>
        <GoogleSignInButton label="Try a different account" onClick={signIn} />
      </AuthScreen>
    )
  }

  if (status === 'not-provisioned') {
    return (
      <AuthScreen>
        <p className="text-base font-semibold dark:text-white text-brand-900">
          حسابك غير مفعّل، تواصل مع الإدارة
        </p>
        <p className="text-sm dark:text-white/60 text-brand-600">
          Your account isn't set up in the dashboard yet. Contact your administrator to get access.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="text-xs dark:text-white/40 text-brand-400 hover:underline"
        >
          Sign out
        </button>
      </AuthScreen>
    )
  }

  return children
}
