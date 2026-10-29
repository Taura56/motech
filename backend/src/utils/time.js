export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

export function routerUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return `${days ? `${days}d` : ''}${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${remaining}s`;
}
