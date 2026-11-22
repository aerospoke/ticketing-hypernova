import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { contexto } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { leerSecreto } from '../db/config';
import { PG_POOL } from '../db/db.module';
import { type Rol, type Sesion, verificarAccess } from './tokens';

const PUBLICO = 'ruta_publica';
const ROLES = 'roles_permitidos';

/** La ruta no exige sesión. Todo lo demás sí: la API es "cerrada por defecto". */
export const Publico = () => SetMetadata(PUBLICO, true);
/** Restringe la ruta a ciertos roles (se verifica en el servidor, nunca en el cliente). */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);
/** Inyecta la sesión verificada en el handler. */
export const SesionActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Sesion => ctx.switchToHttp().getRequest<Request & { sesion: Sesion }>().sesion,
);

export const LLAVE_ACCESS = Symbol('LLAVE_ACCESS');
export const llaveAccessProvider = {
  provide: LLAVE_ACCESS,
  useFactory: () => Buffer.from(leerSecreto('JWT_ACCESS_SECRET'), 'base64url'),
};

/**
 * Guard global:
 *  1. Verifica el access token (firma, expiración, emisor, audiencia).
 *  2. Verifica que la sesión (familia) siga activa: así el logout invalida de verdad,
 *     incluso un access token que todavía no expiró. Es una consulta por índice.
 *  3. Si la ruta declara @Roles, el rol del token tiene que estar en la lista.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LLAVE_ACCESS) private readonly llave: Uint8Array,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const objetivos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, objetivos)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { sesion?: Sesion }>();
    const [tipo, token] = (req.header('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new ErrorApi(401, 'no_autenticado', 'Falta el token de acceso');

    let sesion: Sesion;
    try {
      sesion = await verificarAccess(token, this.llave);
    } catch {
      throw new ErrorApi(401, 'token_invalido', 'El token de acceso no es válido o expiró');
    }

    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM refresh_tokens
        WHERE familia_id = $1 AND usado_en IS NULL AND revocado_en IS NULL AND expira_en > now()
        LIMIT 1`,
      [sesion.familiaId],
    );
    if (!rowCount) throw new ErrorApi(401, 'sesion_cerrada', 'La sesión fue cerrada');

    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, objetivos);
    if (roles && !roles.includes(sesion.rol)) {
      throw new ErrorApi(403, 'rol_insuficiente', 'No tienes permiso para esta acción');
    }

    req.sesion = sesion;
    const ctxPeticion = contexto.getStore();
    if (ctxPeticion) ctxPeticion.usuarioId = sesion.usuarioId;
    return true;
  }
}
