import { api } from '../api'
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
          <a href="#/eventos" className="suave">← Eventos</a>
          <div className="fila-titulo">
            <h1>{datos.nombre}</h1>
            <span className={`insignia ${datos.estado}`}>{datos.estado}</span>
          </div>
          <p className="suave">{datos.codigo} · {fecha(datos.fecha)} · {datos.recinto} · límite {datos.limite_por_cuenta} por cuenta</p>
          <nav className="pestanas">
            {SECCIONES.map(([k, t]) => <a key={k} href={`#/eventos/${id}/${k}`} className={seccion === k ? 'activo' : ''}>{t}</a>)}
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
