# AWS Miner CDK Stack

This CDK project replicates the CloudFormation template `template-default-vpc.template.yml` using AWS CDK.

## Prerequisites

- Node.js (v18 or later)
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS CLI configured with appropriate credentials

## Setup

1. Install dependencies:
```bash
cd cdk
npm install
```

2. Bootstrap CDK (if not already done):
```bash
cdk bootstrap
```

## Building

```bash
npm run build
```

## Deploying

Deploy the stack:

```bash
cdk deploy
```

You can also deploy with specific parameter values:

```bash
cdk deploy --parameters InstanceTypes="g4dn.*" --parameters Hashrate=500 --parameters CoinName=RVN --parameters WalletAddress=bc1qjlm3kjy87zs6qywmwz2u0ytlde9z4whyzflg38 --parameters PricingPlan=both
```

## Parameters

- `InstanceTypes`: Instance types to choose from (default: "*")
- `Hashrate`: Required Ethash hashrate in MH/s (default: 1000)
- `CoinName`: Coin type - RVN, ERG, KAS, or ETC (default: RVN)
- `WalletAddress`: Wallet Address for payouts (default: "bc1qjlm3kjy87zs6qywmwz2u0ytlde9z4whyzflg38")
- `PricingPlan`: Spot or On-Demand or Both - spot, ondemand, or both (default: both)

## Structure

- `src/index.ts`: CDK app entry point
- `src/miner-stack.ts`: Main stack implementation
- `src/lambdas/instance-filter/`: Lambda function for filtering instance types
- `src/lambdas/asg-updater/`: Lambda function for updating ASG desired capacity

## Differences from CloudFormation Template

The CDK implementation maintains the same functionality as the original CloudFormation template but uses CDK constructs and TypeScript instead of YAML. The main components are:

1. **Parameters**: All CloudFormation parameters are replicated as CDK CfnParameters
2. **Mappings**: AMI IDs and capacity allocation mappings are created using CfnMapping
3. **Lambda Functions**: Custom resources for instance filtering and ASG updating
4. **IAM Roles**: Roles for Lambda execution and EC2 instances
5. **Launch Templates**: Launch templates for different GPU types (CudaX8664, RadeonX8664, DeepLearning)
6. **Auto Scaling Group**: ASG with mixed instances policy using spot and on-demand instances
7. **SNS Topic**: Notification topic for ASG events

## Outputs

- `InstanceTypesRequested`: List of instance types requested in the ASG
- `NotificationTopicOutput`: Monitoring notification topic ARN
- `DashboardUrl`: Mining dashboard URL

## Cleanup

To destroy the stack:

```bash
cdk destroy
```
