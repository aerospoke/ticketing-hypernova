// Entorno de los tests e2e. Se carga ANTES de importar la app, porque varios límites se
// leen al cargar los módulos.
//
// La conexión (PGHOST, PGPORT, PGDATABASE, DB_APP_PASSWORD) la exporta test/correr-e2e.sh,
// que levanta una base aislada. El secreto JWT se genera por corrida: la app vive dentro
// del proceso de test, nadie más necesita conocerlo.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

for (const v of ['PGHOST', 'PGPORT', 'PGDATABASE', 'DB_APP_PASSWORD']) {
  if (!process.env[v]) throw new Error(`Falta ${v}: corre los e2e con apps/api/test/correr-e2e.sh`);
}
process.env.JWT_ACCESS_SECRET ??= randomBytes(64).toString('base64url');
// Par Ed25519 de firma de entradas, propio de esta corrida.
process.env.TICKET_SIGNING_KEY ??= generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
// Todas las peticiones salen de la misma IP: el rate limit se prueba aparte.
process.env.AUTH_RATE_LIMIT = '100000';
process.env.COMPRA_RATE_LIMIT = '100000';
process.env.RATE_LIMIT = '1000000';
// Sin timer de barrido: los tests lo invocan a mano para controlar el momento.
process.env.BARRIDO_INTERVALO_MS = '0';
// Sin logs JSON en la salida de los tests.
process.env.LOG_SILENCIO = '1';
