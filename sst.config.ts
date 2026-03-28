/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "sangha-punk",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          profile: input?.stage === "staging" ? "staging" : "default",
        }
      }
    };
  },
  async run() {
    new sst.aws.Astro("SanghaPunk");
  },
});
