import type { ReactNode } from 'react'
import { mensaje } from './util'

export type NombreIcono = 'boleto' | 'estrella' | 'agregar' | 'listo' | 'cerrar' | 'reserva' | 'disponible'

/** Ícono decorativo (Icons8). `blanco` lo pinta de blanco para usarlo sobre botones de color. */
export function Icono({ nombre, tam = 18, blanco = false, clase = '' }: { nombre: NombreIcono; tam?: number; blanco?: boolean; clase?: string }) {
  return <img src={`/iconos/${nombre}.png`} alt="" aria-hidden="true" width={tam} height={tam} className={`icono ${blanco ? 'icono-blanco' : ''} ${clase}`} />
}

export function Estado({ cargando, error, vacio, reintentar, children }: { cargando: boolean; error?: unknown; vacio?: string | false; reintentar?: () => void; children: ReactNode }) {
  if (cargando) return <p className="estado">Cargando…</p>
  if (error) return (
    <div className="aviso error">
      <strong>No se pudo cargar.</strong> {mensaje(error)} {reintentar ? <button className="btn btn-claro" onClick={reintentar}>Reintentar</button> : null}
    </div>
  )
  if (vacio) return <div className="estado"><Icono nombre="boleto" tam={56} /><p>{vacio}</p></div>
  return <>{children}</>
}

/**
 * Tarjeta de cifra (KPI). El número escala con el ancho de SU tarjeta (container query) y,
 * si aun así no cabe, se corta con "…" y muestra el valor completo al pasar el mouse.
 * Con `centesimos`, muestra dinero con "US$" más chico que el número.
 */
export function Cifra({ etiqueta, valor, centesimos, nota, icono, ancha = false }: { etiqueta: string; valor?: number; centesimos?: number; nota?: string; icono?: NombreIcono; ancha?: boolean }) {
  const numero = centesimos !== undefined
    ? (centesimos / 100).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (valor ?? 0).toLocaleString('es-PA')
  const completo = centesimos !== undefined ? `US$ ${numero}` : numero
  // Caracteres "visibles" del número (el "US$" va a media altura: cuenta como 2).
  const largo = numero.length + (centesimos !== undefined ? 2 : 0)
  return (
    <div className={`cifra ${icono ? 'con-icono' : ''} ${ancha ? 'cifra-ancha' : ''}`}>
      {icono ? <Icono nombre={icono} tam={30} clase="cifra-icono" /> : null}
      <span>{etiqueta}</span>
      <strong title={completo} style={{ ['--largo' as string]: largo }}>
        {centesimos !== undefined ? <small className="moneda">US$</small> : null}
        {numero}
      </strong>
      {nota ? <small>{nota}</small> : null}
    </div>
  )
}
