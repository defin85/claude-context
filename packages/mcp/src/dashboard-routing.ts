export interface DashboardRouteConfig {
    enabled: boolean;
    routePrefix: string;
    apiPrefix: string;
}

export function isDashboardRoutePath(pathname: string, routePrefix: string): boolean {
    return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

export function isDashboardApiRoutePath(pathname: string, apiPrefix: string): boolean {
    return pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`);
}

export function shouldHandleAsDashboardRoute(pathname: string, dashboard: DashboardRouteConfig): boolean {
    return dashboard.enabled && isDashboardRoutePath(pathname, dashboard.routePrefix);
}
