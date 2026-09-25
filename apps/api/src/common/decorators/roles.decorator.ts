import { SetMetadata } from '@nestjs/common';
import { Role } from '../constants/roles.enum';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or an entire controller) to the listed roles.
 * Enforced globally by `RolesGuard`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
