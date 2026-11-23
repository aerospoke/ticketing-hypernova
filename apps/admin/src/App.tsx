import { useEffect, useState, useSyncExternalStore } from 'react'
import { logout, restaurar, suscribirSesion, usuarioActual } from './api'
import { Auditoria } from './paginas/Auditoria'
import { Evento } from './paginas/Evento'
import { Eventos } from './paginas/Eventos'
import { Login } from './paginas/Login'
import { ir, useRuta } from './util'

const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')

export default function App() {
  const usuario = useSyncExternalStore(suscribirSesion, usuarioActual)
  const [listo, setListo] = useState(false)
  const ruta = useRuta()

  useEffect(() => {
    void restaurar().finally(() => setListo(true))
  }, [])

  if (!listo) return <div className="arranque"><span className="acceso-logo" aria-hidden="true">◆</span></div>
  if (!usuario) return <Login />

  let pagina = <Eventos />
  if (ruta[0] === 'eventos' && ruta[1]) pagina = <Evento id={ruta[1]} seccion={ruta[2] ?? 'ventas'} />
  else if (ruta[0] === 'auditoria') pagina = <Auditoria />

  return (
    <div className="marco">
      <header className="cabecera">
        <a className="marca" href="#/eventos">
          <span className="acceso-logo" aria-hidden="true">◆</span> Ticketing
          <small>Portal</small>
        </a>
        <nav aria-label="Secciones">
          <a href="#/eventos" className={ruta[0] !== 'auditoria' ? 'activo' : ''}>Eventos</a>
          <a href="#/auditoria" className={ruta[0] === 'auditoria' ? 'activo' : ''}>Auditoría</a>
        </nav>
        <div className="quien">
          <span className="avatar" aria-hidden="true">{iniciales(usuario.nombre)}</span>
          <span className="quien-texto">
            <strong>{usuario.nombre}</strong>
            <small>{usuario.rol === 'admin' ? 'Administrador' : 'Organizador'}</small>
          </span>
          <button className="btn-salir" onClick={() => void logout().then(() => ir('/eventos'))}>Salir</button>
        </div>
      </header>
      <main className="contenido">{pagina}</main>
    </div>
  )
}
