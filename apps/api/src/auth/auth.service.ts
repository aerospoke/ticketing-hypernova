import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { LLAVE_ACCESS } from './auth.guard';
import { hashPassword, verificarPassword } from './password';
import { ACCESS_TTL_S, firmarAccess, hashRefresh, nuevoRefresh, REFRESH_TTL_S, type Rol } from './tokens';

export interface UsuarioPublico {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface ParDeTokens {
  access_token: string;
  access_expira_en: string;
  refresh_token: string;
  usuario: UsuarioPublico;
}

interface FilaUsuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  password_hash: string;
  activo: boolean;
}

// Hash de una contraseña que nadie conoce. Si el correo no existe se verifica contra él
// igual: login tarda lo mismo exista o no la cuenta, y no se puede enumerar correos
// midiendo tiempos de respuesta.
let hashSenuelo: Promise<string> | undefined;
const senuelo = () => (hashSenuelo ??= hashPassword(randomUUID()));

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LLAVE_ACCESS) private readonly llave: Uint8Array,
  ) {}

  /** Registro de asistentes. El personal (staff, organizadores, admin) no se auto-registra. */
  async registrar(nombre: string, email: string, password: string): Promise<ParDeTokens> {
    const hash = await hashPassword(password);
    // ON CONFLICT en vez de "SELECT y luego INSERT": dos registros simultáneos con el
    // mismo correo no pueden crear dos cuentas (lo garantiza usuarios_email_uk).
    const { rows } = await this.pool.query<FilaUsuario>(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'asistente')
       ON CONFLICT (email) DO NOTHING
       RETURNING id, nombre, email, rol, password_hash, activo`,
      [nombre.trim(), normalizarEmail(email), hash],
    );
    if (rows.length === 0) throw new ErrorApi(409, 'email_en_uso', 'Ya existe una cuenta con ese correo');
    log('info', 'usuario_registrado', { usuario: rows[0].id });
    return this.abrirSesion(rows[0]);
  }

  async login(email: string, password: string): Promise<ParDeTokens> {
    const { rows } = await this.pool.query<FilaUsuario>(
      'SELECT id, nombre, email, rol, password_hash, activo FROM usuarios WHERE email = $1',
      [normalizarEmail(email)],
    );
    const usuario = rows[0];
    const ok = await verificarPassword(password, usuario?.password_hash ?? (await senuelo()));
    // Mismo error para "no existe", "contraseña mala" y "cuenta inactiva": no se filtra
    // qué correos están registrados.
    if (!usuario || !ok || !usuario.activo) {
      log('warn', 'login_fallido');
      throw new ErrorApi(401, 'credenciales_invalidas', 'Correo o contraseña incorrectos');
    }
    return this.abrirSesion(usuario);
  }

  /**
   * Rotación: el refresh se canjea UNA vez. El UPDATE condicional lo marca usado de
   * forma atómica; si dos peticiones llegan con el mismo token, solo una gana.
   * Si llega un token ya usado, alguien lo copió (o la app lo reusó): se revoca toda la
   * familia y tanto el atacante como el dueño tienen que volver a iniciar sesión.
   */
  async refrescar(refreshToken: string): Promise<ParDeTokens> {
    const hash = hashRefresh(refreshToken);
    // La transacción devuelve el resultado en vez de lanzar: si lanzara, el ROLLBACK
    // desharía justamente la revocación de la familia que queremos dejar grabada.
    const resultado = await this.enTransaccion(async (c): Promise<ParDeTokens | 'rechazado'> => {
      const { rows } = await c.query<{ id: string; familia_id: string; usuario_id: string }>(
        `UPDATE refresh_tokens SET usado_en = now()
          WHERE token_hash = $1 AND usado_en IS NULL AND revocado_en IS NULL AND expira_en > now()
          RETURNING id, familia_id, usuario_id`,
        [hash],
      );
      if (rows.length === 0) {
        const reuso = await c.query<{ familia_id: string }>(
          `UPDATE refresh_tokens SET revocado_en = now()
            WHERE familia_id = (SELECT familia_id FROM refresh_tokens WHERE token_hash = $1 AND usado_en IS NOT NULL)
              AND revocado_en IS NULL
            RETURNING familia_id`,
          [hash],
        );
        if (reuso.rowCount) log('warn', 'refresh_reusado_familia_revocada', { familia: reuso.rows[0].familia_id });
        return 'rechazado';
      }
      const previo = rows[0];
      const usuario = await c.query<FilaUsuario>(
        'SELECT id, nombre, email, rol, password_hash, activo FROM usuarios WHERE id = $1',
        [previo.usuario_id],
      );
      if (!usuario.rows[0]?.activo) {
        await c.query('UPDATE refresh_tokens SET revocado_en = now() WHERE familia_id = $1 AND revocado_en IS NULL', [
          previo.familia_id,
        ]);
        return 'rechazado';
      }
      return this.emitir(c, usuario.rows[0], previo.familia_id, previo.id);
    });
    if (resultado === 'rechazado') {
      throw new ErrorApi(401, 'refresh_invalido', 'La sesión expiró o fue cerrada; inicia sesión de nuevo');
    }
    return resultado;
  }

  /** Logout: revoca la familia completa. El guard rechaza desde ya sus access tokens. */
  async logout(refreshToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revocado_en = now()
        WHERE familia_id = (SELECT familia_id FROM refresh_tokens WHERE token_hash = $1)
          AND revocado_en IS NULL`,
      [hashRefresh(refreshToken)],
    );
    // Siempre 204: no se revela si el token existía.
  }

  private abrirSesion(usuario: FilaUsuario): Promise<ParDeTokens> {
    return this.enTransaccion((c) => this.emitir(c, usuario, randomUUID(), null));
  }

  private async emitir(c: PoolClient, u: FilaUsuario, familiaId: string, reemplaza: string | null): Promise<ParDeTokens> {
    const refresh = nuevoRefresh();
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO refresh_tokens (usuario_id, familia_id, token_hash, expira_en)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
      [u.id, familiaId, hashRefresh(refresh), REFRESH_TTL_S],
    );
    if (reemplaza) {
      await c.query('UPDATE refresh_tokens SET reemplazado_por = $1 WHERE id = $2', [rows[0].id, reemplaza]);
    }
    const access = await firmarAccess({ usuarioId: u.id, rol: u.rol, familiaId }, this.llave);
    return {
      access_token: access,
      access_expira_en: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
      refresh_token: refresh,
      usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol },
    };
  }

  private async enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}
