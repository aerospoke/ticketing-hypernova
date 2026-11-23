import { api } from '../api'
import { portadaDe } from '../carrusel'
import { Estado } from '../ui'
import { fecha, useCarga } from '../util'
import { Accesos } from './Accesos'
import { Configuracion, type DetalleAdmin } from './Configuracion'
import { Entradas } from './Entradas'
import { Incidentes } from './Incidentes'
import { Ventas } from './Ventas'

const SECCIONES = [
  ['ventas', 'Ventas'],
  ['configuracion', 'Configuración'],
  ['entradas', 'Entradas'],
  ['accesos', 'Accesos'],
  ['incidentes', 'Incidentes'],
] as const

export function Evento({ id, seccion }: { id: string; seccion: string }) {
  const { datos, error, cargando, recargar } = useCarga(() => api<DetalleAdmin>(`/v1/admin/eventos/${id}`), `evento-${id}`)

  return (
    <Estado cargando={cargando && !datos} error={!datos && error} reintentar={recargar}>
      {datos ? (
        <>
          <section className="banner" style={{ ['--portada' as string]: `url(${portadaDe(datos.id).imagen})` }}>
            <img src={portadaDe(datos.id).imagen} alt="" style={{ objectPosition: portadaDe(datos.id).foco }} />
            <div className="banner-texto">
              <a href="#/eventos" className="volver">← Cartelera</a>
              <span className={`insignia ${datos.finalizado ? 'finalizado' : datos.estado}`}>{datos.finalizado ? 'finalizado' : datos.estado}</span>
              <h1>{datos.nombre}</h1>
              <p>{fecha(datos.fecha)} · {datos.recinto} · máximo {datos.limite_por_cuenta} por cuenta · <code>{datos.codigo}</code></p>
            </div>
          </section>
          <nav className="pestanas" aria-label="Secciones del evento">
            {SECCIONES.map(([k, t]) => <a key={k} href={`#/eventos/${id}/${k}`} className={seccion === k ? 'activo' : ''} aria-current={seccion === k ? 'page' : undefined}>{t}</a>)}
          </nav>
          {seccion === 'ventas' && <Ventas id={id} />}
          {seccion === 'configuracion' && <Configuracion evento={datos} recargar={recargar} />}
          {seccion === 'entradas' && <Entradas id={id} />}
          {seccion === 'accesos' && <Accesos id={id} />}
          {seccion === 'incidentes' && <Incidentes id={id} />}
        </>
      ) : null}
    </Estado>
  )
}
