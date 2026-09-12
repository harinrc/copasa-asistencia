# Control de Asistencia · Bodega COPASA

Sistema web para reemplazar el reporte de asistencia en Excel. Funciona en tiempo
real (Firestore): si dos personas lo abren al mismo tiempo, ambas ven los
mismos datos actualizados al instante. Incluye inicio de sesión, y exportación
a Excel para enviar el reporte a Recursos Humanos.

## ¿Qué incluye?

- **Login** con Firebase Authentication (correo/contraseña).
- **Empleados**: alta, edición y baja del personal de bodega, con su **saldo
  inicial** del banco de horas (para migrar lo que ya tenían acumulado en el
  Excel).
- **Registro diario** (una fila por empleado y fecha, igual que las pestañas
  "09-09", "08-09" del Excel): entrada, salida, tipo de día, y cálculo
  automático de:
  - **Llegada tarde**: minutos/horas después de la hora estándar de entrada.
    Es un descuento de pago aparte, **no afecta el banco de horas**.
  - **Horas acumuladas de entrada**: si llega antes de la hora estándar.
  - **Horas acumuladas de salida**: si sale después de la hora estándar
    **y no hay una temporada activa** ese día.
  - **Horas extra pagadas**: igual que las anteriores, pero **si hay una
    temporada activa** ese día, en vez de ir al banco se pagan directamente.
  - **Tipos de día especiales**: `Subsidio` (incapacidad del INSS, no
    descuenta nada), `A cuenta de horas acumuladas` (gasta horas del banco),
    `Falta`, `Permiso`, `Vacaciones`.
- **Temporadas**: rangos de fechas (ej. abril-junio, octubre-diciembre) donde
  las horas después del horario se pagan como extra en vez de acumularse al
  banco. Se activan/desactivan con un botón desde **Configuración**.
- **Horario de sábado**: los sábados usan un horario distinto (por defecto
  8:00 a.m.–12:00 p.m.), configurable en **Configuración**. Las horas después
  de esa hora se acumulan al banco igual que un día normal.
- **Feriados**: fechas puntuales (ej. 25 de diciembre) en las que, si alguien
  trabaja, **todas** las horas trabajadas ese día se pagan como extra (no se
  acumulan al banco), sin importar el horario estándar. Se administran en
  **Configuración > Feriados**.
- **Llegadas tarde y permisos**: si alguien llega tarde o sale antes sin
  autorización, esas horas son un descuento de pago aparte y no tocan el
  banco. Si administración autoriza un permiso (parcial o de día completo),
  esas horas se registran como "A cuenta de acumulado / permiso autorizado"
  y sí se descuentan del banco. Los días de incapacidad (Subsidio INSS) no
  descuentan nada; solo se guarda la hora de entrada/salida como referencia.
- **Reporte de acumulado (banco de horas)**: saldo inicial + ganado − gastado
  = saldo final por empleado, convertido a días disponibles, y días ya
  gozados con cargo al banco.
- **Reporte de horas deducidas**: detalle de los días en que se gastaron
  horas del banco.
- **Exportar a Excel** (.xlsx) con 3 hojas: Detalle, Banco de horas y Horas
  deducidas — lista para enviar a Recursos Humanos.
- **Roles**: el primer usuario que se registra queda como `admin` (edita
  todo). Los siguientes quedan como `empleado` (solo lectura).
- **Tiempo real**: todos los usuarios conectados ven los cambios sin recargar
  la página (Firestore `onSnapshot`).

### Cómo migrar tus datos actuales del Excel

1. Crea cada empleado con su **cargo** y su **saldo inicial de horas**
   (el total que ya tenía acumulado según tu "Reporte de Acumulado" actual,
   convertido a horas) y la fecha en que empiezas a usar el sistema.
2. A partir de esa fecha, registra los días normalmente desde la app; el
   sistema calcula el resto automáticamente.
3. Si tu horario estándar no es 8:00 a.m.–5:00 p.m., ajústalo en
   **Configuración**.
4. Si aplican temporadas de pago de horas extra (ej. abril–junio), créalas en
   **Configuración > Temporadas**.


---

## 1. Crear el proyecto en Firebase

1. Ve a https://console.firebase.google.com y crea un proyecto nuevo (por
   ejemplo `copasa-asistencia`).
2. En el menú lateral entra a **Compilación > Authentication** →
   pestaña **Sign-in method** → habilita **Correo electrónico/contraseña**.
3. En **Compilación > Authentication > Users**, crea manualmente el primer
   usuario (tu correo) con una contraseña, o regístralo la primera vez que
   entres si agregas una pantalla de registro (este proyecto asume que tú
   creas los usuarios desde la consola de Firebase, para controlar quién
   entra).
4. Entra a **Compilación > Firestore Database** → **Crear base de datos** →
   elige modo **producción** y la región más cercana.
5. Ve a **Configuración del proyecto** (ícono de engranaje) → pestaña
   **General** → sección "Tus apps" → clic en el ícono `</>` (Web) → registra
   una app (nombre: "Web COPASA").
6. Copia el objeto `firebaseConfig` que te muestra y pégalo en
   [js/firebase-config.js](js/firebase-config.js), reemplazando los valores
   `TU_API_KEY`, `TU_PROYECTO`, etc.

## 2. Publicar las reglas de seguridad de Firestore

Las reglas ([firestore.rules](firestore.rules)) ya están escritas: solo
usuarios autenticados pueden leer, y solo el `admin` puede escribir. Para
publicarlas:

```powershell
npm install -g firebase-tools
firebase login
firebase init firestore   # selecciona el proyecto que creaste
firebase deploy --only firestore:rules
```

## 3. Probar en local

Como el proyecto no tiene build (HTML/CSS/JS puro), solo necesitas un
servidor local simple para evitar problemas de módulos ES:

```powershell
npx serve .
# o
python -m http.server 5500
```

Abre `http://localhost:5500/login.html`, entra con el usuario que creaste en
Firebase, y prueba agregar empleados y registros.

## 4. Subir el código a GitHub

```powershell
git init
git add .
git commit -m "Sistema de control de asistencia COPASA"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

(Crea antes el repositorio vacío en https://github.com/new)

## 5. Desplegar el sitio (Firebase Hosting, gratis)

```powershell
firebase init hosting   # public directory: "." (raíz), single-page app: No
firebase deploy --only hosting
```

Al terminar te dará una URL tipo `https://TU_PROYECTO.web.app` que puedes
compartir con quien deba usar el sistema. También puedes conectar el deploy
automático a GitHub Actions desde `firebase init hosting` (te pregunta si
quieres configurar despliegue continuo con GitHub).

## 6. Agregar más usuarios

Cada persona que deba usar el sistema necesita una cuenta creada en
**Authentication > Users** (correo + contraseña). Si quieres que un usuario
sea administrador (puede editar), ve a **Firestore Database > users >
{su uid}** y cambia el campo `role` a `"admin"`. Por defecto todos los nuevos
usuarios quedan como `"empleado"` (solo lectura).

## Estructura del proyecto

```
├── index.html            # redirige a login
├── login.html            # pantalla de inicio de sesión
├── dashboard.html         # pantalla principal (empleados, asistencia, resumen)
├── css/styles.css
├── js/
│   ├── firebase-config.js # ⚠️ pon aquí tus credenciales de Firebase
│   ├── auth.js             # lógica de login
│   └── app.js              # CRUD, tiempo real, cálculo de horas, export Excel
├── firestore.rules
├── firestore.indexes.json
└── firebase.json
```

## Próximos pasos sugeridos

- Ajustar las columnas del Excel exportado a tu formato exacto de RRHH.
- Agregar reglas de negocio específicas (recargo nocturno, feriados, tarifa
  por hora) si RRHH las necesita calculadas dentro del sistema.
- Agregar una pantalla de administración de usuarios/roles dentro de la app
  (hoy se hace manualmente desde la consola de Firebase).
