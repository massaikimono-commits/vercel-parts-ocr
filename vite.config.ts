import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";

const vinextShimsSingleChunk = {
  name: "vinext-shims-single-chunk",
  configEnvironment(name: string) {
    if (name !== "client") return;
    return {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: "vinext-shims",
                  test: /[\\\\/]node_modules[\\\\/]vinext[\\\\/]dist[\\\\/]shims[\\\\/]/,
                },
              ],
            },
          },
        },
      },
    };
  },
};

export default defineConfig({
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    vinextShimsSingleChunk,
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
