import type { Role } from './auth.js';

export function teacherScopeId(role: Role, userId: string): string | null {
  return role === 'teacher' ? userId : null;
}