import type { Role } from './auth.js';

export function canViewDashboardFees(role: Role): boolean {
  return role === 'admin' || role === 'headteacher' || role === 'registrar';
}