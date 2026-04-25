import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Configuração do Firebase para o projeto Gogoma Sentinel
const firebaseConfig = {
  apiKey: "AIzaSyATvrsZhYJHLE6YaxsqsUiBKIt0TZd4v7A",
  authDomain: "gogoma-sentinel.firebaseapp.com",
  projectId: "gogoma-sentinel",
  storageBucket: "gogoma-sentinel.firebasestorage.app",
  messagingSenderId: "1062770472862",
  appId: "1:1062770472862:web:01ad89b330b13570fa088f",
  measurementId: "G-54WFWHJPHF"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
