#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AnsManagerStack } from "../lib/ans-manager-stack";

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";
const hostedZoneId = process.env.ANS_HOSTED_ZONE_ID;
const hostedZoneName = process.env.ANS_HOSTED_ZONE_NAME ?? "arch.network";
const domainName = process.env.ANS_DOMAIN_NAME ?? "id.arch.network";
const githubRepository =
  process.env.ANS_GITHUB_REPOSITORY ?? "Arch-Network/arch-name-service";

new AnsManagerStack(app, "AnsManagerStack", {
  env: account ? { account, region } : undefined,
  domainName,
  hostedZoneName,
  hostedZoneId,
  githubRepository,
  description: "Static hosting for ANS manager at id.arch.network",
});
