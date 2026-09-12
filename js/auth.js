// Lógica de la pantalla de inicio de sesión
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const form = document.getElementById("login-form");
const errorEl = document.getElementById("auth-error");
const forgotBtn = document.getElementById("forgot-btn");

// Si ya hay sesión activa, va directo al dashboard
onAuthStateChanged(auth, (user) => {
  if (user) window.location.replace("dashboard.html");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.replace("dashboard.html");
  } catch (err) {
    errorEl.textContent = mensajeError(err.code);
    errorEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Ingresar";
  }
});

forgotBtn.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  if (!email) {
    errorEl.textContent = "Escribe tu correo primero para enviarte el enlace de recuperación.";
    errorEl.hidden = false;
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    errorEl.textContent = "Te enviamos un correo para restablecer tu contraseña.";
    errorEl.hidden = false;
  } catch (err) {
    errorEl.textContent = mensajeError(err.code);
    errorEl.hidden = false;
  }
});

function mensajeError(code) {
  const mapa = {
    "auth/invalid-email": "Correo inválido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Intenta más tarde."
  };
  return mapa[code] || "Ocurrió un error al iniciar sesión.";
}
