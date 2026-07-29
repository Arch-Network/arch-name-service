import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "node:path";
import { Construct } from "constructs";

export interface AnsManagerStackProps extends cdk.StackProps {
  domainName: string;
  hostedZoneName: string;
  hostedZoneId?: string;
  /** GitHub org/repo for OIDC deploy role, e.g. Arch-Network/arch-name-service */
  githubRepository: string;
}

export class AnsManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AnsManagerStackProps) {
    super(scope, id, props);

    const zone = props.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName,
        })
      : route53.HostedZone.fromLookup(this, "Zone", {
          domainName: props.hostedZoneName,
        });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
      domainName: props.domainName,
      hostedZone: zone,
      region: "us-east-1",
    });

    const indexerApiKey = new secretsmanager.Secret(this, "IndexerApiKey", {
      secretName: "ans-manager/indexer-api-key",
      description:
        "Arch Explorer API key used by the id.arch.network RPC proxy",
    });
    const indexerProxy = new lambda.Function(this, "IndexerProxy", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambda/indexer-proxy"),
      ),
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        INDEXER_API_KEY_SECRET_ARN: indexerApiKey.secretArn,
      },
    });
    indexerApiKey.grantRead(indexerProxy);
    const indexerProxyApi = new apigateway.RestApi(this, "IndexerProxyApi", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
    });
    const indexerIntegration = new apigateway.LambdaIntegration(indexerProxy);
    indexerProxyApi.root
      .addResource("rpc")
      .addMethod("POST", indexerIntegration);
    const explorerResource = indexerProxyApi.root.addResource("explorer");
    explorerResource.addMethod("GET", indexerIntegration);
    explorerResource.addMethod("HEAD", indexerIntegration);
    const explorerProxy = explorerResource.addResource("{proxy+}");
    explorerProxy.addMethod("GET", indexerIntegration);
    explorerProxy.addMethod("HEAD", indexerIntegration);

    const proxyOrigin = new origins.HttpOrigin(
      `${indexerProxyApi.restApiId}.execute-api.${this.region}.${cdk.Aws.URL_SUFFIX}`,
      { originPath: `/${indexerProxyApi.deploymentStage.stageName}` },
    );
    const proxyBehavior: cloudfront.BehaviorOptions = {
      origin: proxyOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      compress: true,
    };
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var leaf = request.uri.substring(request.uri.lastIndexOf("/") + 1);
  if (!leaf.includes(".")) request.uri = "/index.html";
  return request;
}
`),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        functionAssociations: [
          {
            function: spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/rpc": proxyBehavior,
        "/explorer": proxyBehavior,
        "/explorer/*": proxyBehavior,
      },
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: "index.html",
    });

    new route53.ARecord(this, "AliasRecord", {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, "AliasRecordIpv6", {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    const githubProvider = new iam.OpenIdConnectProvider(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const deployRole = new iam.Role(this, "GitHubDeployRole", {
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepository}:*`,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: "Least-privilege role for ANS manager static deploys",
    });

    siteBucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations",
        ],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    new cdk.CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${props.domainName}` });
    new cdk.CfnOutput(this, "IndexerApiKeySecretName", {
      value: indexerApiKey.secretName,
    });
    new cdk.CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn });
  }
}
