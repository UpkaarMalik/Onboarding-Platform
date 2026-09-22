import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    resolve: {
        // The shadcn registry files under src/charts import from "@/..." — this
        // is what the registry's own components.json would have set up.
        // '/src' is resolved against the Vite project root, which avoids
        // pulling in @types/node just to build a path here.
        alias: {
            '@': '/src',
        },
    },
    server: {
        port: 5173,
    },
});
