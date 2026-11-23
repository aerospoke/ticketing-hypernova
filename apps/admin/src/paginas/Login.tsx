import { useState, type FormEvent } from 'react'
import { login } from '../api'
import { mensaje } from '../util'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="login">
      <form className="tarjeta" onSubmit={entrar}>
        <h1>Portal de administración</h1>
        <p className="suave">Organizadores y administradores.</p>
        <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error ? <div className="aviso error">{error}</div> : null}
        <button className="btn" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
