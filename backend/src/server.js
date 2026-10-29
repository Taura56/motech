import mongoose from 'mongoose';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';
import { runReconciliation } from './services/paymentService.js';

await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
const app = createApp();
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'MOTECH ZONE backend listening'));

let reconciliationRunning = false;
const reconcile = async () => {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try { await runReconciliation(); }
  catch (error) { logger.error({ err: error }, 'Reconciliation cycle failed'); }
  finally { reconciliationRunning = false; }
};
const reconciliationTimer = setInterval(reconcile, config.RECONCILIATION_INTERVAL_MS);
reconciliationTimer.unref();
await reconcile();

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  clearInterval(reconciliationTimer);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
