import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/, /^\/auth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        importScripts: ["/sw-custom.js"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*supabase.*\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\/auth\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\/rest\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\/realtime\//,
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "CRM Óticas Joonker",
        short_name: "CRM Óticas Joonker",
        description: "CRM Óticas Joonker - Gestão de Leads",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "@radix-ui/react-tooltip"],
  },
}));
