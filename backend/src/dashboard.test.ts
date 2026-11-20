import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewDashboardFees } from './dashboard.js';

test('dashboard fee totals are limited to authorized finance roles', () => {
  assert.equal(canViewDashboardFees('admin'), true);
  assert.equal(canViewDashboardFees('headteacher'), true);
  assert.equal(canViewDashboardFees('registrar'), true);
  assert.equal(canViewDashboardFees('teacher'), false);
  assert.equal(canViewDashboardFees('parent'), false);
  assert.equal(canViewDashboardFees('student'), false);
});