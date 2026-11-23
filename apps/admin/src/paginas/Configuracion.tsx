import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { aLocal, dinero, desdeLocal, fecha, mensaje } from '../util'

export interface DetalleAdmin {
  id: string
  codigo: string
  nombre: string
  recinto: string
  fecha: string
  venta_abre: string
  reembolsable_hasta: string
  limite_por_cuenta: number
  estado: 'borrador' | 'publicado' | 'cancelado'
  finalizado: boolean
  organizador_id: string
  zonas: { id: string; nombre: string; aforo: number; vendidas: number; reservadas: number; fases: { id: string; fase: string; precio_centesimos: number; desde: string; hasta: string }[] }[]
  puertas: { id: string; nombre: string }[]
  staff: { id: string; nombre: string; email: string }[]
}

/** Edición del evento: datos, zonas con aforo, fases de precio, puertas y staff. */
export function Configuracion({ evento, recargar }: { evento: DetalleAdmin; recargar: () => Promise<void> }) {
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  /** Ejecuta un cambio y muestra el error de la API tal cual (p. ej. aforo menor que lo vendido). */
  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setAviso(null)
    try {
      await fn()
      setAviso({ tipo: 'ok', texto: ok })
      await recargar()
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
    }
  }
  const base = `/v1/admin/eventos/${evento.id}`

  return (
    <div className="pila">
      {aviso ? <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div> : null}
      <DatosEvento evento={evento} hacer={hacer} />

      <section className="tarjeta">
        <h2>Zonas y fases de precio</h2>
        {evento.zonas.map((z) => <ZonaEditor key={z.id} zona={z} hacer={hacer} />)}
        <FormLinea
          campos={[['nombre', 'Nombre de la zona', 'text'], ['aforo', 'Aforo', 'number']]}
          boton="Agregar zona"
          enviar={(v) => hacer(() => api(`${base}/zonas`, { metodo: 'POST', cuerpo: { nombre: v.nombre, aforo: Number(v.aforo) } }), 'Zona agregada')}
        />
      </section>

      <section className="tarjeta">
        <h2>Puertas</h2>
        <p>{evento.puertas.map((p) => p.nombre).join(' · ') || <span className="suave">Sin puertas.</span>}</p>
        <FormLinea campos={[['nombre', 'Nombre de la puerta', 'text']]} boton="Agregar puerta"
          enviar={(v) => hacer(() => api(`${base}/puertas`, { metodo: 'POST', cuerpo: { nombre: v.nombre } }), 'Puerta agregada')} />
      </section>

      <section className="tarjeta">
        <h2>Staff asignado</h2>
        <ul className="lista">
          {evento.staff.map((s) => (
            <li key={s.id}>{s.nombre} <span className="suave">{s.email} · id {s.id}</span>{' '}
              <button className="btn btn-claro" onClick={() => void hacer(() => api(`${base}/staff/${s.id}`, { metodo: 'DELETE' }), 'Staff quitado')}>Quitar</button>
            </li>
          ))}
          {evento.staff.length === 0 ? <li className="suave">Nadie asignado.</li> : null}
        </ul>
        <FormLinea campos={[['id', 'ID del staff (p. ej. 100301)', 'text']]} boton="Asignar"
          enviar={(v) => hacer(() => api(`${base}/staff/${v.id}`, { metodo: 'PUT' }), 'Staff asignado')} />
      </section>
    </div>
  )
}

type Hacer = (fn: () => Promise<unknown>, ok: string) => Promise<void>

function DatosEvento({ evento, hacer }: { evento: DetalleAdmin; hacer: Hacer }) {
  const [f, setF] = useState({
    nombre: evento.nombre, recinto: evento.recinto, fecha: aLocal(evento.fecha), venta_abre: aLocal(evento.venta_abre),
    reembolsable_hasta: aLocal(evento.reembolsable_hasta), limite_por_cuenta: evento.limite_por_cuenta, estado: evento.estado,
  })
  function guardar(e: FormEvent) {
    e.preventDefault()
    void hacer(() => api(`/v1/admin/eventos/${evento.id}`, {
      metodo: 'PATCH',
      cuerpo: { ...f, fecha: desdeLocal(f.fecha), venta_abre: desdeLocal(f.venta_abre), reembolsable_hasta: desdeLocal(f.reembolsable_hasta) },
    }), 'Evento actualizado')
  }
  return (
    <form className="tarjeta rejilla" onSubmit={guardar}>
      <h2 className="ancho">Datos del evento</h2>
      <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
      <label>Recinto<input value={f.recinto} onChange={(e) => setF({ ...f, recinto: e.target.value })} /></label>
      <label>Fecha<input type="datetime-local" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
      <label>Abre la venta<input type="datetime-local" value={f.venta_abre} onChange={(e) => setF({ ...f, venta_abre: e.target.value })} /></label>
      <label>Reembolsable hasta<input type="datetime-local" value={f.reembolsable_hasta} onChange={(e) => setF({ ...f, reembolsable_hasta: e.target.value })} /></label>
      <label>Límite por cuenta<input type="number" min={1} max={100} value={f.limite_por_cuenta} onChange={(e) => setF({ ...f, limite_por_cuenta: Number(e.target.value) })} /></label>
      <label>Estado
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value as DetalleAdmin['estado'] })}>
          <option value="borrador">Borrador (no visible)</option>
          <option value="publicado">Publicado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </label>
      <div className="ancho"><button className="btn">Guardar</button></div>
    </form>
  )
}

function ZonaEditor({ zona, hacer }: { zona: DetalleAdmin['zonas'][number]; hacer: Hacer }) {
  const [aforo, setAforo] = useState(String(zona.aforo))
  return (
    <div className="zona">
      <div className="fila-titulo">
        <h3>{zona.nombre} <small className="suave">vendidas {zona.vendidas} · reservadas {zona.reservadas}</small></h3>
        <form className="en-linea" onSubmit={(e) => { e.preventDefault(); void hacer(() => api(`/v1/admin/zonas/${zona.id}`, { metodo: 'PATCH', cuerpo: { aforo: Number(aforo) } }), 'Aforo actualizado') }}>
          <label>Aforo <input type="number" min={1} value={aforo} onChange={(e) => setAforo(e.target.value)} /></label>
          <button className="btn btn-claro">Guardar aforo</button>
        </form>
      </div>
      <table className="tabla compacta">
        <thead><tr><th>Fase</th><th>Precio</th><th>Desde</th><th>Hasta</th></tr></thead>
        <tbody>
          {zona.fases.map((f) => <tr key={f.id}><td>{f.fase}</td><td>{dinero(f.precio_centesimos)}</td><td>{fecha(f.desde)}</td><td>{fecha(f.hasta)}</td></tr>)}
        </tbody>
      </table>
      <FormLinea
        campos={[['fase', 'Fase (preventa, general, taquilla)', 'text'], ['precio', 'Precio en US$', 'number'], ['desde', 'Desde', 'datetime-local'], ['hasta', 'Hasta', 'datetime-local']]}
        boton="Agregar fase"
        enviar={(v) => hacer(() => api(`/v1/admin/zonas/${zona.id}/fases`, {
          metodo: 'POST',
          // El portal trabaja en dólares; a la API siempre van centésimos enteros.
          cuerpo: { fase: v.fase, precio_centesimos: Math.round(Number(v.precio) * 100), desde: desdeLocal(v.desde), hasta: desdeLocal(v.hasta) },
        }), 'Fase agregada')}
      />
    </div>
  )
}

function FormLinea({ campos, boton, enviar }: { campos: [string, string, string][]; boton: string; enviar: (v: Record<string, string>) => Promise<void> }) {
  const [v, setV] = useState<Record<string, string>>({})
  return (
    <form className="en-linea" onSubmit={(e) => { e.preventDefault(); void enviar(v).then(() => setV({})) }}>
      {campos.map(([k, etiqueta, tipo]) => (
        <label key={k}>{etiqueta}<input type={tipo} step={tipo === 'number' ? 'any' : undefined} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} required /></label>
      ))}
      <button className="btn btn-claro">{boton}</button>
    </form>
  )
}
