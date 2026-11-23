/**
 * Fotos del carrusel del login. Para cambiar un nombre, edita `artista` y `detalle`.
 * Para cambiar una foto, reemplaza el archivo en `public/carrusel/` (mismo nombre) o
 * agrega una entrada nueva aquí. `foco` decide qué parte de la foto queda visible al
 * recortarla (CSS object-position).
 */
export interface Diapositiva {
  imagen: string
  artista: string
  detalle: string
  foco?: string
}

export const DIAPOSITIVAS: Diapositiva[] = [
  { imagen: '/carrusel/01.jpg', artista: 'Shakira', detalle: 'Las Mujeres Ya No Lloran · Estadio', foco: '45% 25%' },
  { imagen: '/carrusel/02.jpg', artista: 'Drake', detalle: 'En vivo · Arena', foco: 'center 25%' },
  { imagen: '/carrusel/03.jpg', artista: 'Karol G', detalle: 'Carnaval · Escenario principal', foco: '50% 35%' },
  { imagen: '/carrusel/04.jpg', artista: 'The Weeknd', detalle: 'After Hours til Dawn · Estadio', foco: '50% 35%' },
  { imagen: '/carrusel/05.jpg', artista: 'Sandra Sandoval', detalle: 'Rebeldía Tour', foco: '48% 30%' },
  { imagen: '/carrusel/06.jpg', artista: 'Nando Boom', detalle: 'Reggae en español · Teatro', foco: '50% 30%' },
]

/**
 * Portada de un evento: una foto del carrusel, estable por id. El id se mezcla
 * (hash multiplicativo de Knuth) antes del módulo: con `id % n`, ids que difieren en un
 * múltiplo de n (p. ej. 1 y 7 con 6 fotos) tendrían la misma portada.
 */
export function portadaDe(eventoId: string): Diapositiva {
  const mezcla = Math.imul(Number(eventoId), 2654435761) >>> 0
  return DIAPOSITIVAS[mezcla % DIAPOSITIVAS.length]
}
