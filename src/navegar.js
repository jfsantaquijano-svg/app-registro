// Navegación entre pestañas sin dependencias circulares.
let _ir = null;

export function registrarNavegacion(fn) {
  _ir = fn;
}

export function ir(tab, sub) {
  _ir?.(tab, sub);
}
