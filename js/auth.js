import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signInAnonymously, signOut, setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseApp } from "./store.js?v=receipts1";
import { ADMIN_UID } from "./config.js?v=receipts1";

const auth = getAuth(firebaseApp);
export const isAdmin = user => user?.uid === ADMIN_UID;
export const watchAuth = callback => onAuthStateChanged(auth, callback);
export const logout = () => signOut(auth);
export const ensureWorkerSession = async () => {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
};

export async function login(email, password) {
  await setPersistence(auth, browserSessionPersistence);
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  return result.user;
}
