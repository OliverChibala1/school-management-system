import assert from 'node:assert/strict';
import test from 'node:test';
import { teacherScopeId } from './teacherAccess.js';

test('only teacher requests receive an assigned-class scope', () => {
  assert.equal(teacherScopeId('teacher', 'teacher-id'), 'teacher-id');
  assert.equal(teacherScopeId('admin', 'admin-id'), null);
  assert.equal(teacherScopeId('headteacher', 'headteacher-id'), null);
  assert.equal(teacherScopeId('registrar', 'registrar-id'), null);
  assert.equal(teacherScopeId('parent', 'parent-id'), null);
  assert.equal(teacherScopeId('student', 'student-id'), null);
});