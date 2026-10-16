import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signInAnonymously, signOut, setPersistence, browserSessionPersistence,
  createUserWithEmailAndPassword, linkWithCredential, EmailAuthProvider,
  updateProfile, sendEmailVerification, sendPasswordResetEmail, reload
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseApp } from "./store.js?v=20261016.2";
import { ADMIN_UID } from "./config.js?v=20261015.2";

const auth = getAuth(firebaseApp);
auth.languageCode = 'uk';
export const isAdmin = user => user?.uid === ADMIN_UID;
export const watchAuth = callback => onAuthStateChanged(auth, callback);
export const logout = () => signOut(auth);
export const currentUser = () => auth.currentUser;
export const canEditWorker = () => isAdmin(auth.currentUser) || !!(auth.currentUser && !auth.currentUser.isAnonymous && auth.currentUser.emailVerified);
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
export async function registerWorker(name, email, password) {
  name = name.trim(); email = email.trim();
  if (!name || name.length > 80) throw new Error('Введіть ім’я до 80 символів.');
  if (password.length < 8) throw new Error('Пароль має містити щонайменше 8 символів.');
  await auth.authStateReady();
  if (auth.currentUser && !auth.currentUser.isAnonymous) throw new Error('Спочатку вийдіть із поточного облікового запису.');
  // Upgrade the guest instead of replacing its UID and existing employee binding.
  const result = auth.currentUser?.isAnonymous
    ? await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password))
    : await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, {displayName:name});
  return result.user;
}
export async function sendVerification() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error('Спочатку зареєструйтеся або увійдіть.');
  if (!user.emailVerified) await sendEmailVerification(user);
}
export async function refreshVerification() {
  if (!auth.currentUser) return false;
  await reload(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  return canEditWorker();
}
export const resetPassword = email => sendPasswordResetEmail(auth, email.trim());
export function authMessage(error) {
  const messages = {
    'auth/email-already-in-use':'Ця пошта вже зареєстрована. Увійдіть або відновіть пароль.',
    'auth/credential-already-in-use':'Ця пошта вже зареєстрована. Увійдіть у свій обліковий запис.',
    'auth/invalid-email':'Перевірте електронну адресу.',
    'auth/weak-password':'Пароль надто слабкий. Використайте довший пароль.',
    'auth/invalid-credential':'Неправильна пошта або пароль.',
    'auth/wrong-password':'Неправильна пошта або пароль.',
    'auth/user-not-found':'Неправильна пошта або пароль.',
    'auth/too-many-requests':'Забагато спроб. Зачекайте й повторіть пізніше.',
    'auth/network-request-failed':'Немає з’єднання. Перевірте інтернет.',
    'auth/operation-not-allowed':'Реєстрацію поштою потрібно ввімкнути в налаштуваннях Firebase.',
    'auth/user-disabled':'Обліковий запис вимкнений. Зверніться до адміністратора.'
  };
  return messages[error.code] || (error.code ? 'Не вдалося виконати дію. Спробуйте ще раз.' : error.message);
}
