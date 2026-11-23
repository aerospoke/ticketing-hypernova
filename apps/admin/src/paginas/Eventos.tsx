import { useState, type FormEvent } from 'react'
import { api, usuarioActual } from '../api'
import { Estado } from '../ui'
import { desdeLocal, fecha, ir, mensaje, useCarga } from '../util'

interface EventoFila {
  id: string
  codigo: string
  nombre: string
  recinto: string
  fecha: string
  estado: string
  aforo: number
  vendidas: number
  reservadas: number
  disponibles: number
}

export function Eventos() {
  const { datos, error, cargando, recargar } = useCarga(() => api<EventoFila[]>('/v1/admin/eventos'), 'eventos')
  const [creando, setCreando] = useState(false)

  return (
    <>
      <div className="fila-titulo">
        <h1>Eventos</h1>
        <button className="btn" onClick={() => setCreando((c) => !c)}>{creando ? 'Cerrar' : 'Nuevo evento'}</button>
      </div>
      {creando ? <NuevoEvento alCrear={(id) => ir(`/eventos/${id}/configuracion`)} /> : null}
      <Estado cargando={cargando} error={error} reintentar={recargar} vacio={datos?.length === 0 && 'Todavía no hay eventos.'}>
        <table className="tabla">
          <thead><tr><th>Evento</th><th>Fecha</th><th>Estado</th><th>Vendidas</th><th>Reservadas</th><th>Disponibles</th></tr></thead>
          <tbody>
            {datos?.map((e) => (
              <tr key={e.id} className="clic" onClick={() => ir(`/eventos/${e.id}/ventas`)}>
                <td><strong>{e.nombre}</strong><div className="suave">{e.codigo} · {e.recinto}</div></td>
                <td>{fecha(e.fecha)}</td>
                <td><span className={`insignia ${e.estado}`}>{e.estado}</span></td>
                <td>{e.vendidas} / {e.aforo}</td>
                <td>{e.reservadas}</td>
                <td>{e.disponibles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </>
  )
}

function NuevoEvento({ alCrear }: { alCrear: (id: string) => void }) {
  const [f, setF] = useState({ codigo: '', nombre: '', recinto: '', fecha: '', venta_abre: '', reembolsable_hasta: '', limite_por_cuenta: 4, organizador_id: '' })
  const [error, setError] = useState<string | null>(null)
  const esAdmin = usuarioActual()?.rol === 'admin'
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'limite_por_cuenta' ? Number(e.target.value) : e.target.value })

  async function crear(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const r = await api<{ id: string }>('/v1/admin/eventos', {
        metodo: 'POST',
        cuerpo: {
          ...f,
          fecha: desdeLocal(f.fecha), venta_abre: desdeLocal(f.venta_abre), reembolsable_hasta: desdeLocal(f.reembolsable_hasta),
          organizador_id: esAdmin ? f.organizador_id : undefined, estado: 'borrador',
        },
      })
      alCrear(r.id)
    } catch (err) {
      setError(mensaje(err))
    }
  }

  return (
    <form className="tarjeta rejilla" onSubmit={crear}>
      <label>Código<input value={f.codigo} onChange={set('codigo')} required /></label>
      <label>Nombre<input value={f.nombre} onChange={set('nombre')} required /></label>
      <label>Recinto<input value={f.recinto} onChange={set('recinto')} required /></label>
      <label>Fecha del evento<input type="datetime-local" value={f.fecha} onChange={set('fecha')} required /></label>
      <label>Abre la venta<input type="datetime-local" value={f.venta_abre} onChange={set('venta_abre')} required /></label>
      <label>Reembolsable hasta<input type="datetime-local" value={f.reembolsable_hasta} onChange={set('reembolsable_hasta')} required /></label>
      <label>Límite por cuenta<input type="number" min={1} max={100} value={f.limite_por_cuenta} onChange={set('limite_por_cuenta')} required /></label>
      {esAdmin ? <label>ID del organizador<input value={f.organizador_id} onChange={set('organizador_id')} placeholder="100201" required /></label> : null}
      {error ? <div className="aviso error ancho">{error}</div> : null}
      <div className="ancho"><button className="btn">Crear en borrador</button> <span className="suave">Después agregas zonas, fases y puertas, y lo publicas.</span></div>
    </form>
  )
}
