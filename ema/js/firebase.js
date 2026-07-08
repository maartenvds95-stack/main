import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, limit, getDocs, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJ3guHYxUIGQ0VkN_W7S8eGLtZhdpkjYk",
  authDomain: "ema-af574.firebaseapp.com",
  projectId: "ema-af574",
  storageBucket: "ema-af574.firebasestorage.app",
  messagingSenderId: "759250028637",
  appId: "1:759250028637:web:e1bc13d1fd25f0b960e5b4",
  measurementId: "G-GLKEE0XJZG"
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, sendPasswordResetEmail,
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, limit, getDocs, where, writeBatch
};
