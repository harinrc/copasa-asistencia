// Configuración del horario estándar (lunes-viernes y sábado).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  document.getElementById("user-email").textContent = user.email;
  const snap = await getDoc(doc(db, "users", user.uid));
  const isAdmin = snap.exists() && snap.data().role === "admin";
  document.getElementById("user-role").textContent = isAdmin ? "Administrador" : "Empleado";
  document.querySelectorAll(".admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");

  onSnapshot(doc(db, "config", "horario"), (s) => {
    if (s.exists()) {
      document.getElementById("cfg-entrada").value = s.data().entrada || "08:00";
      document.getElementById("cfg-salida").value = s.data().salida || "17:00";
      document.getElementById("cfg-entrada-sabado").value = s.data().entradaSabado || "08:00";
      document.getElementById("cfg-salida-sabado").value = s.data().salidaSabado || "12:00";
    }
  });
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

document.getElementById("btn-guardar-config").addEventListener("click", async () => {
  const entrada = document.getElementById("cfg-entrada").value;
  const salida = document.getElementById("cfg-salida").value;
  const entradaSabado = document.getElementById("cfg-entrada-sabado").value;
  const salidaSabado = document.getElementById("cfg-salida-sabado").value;
  const btn = document.getElementById("btn-guardar-config");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    await setDoc(doc(db, "config", "horario"), { entrada, salida, entradaSabado, salidaSabado });
    btn.textContent = "Guardado ✓";
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    alert("No se pudo guardar: " + (err?.message || err));
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
});
