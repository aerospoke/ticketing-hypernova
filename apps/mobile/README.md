# App móvil: billetera del asistente y escáner del staff

Expo SDK 58 (React Native 0.88, Expo Router), en TypeScript. **Una sola app**: según el rol
con el que inicies sesión, muestra la billetera (asistente) o el escáner (staff).

## Cómo ejecutarla

Solo hace falta **Expo Go** en el teléfono o el emulador. Todos los módulos nativos que usa
(cámara, SQLite, SecureStore, crypto, SVG) vienen incluidos en Expo Go, así que no hace falta
compilar nada nativo.

1. Levanta el backend. Si vas a usar un teléfono físico, publica la API en la red local:

   ```bash
   API_BIND=0.0.0.0 docker compose up
   ```

2. Arranca la app apuntando a la API (Node 24, desde la raíz del repo):

   ```bash
   npm ci
   cd apps/mobile
   EXPO_PUBLIC_API_URL=http://<IP-de-tu-PC>:3000 npx expo start
   ```

   | Dónde corre la app | `EXPO_PUBLIC_API_URL` |
   |---|---|
   | Teléfono físico (misma Wi-Fi) | `http://<IP de tu Mac en la LAN>:3000` (con `API_BIND=0.0.0.0`) |
   | Emulador Android | **También la IP de la LAN** (con `API_BIND=0.0.0.0`). Con Docker Desktop, `10.0.2.2` no llega al API publicado por Docker: la petición queda colgada. |
   | Simulador iOS | `http://localhost:3000` |

   La IP de tu Mac se obtiene con `ipconfig getifaddr en0`.

3. Escanea el QR de la terminal con Expo Go (Android) o con la cámara (iOS).

Credenciales de prueba: ver el [README principal](../../README.md#acceso-de-prueba). Por
ejemplo, `asistente1@correo.test` / `Asistente2026!` o `staff1@ticketing.test` / `Staff2026!`.

## Asistente

| Pantalla | Qué hace |
|---|---|
| Cartelera | Eventos con estado, precio desde y disponibles. Lista virtualizada con paginación por cursor y *pull to refresh*. |
| Evento | Zonas con precio vigente y cuántas quedan. Se elige zona y cantidad, y se reserva. |
| Reserva | **Contador** del tiempo restante, pagar o cancelar. Un pago tardío se resuelve según la política del servidor. |
| Mis entradas | Billetera. **Sin red** muestra la última copia guardada. |
| Entrada | **QR rotativo cada 15 s**, generado en el teléfono. Permite transferir por correo y pedir reembolso. |
| Cuenta | Transferencias (aceptar, rechazar o cancelar), historial de compras y reembolsos, cerrar sesión. |

**Cómo funciona el QR sin red:**
- La primera vez, el teléfono genera un par Ed25519. La llave privada queda en **SecureStore**
  (Keychain o Keystore, solo en este dispositivo) y nunca se envía.
- Con red, la app pide para cada entrada la **credencial firmada por el servidor** para la
  llave pública de este teléfono, y la guarda en SQLite.
- Cada 15 s, el teléfono firma `credencial + hora` y lo muestra como QR. No necesita red.
- El token se recalcula solo cuando cambia la ventana de 15 s, no en cada render
  (`useCodigoRotativo`).

**Idempotencia desde el cliente:** la `Idempotency-Key` se genera **una vez por intención**
(reservar, pagar, reembolsar). Un doble toque o un reintento por timeout reusan la misma clave,
y el servidor devuelve el mismo resultado.

## Staff (modo escáner)

1. **Iniciar turno.** Con red: elegir evento y puerta. Se registran el dispositivo y el turno,
   se baja la llave pública del servidor y se baja la lista de revocaciones.
2. **Escanear.** Puede ser **en modo avión**. Cada lectura se verifica localmente con
   `verificarToken` de `@ticketing/shared`, la misma función que prueba el backend.
3. **Respuesta inmediata a pantalla completa:**

   | Resultado | Color |
   |---|---|
   | **VÁLIDA** | verde |
   | **YA USADA** (este escáner ya la dejó pasar) | rojo |
   | **REVOCADA** (transferida, reembolsada o anulada) | rojo |
   | **CÓDIGO EXPIRADO** (captura vieja) | ámbar |
   | **OTRO EVENTO** o **ZONA EQUIVOCADA** | ámbar |
   | **CÓDIGO INVÁLIDO** (firma falsa) | rojo |

4. **Almacenamiento local.** Cada escaneo se guarda en SQLite con su `client_scan_id`. Hay un
   índice parcial para "¿ya entró?", así la respuesta sigue siendo instantánea con miles de
   escaneos.
5. **Sincronización.** Arriba se ve el **contador de pendientes**. La app sincroniza sola cada
   15 s si hay pendientes, y también con el botón **Sincronizar**: sube los escaneos en lotes
   de 500 y baja las revocaciones nuevas desde el cursor. Si la app se cierra a mitad, reenviar
   es seguro.

## Demo: dos puertas offline (caso 6 del enunciado)

1. Dos teléfonos con la app: uno con `staff1@ticketing.test` y otro con `staff4@ticketing.test`.
   Los dos son staff de `org.istmo`.
2. Con red, en el portal o la API, asignar a ambos al mismo evento con dos puertas. Cada uno
   inicia turno en una puerta distinta.
3. Activar el **modo avión** en los dos escáneres.
4. Un tercer teléfono, el del asistente, muestra su entrada. Los dos escáneres la leen: los
   dos dicen **VÁLIDA**, porque ninguno sabe del otro.
5. Desactivar el modo avión y pulsar **Sincronizar** en los dos. El segundo en sincronizar
   marca ese escaneo como **DOBLE INGRESO**, y el incidente aparece en el portal
   (`GET /v1/admin/eventos/:id/incidentes`).

## Verificación

```bash
cd apps/mobile
npx tsc --noEmit                                                  # tipos
npx expo export --platform android --platform ios --output-dir /tmp/expo-export   # empaqueta con Metro
```

La lógica criptográfica (generar y verificar el QR) está cubierta por los e2e del backend,
que usan las mismas funciones de `@ticketing/shared`. La app en sí todavía no tiene tests
automatizados; Detox o Maestro quedan como bonus.

## Limitaciones conocidas

- Hecha y probada para Expo Go y builds de desarrollo. Un build de release para Android
  contra una API `http://` necesita habilitar el tráfico sin TLS
  (`expo-build-properties` → `usesCleartextTraffic`), o servir la API por HTTPS.
- Si el reloj del teléfono del asistente y el del escáner difieren en más de 30 s, el código
  se rechaza como expirado. Es el costo de la ventana corta contra capturas de pantalla.
