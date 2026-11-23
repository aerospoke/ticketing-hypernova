/**
 * Cliente de la API para el portal. Mismo origen (nginx hace de proxy), sin CORS.
 * - Access token en memoria; refresh token en sessionStorage (sobrevive a recargar la
 *   pestaña, se borra al cerrarla). Decisión documentada: con más tiempo iría en una
 *   cookie httpOnly + SameSite emitida por la API.
 * - Renovación automática del access token, una sola a la vez.
 */
export class ErrorApi extends Error {
  status: number
  codigo: string
  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje)
    this.status = status
    this.codigo = codigo
  }
}

export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: 'asistente' | 'staff' | 'organizador' | 'admin'
}

const CLAVE = 'ticketing_portal_refresh'
let access: string | null = null
let usuario: Usuario | null = null
const oyentes = new Set<() => void>()

export const usuarioActual = () => usuario
export function suscribirSesion(fn: () => void) {
  oyentes.add(fn)
  return () => void oyentes.delete(fn)
}
const avisar = () => oyentes.forEach((f) => f())

interface Par {
  access_token: string
  refresh_token: string
  usuario: Usuario
}

function abrir(p: Par) {
  if (p.usuario.rol !== 'organizador' && p.usuario.rol !== 'admin') {
    throw new ErrorApi(403, 'rol_insuficiente', 'El portal es solo para organizadores y administradores')
  }
  access = p.access_token
  usuario = p.usuario
  sessionStorage.setItem(CLAVE, p.refresh_token)
  avisar()
}

export async function login(email: string, password: string) {
  abrir(await pedir<Par>('/v1/auth/login', { metodo: 'POST', cuerpo: { email, password }, sinAuth: true }))
}

export async function logout() {
  const r = sessionStorage.getItem(CLAVE)
  if (r) await pedir('/v1/auth/logout', { metodo: 'POST', cuerpo: { refresh_token: r }, sinAuth: true }).catch(() => undefined)
  sessionStorage.removeItem(CLAVE)
  access = null
  usuario = null
  avisar()
}

/** Al cargar la página: si hay refresh guardado, se recupera la sesión. */
export async function restaurar() {
  if (sessionStorage.getItem(CLAVE)) await refrescar()
  return usuario
}

let refrescando: Promise<boolean> | null = null
function refrescar(): Promise<boolean> {
  refrescando ??= (async () => {
    const r = sessionStorage.getItem(CLAVE)
    if (!r) return false
    try {
      abrir(await pedir<Par>('/v1/auth/refresh', { metodo: 'POST', cuerpo: { refresh_token: r }, sinAuth: true }))
      return true
    } catch {
      sessionStorage.removeItem(CLAVE)
      access = null
      usuario = null
      avisar()
      return false
    } finally {
      refrescando = null
    }
  })()
  return refrescando
}

interface Opciones {
  metodo?: string
  cuerpo?: unknown
  clave?: string
  sinAuth?: boolean
}

async function pedir<T>(ruta: string, o: Opciones = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (o.cuerpo !== undefined) headers['Content-Type'] = 'application/json'
  if (o.clave) headers['Idempotency-Key'] = o.clave
  if (!o.sinAuth && access) headers.Authorization = `Bearer ${access}`
  let r: Response
  try {
    r = await fetch(ruta, { method: o.metodo ?? 'GET', headers, body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo) })
  } catch {
    throw new ErrorApi(0, 'sin_conexion', 'No se pudo contactar al servidor')
  }
  if (r.status === 204) return undefined as T
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) {
    const e = cuerpo?.error
    throw new ErrorApi(r.status, e?.codigo ?? 'error', e?.mensaje ?? `Error ${r.status}`)
  }
  return cuerpo as T
}

export async function api<T>(ruta: string, o: Opciones = {}): Promise<T> {
  try {
    return await pedir<T>(ruta, o)
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 401 && e.codigo === 'token_invalido' && (await refrescar())) {
      return pedir<T>(ruta, o)
    }
    if (e instanceof ErrorApi && e.status === 401) {
      access = null
      usuario = null
      avisar()
    }
    throw e
  }
}

export const nuevaClave = (p: string) => `${p}-${crypto.randomUUID()}`
