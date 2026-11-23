import type { ReactNode } from 'react'
import { mensaje } from './util'

export function Estado({ cargando, error, vacio, reintentar, children }: { cargando: boolean; error?: unknown; vacio?: string | false; reintentar?: () => void; children: ReactNode }) {
  if (cargando) return <p className="estado">Cargando…</p>
  if (error) return (
    <div className="aviso error">
      <strong>No se pudo cargar.</strong> {mensaje(error)} {reintentar ? <button className="btn btn-claro" onClick={reintentar}>Reintentar</button> : null}
    </div>
  )
  if (vacio) return <p className="estado">{vacio}</p>
  return <>{children}</>
}
