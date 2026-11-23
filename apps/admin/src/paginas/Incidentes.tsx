import { useState } from 'react'
import { api } from '../api'
import { Estado } from '../ui'
import { fecha, mensaje, useCarga } from '../util'

interface Incidente {
  id: string
  tipo: 'doble_ingreso' | 'firma_invalida' | 'escaner_desincronizado' | 'pico_compra'
  estado: 'abierto' | 'resuelto'
  entrada_id: string | null
  puerta: string | null
  creado_en: string
  detalle: {
    ingreso_valido?: { puerta_id: string; escaneado_en: string }
    ingreso_duplicado?: { puerta_id: string; escaneado_en: string }
    estado_entrada?: string
    nota_resolucion?: string
  }
}

const TIPO: Record<Incidente['tipo'], string> = {
  doble_ingreso: 'Doble ingreso',
  firma_invalida: 'Firma inválida',
  escaner_desincronizado: 'Escáner desincronizado',
  pico_compra: 'Pico de compra',
}

/** Incidentes del evento (se refresca cada 10 s). El segundo ingreso nunca se borra: se revisa aquí. */
export function Incidentes({ id }: { id: string }) {
  const { datos, error, cargando, recargar } = useCarga(() => api<{ items: Incidente[] }>(`/v1/admin/eventos/${id}/incidentes`), `incidentes-${id}`, 10_000)
  const [aviso, setAviso] = useState<string | null>(null)

  async function resolver(i: Incidente) {
    const nota = window.prompt('¿Cómo se resolvió?')
    if (!nota) return
    try {
      await api(`/v1/admin/incidentes/${i.id}/resolver`, { metodo: 'POST', cuerpo: { nota } })
      await recargar()
    } catch (e) {
      setAviso(mensaje(e))
    }
  }

  return (
    <Estado cargando={cargando && !datos} error={!datos && error} reintentar={recargar} vacio={datos?.items.length === 0 && 'Sin incidentes. 🎉'}>
      {aviso ? <div className="aviso error">{aviso}</div> : null}
      <table className="tabla">
        <thead><tr><th>Tipo</th><th>Entrada</th><th>Detalle</th><th>Detectado</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {datos?.items.map((i) => (
            <tr key={i.id} className={i.estado === 'abierto' ? 'abierto' : ''}>
              <td><strong>{TIPO[i.tipo]}</strong></td>
              <td>{i.entrada_id ? `#${i.entrada_id}` : '—'}</td>
              <td>
                {i.tipo === 'doble_ingreso' && i.detalle.ingreso_valido && i.detalle.ingreso_duplicado ? (
                  <>Válido: {fecha(i.detalle.ingreso_valido.escaneado_en)} · Duplicado en <strong>{i.puerta}</strong>: {fecha(i.detalle.ingreso_duplicado.escaneado_en)}</>
                ) : i.tipo === 'escaner_desincronizado' ? (
                  <>Entró una entrada {i.detalle.estado_entrada} por {i.puerta}</>
                ) : i.puerta ? <>Puerta {i.puerta}</> : '—'}
                {i.detalle.nota_resolucion ? <div className="suave">Resolución: {i.detalle.nota_resolucion}</div> : null}
              </td>
              <td>{fecha(i.creado_en)}</td>
              <td><span className={`insignia ${i.estado}`}>{i.estado}</span></td>
              <td>{i.estado === 'abierto' ? <button className="btn btn-claro" onClick={() => void resolver(i)}>Resolver</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Estado>
  )
}
