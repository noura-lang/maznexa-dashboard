import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_DOMAIN || 'maznexa.sa'
export const ACCESS_SHEET_ID = import.meta.env.VITE_ACCESS_SHEET_ID
export const AM_SHEET_ID = import.meta.env.VITE_AM_SHEET_ID
export const COST_SHEET_ID = import.meta.env.VITE_COST_SHEET_ID

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)

// Restricts the Google account picker to the company Workspace domain
// (`hd` hint) — this is a UX nicety only, NOT a security boundary, since a
// user could still complete the popup with a non-domain account. The real
// enforcement is the user.email check done after sign-in in AuthContext.
//
// The `spreadsheets` scope (full read/write) is requested for every user,
// not just admins — Google still enforces the real per-file permission on
// the Access Sheet itself (Drive sharing), the scope only decides which
// *categories* of Sheets API calls this app is allowed to attempt. Regular
// employees need at least Viewer sharing on the Access Sheet to read their
// own Employees/Permissions row; admins additionally need Editor sharing to
// save changes from the Admin Panel. See README/setup notes for the exact
// sharing configuration required in Google Drive.
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ hd: ALLOWED_DOMAIN })
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets')
