/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "sangha-punk",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    new sst.aws.Astro("SanghaPunk", {
      domain: {
        name: "sanghapunk.com",
        aliases: ["www.sanghapunk.com"],
      },
    });
  },
});
