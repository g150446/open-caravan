import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist',sourcemap:false},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1'}});
