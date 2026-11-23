import { api } from '../api'
import { Estado } from '../ui'
import { fecha, useCarga } from '../util'

interface Accesos {
  dentro_del_recinto: number
  por_puerta: { id: string; nombre: string; validos: number; duplicados: number; rechazados: number }[]
  por_hora: { hora: string; validos: number }[]
  dispositivos: { id: string; nombre: string; staff: string; puerta: string; ultima_sync: string | null; minutos_sin_sync: number | null; turno_abierto: boolean; escaneos: number }[]
}

/** Ingresos por puerta y por hora, aforo dentro del recinto y dispositivos. Se refresca cada 10 s. */
export function Accesos({ id }: { id: string }) {
  const { datos, error, cargando, recargar } = useCarga(() => api<Accesos>(`/v1/admin/eventos/${id}/accesos`), `accesos-${id}`, 10_000)
  const max = Math.max(1, ...(datos?.por_hora.map((h) => h.validos) ?? []))
  return (
    <Estado cargando={cargando && !datos} error={!datos && error} reintentar={recargar}>
      {datos ? (
        <div className="pila">
          <div className="cifras">
            <div className="cifra"><span>Dentro del recinto</span><strong>{datos.dentro_del_recinto}</strong></div>
            <div className="cifra"><span>Dobles ingresos</span><strong>{datos.por_puerta.reduce((a, p) => a + p.duplicados, 0)}</strong></div>
            <div className="cifra"><span>Rechazos</span><strong>{datos.por_puerta.reduce((a, p) => a + p.rechazados, 0)}</strong></div>
          </div>

          <section className="tarjeta">
            <h2>Por puerta</h2>
            {datos.por_puerta.length === 0 ? <p className="suave">El evento no tiene puertas.</p> : (
              <table className="tabla compacta">
                <thead><tr><th>Puerta</th><th>Válidos</th><th>Dobles ingresos</th><th>Rechazados</th></tr></thead>
                <tbody>{datos.por_puerta.map((p) => <tr key={p.id}><td>{p.nombre}</td><td>{p.validos}</td><td>{p.duplicados}</td><td>{p.rechazados}</td></tr>)}</tbody>
              </table>
            )}
          </section>

          <section className="tarjeta">
            <h2>Por hora</h2>
            {datos.por_hora.length === 0 ? <p className="suave">Todavía no hay ingresos.</p> : (
              <div className="histograma" role="img" aria-label="Ingresos válidos por hora">
                {datos.por_hora.map((h) => (
                  <div key={h.hora} className="columna" title={`${fecha(h.hora)}: ${h.validos}`}>
                    <span>{h.validos}</span>
                    <div style={{ height: `${(h.validos / max) * 120}px` }} />
                    <small>{new Date(h.hora).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}</small>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="tarjeta">
            <h2>Dispositivos</h2>
            {datos.dispositivos.length === 0 ? <p className="suave">Ningún escáner inició turno en este evento.</p> : (
              <table className="tabla compacta">
                <thead><tr><th>Dispositivo</th><th className="col-s">Staff</th><th>Puerta</th><th className="col-m">Turno</th><th className="col-s">Escaneos</th><th>Última sincronización</th></tr></thead>
                <tbody>
                  {datos.dispositivos.map((d) => {
                    const minutos = d.minutos_sin_sync ?? Infinity
                    return (
                      <tr key={d.id}>
                        <td>{d.nombre}</td><td className="col-s">{d.staff}</td><td>{d.puerta}</td>
                        <td className="col-m">{d.turno_abierto ? 'abierto' : 'cerrado'}</td>
                        <td className="col-s">{d.escaneos}</td>
                        <td className={d.turno_abierto && minutos > 10 ? 'alerta' : ''}>{fecha(d.ultima_sync)}{d.turno_abierto && minutos > 10 ? ' · sin sincronizar hace rato' : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </Estado>
  )
}
