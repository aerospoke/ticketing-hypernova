import { useState } from 'react'
import { api } from '../api'
import { Estado } from '../ui'
import { fecha, useCarga } from '../util'

interface Registro {
  id: string
  accion: string
  entidad: string
  entidad_id: string | null
  detalle: Record<string, unknown>
  creado_en: string
  actor_email: string | null
  actor_rol: string | null
  correlacion_id: string | null
}

/** Registro inmutable: la aplicación solo puede insertar y leer (ni UPDATE ni DELETE). */
export function Auditoria() {
  const { datos, error, cargando, recargar } = useCarga(() => api<{ items: Registro[]; siguiente_cursor: string | null }>('/v1/admin/auditoria'), 'auditoria')
  const [mas, setMas] = useState<Registro[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const siguiente = cursor === undefined ? datos?.siguiente_cursor : cursor

  async function cargarMas() {
    if (!siguiente) return
    const r = await api<{ items: Registro[]; siguiente_cursor: string | null }>(`/v1/admin/auditoria?cursor=${siguiente}`)
    setMas((m) => [...m, ...r.items])
    setCursor(r.siguiente_cursor)
  }

  const filas = [...(datos?.items ?? []), ...mas]
  return (
    <>
      <h1>Auditoría</h1>
      <p className="suave">Acciones administrativas. Este registro no se puede modificar ni borrar desde la aplicación.</p>
      <Estado cargando={cargando} error={error} reintentar={recargar} vacio={filas.length === 0 && 'Sin registros.'}>
        <table className="tabla">
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Detalle</th></tr></thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.id}>
                <td>{fecha(r.creado_en)}</td>
                <td>{r.actor_email ?? 'sistema'}<div className="suave">{r.actor_rol}</div></td>
                <td><strong>{r.accion.replaceAll('_', ' ')}</strong></td>
                <td>{r.entidad} {r.entidad_id ? `#${r.entidad_id}` : ''}</td>
                <td><code className="detalle">{JSON.stringify(r.detalle)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        {siguiente ? <button className="btn btn-claro" onClick={() => void cargarMas()}>Cargar más</button> : null}
      </Estado>
    </>
  )
}
