import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { app } from "./firebase";

export const auth = app ? getAuth(app) : null;

export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with that email already exists — try signing in instead.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/weak-password":
      return "Password must be at least 8 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts — please wait a moment and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  if (!auth) throw new Error("Login is not configured.");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!auth) throw new Error("Login is not configured.");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

export async function logOut(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}
