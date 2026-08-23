export type AppShellRoute = 'menu' | 'admin';

export const ADMIN_ROUTE_PATH = '/admin';

export function getAppShellRoute(pathname: string): AppShellRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === ADMIN_ROUTE_PATH ? 'admin' : 'menu';
}

export function getAppShellRoutePath(route: AppShellRoute): string {
  return route === 'admin' ? ADMIN_ROUTE_PATH : '/';
}

export function preservesViewDuringSessionRefresh(view: string): boolean {
  return ['profile', 'admin', 'launching-game', 'game'].includes(view);
}
