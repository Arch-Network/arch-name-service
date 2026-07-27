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

## Deployed environment

| Item | Value |
|------|-------|
| AWS account | `920373001452` |
| Region | `us-east-1` |
| Domain | `id.arch.network` |
| Hosted zone | `Z1010690127K5I1CNQ3QF` |
| Profile | `internal-dns` |

```bash
export AWS_PROFILE=internal-dns
export CDK_DEFAULT_ACCOUNT=920373001452
export CDK_DEFAULT_REGION=us-east-1
export ANS_HOSTED_ZONE_NAME=arch.network
export ANS_HOSTED_ZONE_ID=Z1010690127K5I1CNQ3QF
export ANS_DOMAIN_NAME=id.arch.network
```

Then:

```bash
npm install
npx cdk synth
npx cdk deploy
```

First deploy already completed; subsequent deploys update the stack. Static assets are uploaded by `.github/workflows/deploy-ans-manager.yml` (or manually via `aws s3 sync`).

