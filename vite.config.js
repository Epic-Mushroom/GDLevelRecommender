import {defineConfig} from 'vite';

export default defineConfig({
    base: './',
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'https://gdladder.com',
                changeOrigin: true,
                secure: false,
                headers: {
                    'Origin': 'https://gdladder.com',
                    'Referer': 'https://gdladder.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
                }
            }
        }
    }
});