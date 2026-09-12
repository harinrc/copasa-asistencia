// ============================================================
// CONFIGURACIÓN DE FIREBASE
// Reemplaza estos valores con los de TU proyecto de Firebase:
// Firebase Console > Configuración del proyecto > Tus apps > SDK config
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB00GyDS3BXLZsVBilk9PgbslTpO5jGIns",
  authDomain: "copasa-asistencia.firebaseapp.com",
  projectId: "copasa-asistencia",
  storageBucket: "copasa-asistencia.firebasestorage.app",
  messagingSenderId: "978760123021",
  appId: "1:978760123021:web:c63f37cd2ee9c9fec258c4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Long polling forzado: algunas redes/antivirus cortan el streaming normal de
// Firestore (WebChannel) a medio camino; forzarlo evita conexiones colgadas.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
