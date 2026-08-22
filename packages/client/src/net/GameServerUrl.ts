/** Resolve the public game socket, preserving explicit non-loopback deployments. */
export function getGameServerUrl(): string {
  const configuredUrl = import.meta.env.VITE_SERVER_URL?.trim();
  const defaultUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  if (!configuredUrl) return defaultUrl;

  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    try {
      const configuredHostname = new URL(configuredUrl).hostname;
      if (['localhost', '127.0.0.1', '[::1]'].includes(configuredHostname)) {
        console.warn(
          `[Main] Ignoring loopback-only VITE_SERVER_URL on LAN; using ${defaultUrl}`,
        );
        return defaultUrl;
      }
    } catch {
      // Let WebSocket report malformed explicit overrides with its normal error.
    }
  }

  return configuredUrl;
}
