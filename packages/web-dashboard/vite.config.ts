import { defineConfig } from 'vite';

const daemonTarget = process.env.DASHBOARD_API_TARGET || 'http://127.0.0.1:39393/dashboard';

export default defineConfig({
    base: './',
    server: {
        host: '127.0.0.1',
        proxy: {
            '/api': {
                target: daemonTarget,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '/api'),
            },
        },
    },
});
