import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_LABELS, ROLE_PERMISSIONS, ALL_PERMISSIONS, can, hasAllScope } from '../src/lib/permissions.js';
import { visibleRecord } from '../src/lib/managementScope.js';

test('every company role has valid capabilities and a label', () => {
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    assert.ok(ROLE_LABELS[role], role);
    assert.ok(permissions.every(p => ALL_PERMISSIONS.includes(p)), role);
  }
});
test('operations roles are assigned-only and cannot access finances or administration', () => {
  for (const role of ['web_developer','software_developer','graphics_designer','ui_ux_designer','qa_engineer','devops_engineer','intern']) {
    const user = { role };
    assert.equal(can(user, 'projects:view'), true);
    assert.equal(hasAllScope(user, 'projects'), false);
    for (const p of ['finance:view','payroll:view','users:edit','projects:edit','special-orders:view']) assert.equal(can(user, p), false, `${role}: ${p}`);
    const data = visibleRecord({ projectName:'Website_$400', orderAmount:400, totalAfterFiverr:320 }, user, 'projects');
    assert.equal(data.orderAmount, undefined);
    assert.equal(data.totalAfterFiverr, undefined);
    assert.equal(data.projectName, 'Website');
  }
});
test('management scopes do not give executives or HR administrative access', () => {
  assert.equal(hasAllScope({role:'business_development_manager'}, 'leads'), true);
  assert.equal(hasAllScope({role:'business_development_executive'}, 'leads'), false);
  assert.equal(can({role:'business_development_executive'}, 'proposals:approve'), false);
  assert.equal(can({role:'business_development_manager'}, 'proposals:approve'), true);
  assert.equal(hasAllScope({role:'general_manager'}, 'projects'), true);
  for (const p of ['users:edit','payroll:view','finance:edit']) assert.equal(can({role:'general_manager'}, p), false);
  assert.equal(can({role:'hr'}, 'applications:edit'), true);
  assert.equal(can({role:'hr'}, 'payroll:view'), false);
});
test('founder access, suspension and explicit denial are enforced', () => {
  for (const p of ALL_PERMISSIONS) assert.equal(can({role:'super_admin'}, p), true);
  assert.equal(can({role:'general_manager',deniedPermissions:['projects:view']}, 'projects:view'), false);
  assert.equal(can({role:'web_developer',studioSuspended:true}, 'projects:view'), false);
  assert.equal(hasAllScope({role:'general_manager',studioSuspended:true}, 'projects'), false);
  assert.equal(can({role:'user'}, 'dashboard:view'), false);
});
