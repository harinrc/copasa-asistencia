// ============================================================
// CONFIGURACIÓN DE FIREBASE
// Reemplaza estos valores con los de TU proyecto de Firebase:
// Firebase Console > Configuración del proyecto > Tus apps > SDK config
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBVe3Km1eY9nzZj5wa7yXrSciR7_GIHjtw",
  authDomain: "asistencia-copasa.firebaseapp.com",
  projectId: "asistencia-copasa",
  storageBucket: "asistencia-copasa.firebasestorage.app",
  messagingSenderId: "487236491243",
  appId: "1:487236491243:web:1ddf519b53ad068c826bae"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Long polling forzado: algunas redes/antivirus cortan el streaming normal de
// Firestore (WebChannel) a medio camino; forzarlo evita conexiones colgadas.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
