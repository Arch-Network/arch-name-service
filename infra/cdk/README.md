# ANS manager AWS hosting

Deploys `id.arch.network` as a private S3 + CloudFront SPA with ACM and Route 53.

## Estimated cost (low traffic test)

| Item | Estimate |
|------|----------|
| S3 storage + requests | < $1 / month |
| CloudFront | $1–3 / month |
| Route 53 queries | < $1 / month |
| ACM certificate | Free |
| **Total** | **~$1–5 / month** |

## Required confirmation before first deploy

Set these for the target AWS account that owns `arch.network`:

```bash
export CDK_DEFAULT_ACCOUNT=...
export CDK_DEFAULT_REGION=us-east-1
export ANS_HOSTED_ZONE_NAME=arch.network
export ANS_HOSTED_ZONE_ID=Z...   # recommended
export ANS_DOMAIN_NAME=id.arch.network
```

Then:

```bash
npm install
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/us-east-1
npx cdk synth
npx cdk deploy
```

Do **not** deploy until the AWS account/hosted zone are explicitly confirmed.
