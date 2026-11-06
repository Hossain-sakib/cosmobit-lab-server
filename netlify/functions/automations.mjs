import { serverlessDB } from '../../src/lib/serverlessDb.js';
import { runAutomations } from '../../src/services/automation.js';

export const config = { schedule: '*/15 * * * *' };
export default async () => {
  await serverlessDB();
  await runAutomations();
  return new Response(null, { status: 204 });
};
