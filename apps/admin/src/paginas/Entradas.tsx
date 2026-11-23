import { useState } from 'react'
import { api, nuevaClave } from '../api'
import { Estado, Icono } from '../ui'
import { dinero, fecha, mensaje, useCarga } from '../util'

interface Fila {
  id: string
  estado: string
  version: number
  zona: string
  precio_centesimos: number
  emitida_en: string
  usada_en: string | null
  comprador: string
  comprador_email: string
  titular: string
  titular_email: string
}

/** Buscar entradas por comprador y reembolsar o anular con motivo (queda en la auditoría). */
export function Entradas({ id }: { id: string }) {
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const { datos, error, cargando, recargar } = useCarga(
    () => api<{ items: Fila[] }>(`/v1/admin/eventos/${id}/entradas${buscar ? `?q=${encodeURIComponent(buscar)}` : ''}`),
    `entradas-${id}-${buscar}`,
  )
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  async function accion(e: Fila, tipo: 'reembolso' | 'anular') {
    const motivo = window.prompt(`Motivo para ${tipo === 'reembolso' ? 'reembolsar' : 'anular'} la entrada #${e.id}:`)
    if (!motivo) return
    setAviso(null)
    try {
      // Mueve dinero: lleva Idempotency-Key.
      await api(`/v1/admin/entradas/${e.id}/${tipo}`, { metodo: 'POST', clave: nuevaClave(tipo), cuerpo: { motivo } })
      setAviso({ tipo: 'ok', texto: `Entrada #${e.id} ${tipo === 'reembolso' ? 'reembolsada' : 'anulada'}. El lugar volvió a la venta.` })
      await recargar()
    } catch (err) {
      setAviso({ tipo: 'error', texto: mensaje(err) })
    }
  }

  return (
    <div className="pila">
      <form className="en-linea" onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()) }}>
        <label>Buscar por correo, nombre o número de entrada<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="asistente12@correo.test" /></label>
        <button className="btn">Buscar</button>
      </form>
      {aviso ? <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div> : null}
      <Estado cargando={cargando} error={error} reintentar={recargar} vacio={datos?.items.length === 0 && 'Sin resultados.'}>
        <table className="tabla">
          <thead><tr><th>#</th><th className="col-m">Zona</th><th>Comprador</th><th className="col-s">Titular</th><th>Estado</th><th className="col-m">Precio</th><th className="col-l">Emitida</th><th></th></tr></thead>
          <tbody>
            {datos?.items.map((e) => {
              const vigente = e.estado === 'pagada' || e.estado === 'transferida'
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td className="col-m">{e.zona}</td>
                  <td>{e.comprador}<div className="suave">{e.comprador_email}</div></td>
                  <td className="col-s">{e.titular_email === e.comprador_email ? <span className="suave">—</span> : <>{e.titular}<div className="suave">{e.titular_email}</div></>}</td>
                  <td><span className={`insignia ${e.estado}`}>{e.estado}</span>{e.usada_en ? <div className="suave">{fecha(e.usada_en)}</div> : null}</td>
                  <td className="col-m">{dinero(e.precio_centesimos)}</td>
                  <td className="col-l">{fecha(e.emitida_en)}</td>
                  <td className="acciones">
                    <button className="btn btn-claro" disabled={!vigente} onClick={() => void accion(e, 'reembolso')}>Reembolsar</button>
                    <button className="btn btn-peligro" disabled={!vigente} onClick={() => void accion(e, 'anular')}><Icono nombre="cerrar" tam={14} /> Anular</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Estado>
    </div>
  )
}
