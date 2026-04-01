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
    const stage = $app.stage;
    const isProd = stage === "production";

    new sst.aws.Astro("SanghaPunk", {
      domain: isProd
        ? {
            name: "sanghapunk.com",
            aliases: ["www.sanghapunk.com"],
            dns: false,
            cert: process.env.SST_CERT_ARN,
          }
        : undefined,
    });
  },
});
