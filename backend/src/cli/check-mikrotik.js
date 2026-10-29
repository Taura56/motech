import { checkMikrotikApi } from '../services/mikrotikApiService.js';

const result = await checkMikrotikApi();
console.log(JSON.stringify(result, null, 2));
if (!(result.enabled && result.tcpConnected && result.authenticated && result.connected)) {
  process.exitCode = 1;
}
