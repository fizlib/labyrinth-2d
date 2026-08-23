export function buildAdminApiUrl(
  path: string,
  gameServerUrl: string,
  browserOrigin: string,
  useDevelopmentProxy: boolean,
): string {
  const queryStart = path.indexOf('?');
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const search = queryStart === -1 ? '' : path.slice(queryStart + 1);
  const url = useDevelopmentProxy ? new URL(browserOrigin) : new URL(gameServerUrl);
  if (!useDevelopmentProxy) {
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  }
  url.pathname = `/admin-api/${pathname.replace(/^\//, '')}`;
  url.search = search;
  url.hash = '';
  return url.href;
}
