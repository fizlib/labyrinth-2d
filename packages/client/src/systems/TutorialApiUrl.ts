export function buildTutorialApiUrl(
  path: string,
  gameServerUrl: string,
  browserOrigin: string,
  useDevelopmentProxy: boolean,
): string {
  const url = useDevelopmentProxy ? new URL(browserOrigin) : new URL(gameServerUrl);
  if (!useDevelopmentProxy) {
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  }
  url.pathname = `/tutorial-api/${path.replace(/^\//, '')}`;
  url.search = '';
  url.hash = '';
  return url.href;
}
