import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isDashboardApiRoutePath,
    isDashboardRoutePath,
    shouldHandleAsDashboardRoute,
} from './dashboard-routing.js';

test('dashboard routes are ignored when the dashboard is disabled', () => {
    const dashboard = {
        enabled: false,
        routePrefix: '/dashboard',
        apiPrefix: '/dashboard/api',
    };

    assert.equal(shouldHandleAsDashboardRoute('/dashboard', dashboard), false);
    assert.equal(shouldHandleAsDashboardRoute('/dashboard/', dashboard), false);
    assert.equal(shouldHandleAsDashboardRoute('/dashboard/api/daemon/status', dashboard), false);
});

test('dashboard route matching stays scoped to the configured route prefix', () => {
    assert.equal(isDashboardRoutePath('/dashboard', '/dashboard'), true);
    assert.equal(isDashboardRoutePath('/dashboard/api/daemon/status', '/dashboard'), true);
    assert.equal(isDashboardRoutePath('/dashboard-extra', '/dashboard'), false);
    assert.equal(isDashboardRoutePath('/mcp', '/dashboard'), false);
});

test('dashboard API route matching does not collide with MCP endpoint paths', () => {
    const dashboard = {
        enabled: true,
        routePrefix: '/dashboard',
        apiPrefix: '/dashboard/api',
    };

    assert.equal(shouldHandleAsDashboardRoute('/dashboard/api/codebases', dashboard), true);
    assert.equal(isDashboardApiRoutePath('/dashboard/api/codebases', dashboard.apiPrefix), true);
    assert.equal(shouldHandleAsDashboardRoute('/mcp', dashboard), false);
    assert.equal(isDashboardApiRoutePath('/mcp', dashboard.apiPrefix), false);
});
