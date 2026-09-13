// Carrusel de fondo del login: imágenes que cambian al azar con fundido y
// zoom suave (efecto "Ken Burns"). Para agregar/quitar fotos, solo edita
// este arreglo — no hace falta tocar el HTML ni el CSS.
const IMAGENES = [
  "img/banner-1.jpg",
  "img/banner-2.webp"
  // Agrega más fotos aquí cuando quieras (jpg, png o webp funcionan igual)
];

const DURACION_MS = 7000; // cuánto dura cada foto en pantalla

const contenedor = document.getElementById("slideshow");
if (contenedor) {
  const slides = IMAGENES.map((src) => {
    const div = document.createElement("div");
    div.className = "slide";
    div.style.backgroundImage = `url('${src}')`;
    contenedor.appendChild(div);
    return div;
  });

  let actual = -1;

  function mostrar(indice) {
    slides.forEach((slide, i) => {
      if (i === indice) {
        // Reinicia la animación de zoom quitando y volviendo a poner la clase
        slide.classList.remove("zoom");
        void slide.offsetWidth; // fuerza el reflow para reiniciar el keyframe
        slide.classList.add("zoom", "active");
      } else {
        slide.classList.remove("active", "zoom");
      }
    });
  }

  function siguiente() {
    if (slides.length === 0) return;
    let indice = actual;
    if (slides.length > 1) {
      while (indice === actual) indice = Math.floor(Math.random() * slides.length);
    } else {
      indice = 0;
    }
    actual = indice;
    mostrar(actual);
  }

  if (slides.length > 0) {
    siguiente();
    setInterval(siguiente, DURACION_MS);
  }
}
