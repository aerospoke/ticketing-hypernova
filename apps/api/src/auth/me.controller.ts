import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { SesionActual } from './auth.guard';
import type { Sesion } from './tokens';

/** Perfil del usuario autenticado. Ruta protegida: sirve también para validar la sesión. */
@Controller('me')
export class MeController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async perfil(@SesionActual() sesion: Sesion) {
    const { rows } = await this.pool.query(
      'SELECT id, nombre, email, rol, creado_en FROM usuarios WHERE id = $1',
      [sesion.usuarioId],
    );
    if (!rows[0]) throw new ErrorApi(404, 'usuario_no_encontrado', 'El usuario no existe');
    return rows[0];
  }
}
