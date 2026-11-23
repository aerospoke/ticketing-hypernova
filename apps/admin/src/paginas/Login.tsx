import { useEffect, useState, type FormEvent } from 'react'
import { login } from '../api'
import { DIAPOSITIVAS } from '../carrusel'
import { Icono } from '../ui'
import { mensaje } from '../util'

// Rápido a propósito: en ~10 segundos de vista se alcanzan a ver 4 o 5 artistas.
const CADA_MS = 2200

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(mensaje(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="acceso">
      <Carrusel />

      <section className="acceso-lado">
        <div className="acceso-caja">
          <div className="acceso-marca">
            <span className="acceso-logo" aria-hidden="true"><Icono nombre="boleto" tam={22} blanco /></span> Ticketing
          </div>
          <h1 className="acceso-titulo">
            Que empiece<br /><span>el show.</span>
          </h1>
          <p className="acceso-bajada">Gestiona tus eventos, ventas y accesos en tiempo real.</p>

          <form className="acceso-form" onSubmit={entrar}>
            <label className="campo">
              <span>Correo</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="tu@correo.com" required />
            </label>
            <label className="campo">
              <span>Contraseña</span>
              <div className="campo-clave">
                <input type={verClave ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" required />
                <button type="button" className="ver-clave" onClick={() => setVerClave((v) => !v)} aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {verClave ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </label>
            {error ? <div className="aviso error" role="alert">{error}</div> : null}
            <button className="btn-acceso" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar al portal'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="acceso-pie">Acceso para organizadores y administradores.</p>
          <p className="credito">Íconos de <a href="https://icons8.com" target="_blank" rel="noreferrer">Icons8</a></p>
        </div>
      </section>
    </div>
  )
}

function Carrusel() {
  const [actual, setActual] = useState(0)

  // Cada cambio de foto (automático o por clic) reinicia la cuenta: elegir una foto no
  // salta a la siguiente un segundo después.
  useEffect(() => {
    const t = setTimeout(() => setActual((i) => (i + 1) % DIAPOSITIVAS.length), CADA_MS)
    return () => clearTimeout(t)
  }, [actual])

  return (
    <section
      className="carrusel"
      aria-roledescription="carrusel"
      aria-label="Artistas en cartelera"
    >
      {DIAPOSITIVAS.map((d, i) => (
        <figure key={d.imagen} className={`diapositiva ${i === actual ? 'activa' : ''}`} aria-hidden={i !== actual}>
          <img src={d.imagen} alt="" style={{ objectPosition: d.foco ?? 'center' }} loading={i === 0 ? 'eager' : 'lazy'} />
          <figcaption>
            <span className="diapositiva-etiqueta"><Icono nombre="estrella" tam={14} blanco /> En cartelera</span>
            <strong className="diapositiva-artista">{d.artista}</strong>
            <span className="diapositiva-detalle">{d.detalle}</span>
          </figcaption>
        </figure>
      ))}

      <div className="carrusel-puntos" role="tablist" aria-label="Elegir foto">
        {DIAPOSITIVAS.map((d, i) => (
          <button
            key={d.imagen}
            role="tab"
            aria-selected={i === actual}
            aria-label={`Ver ${d.artista}`}
            className={i === actual ? 'activo' : ''}
            onClick={() => setActual(i)}
          />
        ))}
      </div>

      {/* División curva entre el carrusel y el formulario (horizontal en escritorio, abajo en móvil). */}
      <svg className="curva curva-lado" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 0 L60 0 C 15 180, 95 330, 45 520 C 5 690, 70 840, 40 1000 L100 1000 Z" />
      </svg>
      <svg className="curva curva-abajo" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 100 L0 60 C 220 10, 380 95, 560 50 C 740 5, 860 70, 1000 35 L1000 100 Z" />
      </svg>
    </section>
  )
}
