// si un archivo ya existe no lo toca, así que reiniciar no invalida sesiones ni entradas.
// Nada de esto vive en el repositorio; queda en volúmenes de Docker.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chownSync, existsSync, writeFileSync } from 'node:fs';

const NODE_UID = 1000; // usuario `node` de la imagen node:24-alpine (api y migrate)
const aleatorio = () => randomBytes(32).toString('base64url');

function asegurar(ruta, generar, { uid, mode }) {
  if (existsSync(ruta)) {
    console.log(JSON.stringify({ msg: 'secreto_existente', ruta }));
    return;
  }
  writeFileSync(ruta, generar(), { mode });
  if (uid !== undefined) chownSync(ruta, uid, uid);
  console.log(JSON.stringify({ msg: 'secreto_generado', ruta }));
}

// Contraseña del dueño de la base: la leen postgres y migrate.
asegurar('/out/db/db_owner_password', aleatorio, { mode: 0o444 });

// Secretos de la API: solo el usuario node puede leerlos.
const soloApi = { uid: NODE_UID, mode: 0o400 };
asegurar('/out/api/db_app_password', aleatorio, soloApi);
asegurar('/out/api/jwt_access_secret', () => randomBytes(64).toString('base64url'), soloApi);

// Par Ed25519 para firmar las entradas. Se generan juntos o no se generan.
const privada = '/out/api/ticket_signing_ed25519.pem';
const publica = '/out/api/ticket_signing_ed25519.pub.pem';
if (!existsSync(privada) || !existsSync(publica)) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  writeFileSync(privada, privateKey, { mode: 0o400 });
  writeFileSync(publica, publicKey, { mode: 0o444 });
  chownSync(privada, NODE_UID, NODE_UID);
  chownSync(publica, NODE_UID, NODE_UID);
  console.log(JSON.stringify({ msg: 'par_ed25519_generado' }));
} else {
  console.log(JSON.stringify({ msg: 'par_ed25519_existente' }));
}