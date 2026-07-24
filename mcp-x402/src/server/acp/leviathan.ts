/**
 * @deprecated Old agent brand. Use ./seller.js — startAcpSeller().
 * Kept so stale imports of leviathan.js do not crash mid-deploy.
 */
export { startAcpSeller as startLeviathan, startAcpSeller } from './seller.js';
export { resolveOffering } from './seller.js';
