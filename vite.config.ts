import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const external = [
  "electron",
  "ffmpeg-static",
  "@remotion/bundler",
  "@remotion/renderer",
  "remotion",
];

export default defineConfig(({ mode }) => {
  if (mode === "mobile") {
    return {
      base: "./",
      plugins: [react()],
    };
  }

  return {
    plugins: [
      react(),
      electron({
        main: {
          entry: "electron/main.ts",
          onstart({ startup }) {
            const argv = [".", "--no-sandbox"];
            if (process.env.GO7FLICKS_DEBUG) {
              argv.push("--remote-debugging-port=9223");
              argv.push("--disable-features=CalculateNativeWinOcclusion");
            }
            void startup(argv);
          },
          vite: {
            build: {
              rollupOptions: {
                external,
              },
            },
          },
        },
        preload: {
          input: "electron/preload.ts",
          vite: {
            build: {
              rollupOptions: {
                external: ["electron"],
                output: {
                  format: "cjs",
                  entryFileNames: "preload.cjs",
                },
              },
            },
          },
        },
      }),
    ],
  };
});
