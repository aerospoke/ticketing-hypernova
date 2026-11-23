import { api } from '../api'
import { Estado } from '../ui'
import { dinero, fecha, useCarga } from '../util'

interface Fila {
  id: string
  nombre: string
  aforo: number
  vendidas: number
  reservadas: number
  disponibles: number
  precio_vigente: number | null
  cobrado_centesimos: number
  reembolsado_centesimos: number
  neto_centesimos: number
  ingresaron: number
}
interface Ventas {
  consultado_en: string
  zonas: Fila[]
  totales: Omit<Fila, 'id' | 'nombre' | 'precio_vigente'>
}

/** Tiempo casi real: se refresca cada 5 s. */
export function Ventas({ id }: { id: string }) {
  const { datos, error, cargando, recargar } = useCarga(() => api<Ventas>(`/v1/admin/eventos/${id}/ventas`), `ventas-${id}`, 5000)
  const t = datos?.totales
  return (
    <Estado cargando={cargando && !datos} error={!datos && error} reintentar={recargar} vacio={datos?.zonas.length === 0 && 'El evento todavía no tiene zonas.'}>
      {datos && t ? (
        <>
          <div className="cifras">
            <div className="cifra"><span>Vendidas</span><strong>{t.vendidas}</strong><small>de {t.aforo}</small></div>
            <div className="cifra"><span>Reservadas ahora</span><strong>{t.reservadas}</strong></div>
            <div className="cifra"><span>Disponibles</span><strong>{t.disponibles}</strong></div>
            <div className="cifra"><span>Ingreso neto</span><strong>{dinero(t.neto_centesimos)}</strong><small>reembolsado {dinero(t.reembolsado_centesimos)}</small></div>
            <div className="cifra"><span>Ya ingresaron</span><strong>{t.ingresaron}</strong></div>
          </div>
          <table className="tabla">
            <thead><tr><th>Zona</th><th>Ocupación</th><th>Vendidas</th><th className="col-l">Reservadas</th><th className="col-m">Disponibles</th><th className="col-l">Precio vigente</th><th className="col-m">Cobrado</th><th className="col-m">Reembolsado</th><th>Neto</th></tr></thead>
            <tbody>
              {datos.zonas.map((z) => {
                const pct = Math.round(((z.vendidas + z.reservadas) / z.aforo) * 100)
                return (
                  <tr key={z.id}>
                    <td><strong>{z.nombre}</strong></td>
                    <td><div className="barra" aria-label={`${pct}% ocupado`}><div style={{ width: `${(z.vendidas / z.aforo) * 100}%` }} /><div className="reserva" style={{ width: `${(z.reservadas / z.aforo) * 100}%` }} /></div><small>{pct}%</small></td>
                    <td className="num">{z.vendidas} / {z.aforo}</td>
                    <td className="col-l">{z.reservadas}</td>
                    <td className="col-m">{z.disponibles}</td>
                    <td className="num col-l">{z.precio_vigente != null ? dinero(z.precio_vigente) : '—'}</td>
                    <td className="num col-m">{dinero(z.cobrado_centesimos)}</td>
                    <td className="num col-m">{dinero(z.reembolsado_centesimos)}</td>
                    <td className="num"><strong>{dinero(z.neto_centesimos)}</strong></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="suave">Actualizado {fecha(datos.consultado_en)} · se refresca solo cada 5 s.</p>
        </>
      ) : null}
    </Estado>
  )
}
