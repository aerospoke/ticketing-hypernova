import { useEffect, useState } from 'react'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; esquema: string }
  | { tipo: 'error'; detalle: string }

// Placeholder del portal: solo confirma que nginx sirve la build y que el proxy
// /ready -> api funciona. Las pantallas de administración llegan en otro paso.
function App() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })

  useEffect(() => {
    fetch('/ready')
      .then(async (r) => {
        const cuerpo = await r.json()
        if (r.ok) setEstado({ tipo: 'listo', esquema: cuerpo.esquema })
        else setEstado({ tipo: 'error', detalle: cuerpo.error?.codigo ?? `HTTP ${r.status}` })
      })
      .catch((e: Error) => setEstado({ tipo: 'error', detalle: e.message }))
  }, [])

  return (
    <main style={{ maxWidth: 640, margin: '64px auto', padding: '0 16px' }}>
      <h1>Ticketing · Portal de administración</h1>
      <p>
        API:{' '}
        {estado.tipo === 'cargando' && 'consultando…'}
        {estado.tipo === 'listo' && <strong>lista (esquema {estado.esquema})</strong>}
        {estado.tipo === 'error' && <strong>no disponible: {estado.detalle}</strong>}
      </p>
    </main>
  )
}

export default App
