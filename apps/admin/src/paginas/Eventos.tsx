import { useState, type FormEvent } from 'react'
import { api, usuarioActual } from '../api'
import { portadaDe } from '../carrusel'
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
  finalizado: boolean
}

export function Eventos() {
  const { datos, error, cargando, recargar } = useCarga(() => api<EventoFila[]>('/v1/admin/eventos'), 'eventos')
  const [creando, setCreando] = useState(false)

  const total = datos?.reduce((a, e) => ({ vendidas: a.vendidas + e.vendidas, aforo: a.aforo + e.aforo }), { vendidas: 0, aforo: 0 })
  return (
    <>
      <div className="encabezado">
        <div>
          <span className="sobretitulo">Tus eventos</span>
          <h1>Cartelera</h1>
          {total ? <p className="suave">{datos?.length} eventos · {total.vendidas.toLocaleString('es-PA')} entradas vendidas de {total.aforo.toLocaleString('es-PA')}</p> : null}
        </div>
        <button className="btn btn-grande" onClick={() => setCreando((c) => !c)}>{creando ? 'Cerrar' : '+ Nuevo evento'}</button>
      </div>
      {creando ? <NuevoEvento alCrear={(id) => ir(`/eventos/${id}/configuracion`)} /> : null}
      <Estado cargando={cargando} error={error} reintentar={recargar} vacio={datos?.length === 0 && 'Todavía no hay eventos.'}>
        <div className="tarjetas-eventos">
          {datos?.map((e) => {
            const portada = portadaDe(e.id)
            const f = new Date(e.fecha)
            const pct = e.aforo ? Math.round((e.vendidas / e.aforo) * 100) : 0
            const pasado = e.finalizado
            return (
              <a key={e.id} href={`#/eventos/${e.id}/ventas`} className={`tarjeta-evento ${pasado ? 'pasado' : ''}`}>
                <div className="tarjeta-evento-portada">
                  <img src={portada.imagen} alt="" style={{ objectPosition: portada.foco }} loading="lazy" />
                  <div className="calendario" aria-label={fecha(e.fecha)}>
                    <strong>{f.getDate()}</strong>
                    <span>{f.toLocaleDateString('es-PA', { month: 'short' }).replace('.', '')}</span>
                  </div>
                  <span className={`insignia ${e.estado}`}>{pasado ? 'finalizado' : e.estado}</span>
                </div>
                <div className="tarjeta-evento-cuerpo">
                  <h3>{e.nombre}</h3>
                  <p className="suave">{e.recinto} · {f.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}</p>
                  <div className="ocupacion">
                    <div className="ocupacion-barra"><div style={{ width: `${pct}%` }} /></div>
                    <span>{pct}%</span>
                  </div>
                  <div className="tarjeta-evento-cifras">
                    <span><strong>{e.vendidas}</strong> vendidas</span>
                    <span><strong>{e.disponibles}</strong> disponibles</span>
                    {e.reservadas > 0 ? <span className="en-vivo"><strong>{e.reservadas}</strong> reservando</span> : null}
                  </div>
                </div>
              </a>
            )
          })}
        </div>
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
