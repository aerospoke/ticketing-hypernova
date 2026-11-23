import { useEffect, useState, useSyncExternalStore } from 'react'
import { logout, restaurar, suscribirSesion, usuarioActual } from './api'
import { Auditoria } from './paginas/Auditoria'
import { Evento } from './paginas/Evento'
import { Eventos } from './paginas/Eventos'
import { Login } from './paginas/Login'
import { ir, useRuta } from './util'

export default function App() {
  const usuario = useSyncExternalStore(suscribirSesion, usuarioActual)
  const [listo, setListo] = useState(false)
  const ruta = useRuta()

  useEffect(() => {
    void restaurar().finally(() => setListo(true))
  }, [])

  if (!listo) return <p className="estado">Cargando…</p>
  if (!usuario) return <Login />

  let pagina = <Eventos />
  if (ruta[0] === 'eventos' && ruta[1]) pagina = <Evento id={ruta[1]} seccion={ruta[2] ?? 'ventas'} />
  else if (ruta[0] === 'auditoria') pagina = <Auditoria />

  return (
    <div className="marco">
      <header className="cabecera">
        <a className="marca" href="#/eventos">Ticketing · Portal</a>
        <nav>
          <a href="#/eventos" className={ruta[0] !== 'auditoria' ? 'activo' : ''}>Eventos</a>
          <a href="#/auditoria" className={ruta[0] === 'auditoria' ? 'activo' : ''}>Auditoría</a>
        </nav>
        <div className="quien">
          <span>{usuario.nombre} <small>({usuario.rol})</small></span>
          <button className="btn btn-claro" onClick={() => void logout().then(() => ir('/eventos'))}>Salir</button>
        </div>
      </header>
      <main className="contenido">{pagina}</main>
    </div>
  )
}
