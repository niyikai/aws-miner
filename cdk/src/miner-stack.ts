import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Fix for js-yaml types
const yamlLoad = yaml.load as (doc: string) => Record<string, Record<string, string>>;

export interface MinerStackProps extends cdk.StackProps {
  instanceTypes?: string;
  hashrate?: number;
  coinName?: string;
  walletAddress?: string;
  pricingPlan?: string;
}

export class MinerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: MinerStackProps) {
    super(scope, id, props);

    // Parameters
    const instanceTypes = new cdk.CfnParameter(this, 'InstanceTypes', {
      type: 'String',
      description: 'Instance types to choose from. Can be "*" to use all available, or wildcards e.g. "g4dn.*,g5.*", or a list of specific instances e.g. "p3.2xlarge,p3.8xlarge", or an exclusion e.g. "-p4d.*". The most cost effective combination of available instances will be used first.',
      default: props?.instanceTypes || '*',
    });

    const hashrate = new cdk.CfnParameter(this, 'Hashrate', {
      type: 'Number',
      description: 'Required Ethash hashrate in MH/s. AWS will start the most cost effective available instances to achieve this Hashrate.',
      default: props?.hashrate || 1000,
      minValue: 0,
    });

    const coinName = new cdk.CfnParameter(this, 'CoinName', {
      type: 'String',
      description: 'Coin type',
      allowedValues: ['RVN', 'ERG', 'KAS', 'ETC'],
      default: props?.coinName || 'RVN',
    });

    const walletAddress = new cdk.CfnParameter(this, 'WalletAddress', {
      type: 'String',
      description: 'Wallet Address (use BTC address regardless of the Coin type)',
      default: props?.walletAddress || 'bc1qjlm3kjy87zs6qywmwz2u0ytlde9z4whyzflg38',
    });

    const pricingPlan = new cdk.CfnParameter(this, 'PricingPlan', {
      type: 'String',
      description: 'Spot or On-Demand or Both',
      allowedValues: ['spot', 'ondemand', 'both'],
      default: props?.pricingPlan || 'both',
    });

    // Load AMI mappings
    const amiIdsPath = path.join(__dirname, '../../src/ami-ids.yml');
    const amiIdsContent = fs.readFileSync(amiIdsPath, 'utf8');
    const amiIds = yamlLoad(amiIdsContent);

    // Create AMI mapping in CDK
    const imageMap = new cdk.CfnMapping(this, 'ImageMap');
    for (const [region, amis] of Object.entries(amiIds)) {
      for (const [imageType, amiId] of Object.entries(amis)) {
        imageMap.setValue(region, imageType, amiId);
      }
    }

    // Capacity allocation mapping
    const capacityAllocation = new cdk.CfnMapping(this, 'CapacityAllocation');
    capacityAllocation.setValue('spot', 'OnDemandPct', '0');
    capacityAllocation.setValue('both', 'OnDemandPct', '50');
    capacityAllocation.setValue('ondemand', 'OnDemandPct', '100');

    // Load user data script
    const userDataPath = path.join(__dirname, '../../src/user-data-runner.txt');
    const userDataTemplate = fs.readFileSync(userDataPath, 'utf8');

    // IAM Role for Lambda
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        InstanceFilter: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeInstanceTypeOfferings',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeSpotPriceHistory',
                'autoscaling:SetDesiredCapacity',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // IAM Role for EC2 instances
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const instanceProfile = new iam.CfnInstanceProfile(this, 'InstanceProfile', {
      roles: [instanceRole.roleName],
    });

    // Lambda function for instance filter
    const instanceFilterLambda = new lambda.Function(this, 'InstanceFilterLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/instance-filter')),
      timeout: cdk.Duration.seconds(10),
      role: lambdaExecutionRole,
    });

    // Lambda function for ASG updater
    const asgUpdaterLambda = new lambda.Function(this, 'AsgUpdaterLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/asg-updater')),
      timeout: cdk.Duration.seconds(10),
      role: lambdaExecutionRole,
    });

    // Create launch templates first (we need their refs for the custom resource)
    const cudaUserData = this.createUserData(userDataTemplate, coinName, walletAddress);
    const cudaLaunchTemplate = this.createLaunchTemplate(
      'LaunchTemplateCudaX8664',
      instanceProfile,
      imageMap,
      'CudaX8664',
      cudaUserData
    );

    // Create user data for RadeonX8664
    const radeonUserData = this.createUserData(userDataTemplate, coinName, walletAddress);
    const radeonLaunchTemplate = this.createLaunchTemplate(
      'LaunchTemplateRadeonX8664',
      instanceProfile,
      imageMap,
      'RadeonX8664',
      radeonUserData
    );

    // Create user data for DeepLearning
    const deepLearningUserData = this.createUserData(userDataTemplate, coinName, walletAddress);
    const deepLearningLaunchTemplate = this.createLaunchTemplate(
      'LaunchTemplateDeepLearning',
      instanceProfile,
      imageMap,
      'DeepLearning',
      deepLearningUserData
    );

    // Instance type attributes configuration
    // Note: We need to use CloudFormation intrinsic functions to reference launch templates
    // The custom resource will receive these as resolved values
    const instanceTypeAttributes: any[] = [
      {
        InstanceType: 'g4ad.xlarge',
        WeightedCapacity: '48',
        LaunchTemplateSpecification: {
          LaunchTemplateId: radeonLaunchTemplate.ref,
          Version: radeonLaunchTemplate.attrLatestVersionNumber,
        },
      },
      {
        InstanceType: 'g4ad.2xlarge',
        WeightedCapacity: '48',
        LaunchTemplateSpecification: {
          LaunchTemplateId: radeonLaunchTemplate.ref,
          Version: radeonLaunchTemplate.attrLatestVersionNumber,
        },
      },
      {
        InstanceType: 'g4ad.4xlarge',
        WeightedCapacity: '48',
        LaunchTemplateSpecification: {
          LaunchTemplateId: radeonLaunchTemplate.ref,
          Version: radeonLaunchTemplate.attrLatestVersionNumber,
        },
        _ExcludeInRegions: ['ca-central-1', 'eu-central-1'],
      },
      {
        InstanceType: 'g4ad.8xlarge',
        WeightedCapacity: '96',
        LaunchTemplateSpecification: {
          LaunchTemplateId: radeonLaunchTemplate.ref,
          Version: radeonLaunchTemplate.attrLatestVersionNumber,
        },
        _ExcludeInRegions: ['ca-central-1', 'eu-central-1'],
      },
      {
        InstanceType: 'g4ad.16xlarge',
        WeightedCapacity: '192',
        LaunchTemplateSpecification: {
          LaunchTemplateId: radeonLaunchTemplate.ref,
          Version: radeonLaunchTemplate.attrLatestVersionNumber,
        },
        _ExcludeInRegions: ['ca-central-1', 'eu-central-1'],
      },
      {
        InstanceType: 'g5.xlarge',
        WeightedCapacity: '56',
      },
      {
        InstanceType: 'g5.24xlarge',
        WeightedCapacity: '226',
      },
      {
        InstanceType: 'g5.48xlarge',
        WeightedCapacity: '452',
      },
      {
        InstanceType: 'g4dn.xlarge',
        WeightedCapacity: '25',
      },
      {
        InstanceType: 'g4dn.2xlarge',
        WeightedCapacity: '25',
      },
      {
        InstanceType: 'g4dn.12xlarge',
        WeightedCapacity: '100',
      },
      {
        InstanceType: 'g4dn.metal',
        WeightedCapacity: '204',
      },
      {
        InstanceType: 'p3.2xlarge',
        WeightedCapacity: '93',
      },
      {
        InstanceType: 'p3.8xlarge',
        WeightedCapacity: '372',
      },
      {
        InstanceType: 'p3.16xlarge',
        WeightedCapacity: '744',
      },
      {
        InstanceType: 'p3dn.24xlarge',
        WeightedCapacity: '692',
      },
      {
        InstanceType: 'p4d.24xlarge',
        WeightedCapacity: '999',
        LaunchTemplateSpecification: {
          LaunchTemplateId: deepLearningLaunchTemplate.ref,
          Version: deepLearningLaunchTemplate.attrLatestVersionNumber,
        },
      },
    ];

    // Custom resource for instance filter
    const instanceFilterProvider = new customResources.Provider(this, 'InstanceFilterProvider', {
      onEventHandler: instanceFilterLambda,
    });

    const instanceFilter = new cdk.CustomResource(this, 'InstanceFilter', {
      serviceToken: instanceFilterProvider.serviceToken,
      properties: {
        InstanceTypesWanted: instanceTypes.valueAsString,
        InstanceTypesAttributes: instanceTypeAttributes,
      },
    });

    // SNS Topic for notifications
    const notificationTopic = new sns.Topic(this, 'NotificationTopic');

    // Create Auto Scaling Group using CfnAutoScalingGroup to have full control
    const asg = new autoscaling.CfnAutoScalingGroup(this, 'Asg', {
      minSize: '0',
      maxSize: hashrate.valueAsString,
      desiredCapacity: '0', // Will be updated by AsgUpdater
      healthCheckGracePeriod: 900,
      healthCheckType: 'EC2',
      availabilityZones: cdk.Fn.getAzs(''),
      capacityRebalance: true,
      metricsCollection: [
        {
          granularity: '1Minute',
        },
      ],
      terminationPolicies: ['AllocationStrategy', 'OldestLaunchConfiguration'],
      notificationConfigurations: [
        {
          topicArn: notificationTopic.topicArn,
          notificationTypes: [
            'autoscaling:EC2_INSTANCE_LAUNCH',
            'autoscaling:EC2_INSTANCE_TERMINATE',
            'autoscaling:EC2_INSTANCE_LAUNCH_ERROR',
            'autoscaling:EC2_INSTANCE_TERMINATE_ERROR',
          ],
        },
      ],
      tags: [
        {
          key: 'Name',
          value: this.stackName,
          propagateAtLaunch: true,
        },
      ],
      mixedInstancesPolicy: {
        launchTemplate: {
          launchTemplateSpecification: {
            launchTemplateId: cudaLaunchTemplate.ref,
            version: cudaLaunchTemplate.attrLatestVersionNumber,
          },
          overrides: instanceFilter.getAtt('InstanceTypeAttributes'),
        },
        instancesDistribution: {
          spotAllocationStrategy: 'capacity-optimized-prioritized',
          onDemandAllocationStrategy: 'prioritized',
          onDemandBaseCapacity: 0,
          onDemandPercentageAboveBaseCapacity: cdk.Token.asNumber(
            capacityAllocation.findInMap(pricingPlan.valueAsString, 'OnDemandPct')
          ),
        },
      },
      creationPolicy: {
        resourceSignal: {
          count: 0,
          timeout: 'PT1M',
        },
      },
      updatePolicy: {
        autoScalingRollingUpdate: {
          waitOnResourceSignals: false,
        },
      },
    });

    asg.addDependency(instanceFilter);
    asg.addDependency(cudaLaunchTemplate);

    // Custom resource for ASG updater
    const asgUpdaterProvider = new customResources.Provider(this, 'AsgUpdaterProvider', {
      onEventHandler: asgUpdaterLambda,
    });

    const asgUpdater = new cdk.CustomResource(this, 'AsgUpdater', {
      serviceToken: asgUpdaterProvider.serviceToken,
      properties: {
        AsgName: asg.ref,
        DesiredCapacity: hashrate.valueAsString,
        InstanceFilter: instanceFilter.getAttString('InstanceTypeAttributes'),
      },
    });

    asgUpdater.node.addDependency(asg);
    asgUpdater.node.addDependency(instanceFilter);

    // Outputs
    new cdk.CfnOutput(this, 'InstanceTypesRequested', {
      description: 'List of instance types requested in the ASG (filtered by InstanceTypesWanted and regional availability)',
      value: instanceFilter.getAttString('InstanceTypeNames'),
    });

    new cdk.CfnOutput(this, 'NotificationTopicOutput', {
      description: 'Monitoring notification topic',
      value: notificationTopic.topicArn,
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      description: 'Ethermine Dashboard URL',
      value: `https://${coinName.valueAsString}.2miners.com/account/${walletAddress.valueAsString}`,
    });
  }

  private createUserData(template: string, coinName: cdk.CfnParameter, walletAddress: cdk.CfnParameter): cdk.IResolvable {
    // Use CloudFormation Fn::Sub for substitution to match the original template behavior
    // The template uses ${CoinName} and ${WalletAddress} which will be substituted by CloudFormation
    // Pass parameter references directly - CDK will convert them to !Ref in CloudFormation
    return cdk.Fn.sub(template, {
      CoinName: coinName.valueAsString, // This creates a !Ref CoinName in CloudFormation
      WalletAddress: walletAddress.valueAsString, // This creates a !Ref WalletAddress in CloudFormation
    });
  }

  private createLaunchTemplate(
    id: string,
    instanceProfile: iam.CfnInstanceProfile,
    imageMap: cdk.CfnMapping,
    imageType: string,
    userData: cdk.IResolvable
  ): ec2.CfnLaunchTemplate {
    // Get AMI ID for current region
    const amiId = imageMap.findInMap(this.region, imageType);

    // Base64 encode the user data (Fn::Sub result needs to be base64 encoded)
    const userDataBase64 = cdk.Fn.base64(userData);

    const launchTemplate = new ec2.CfnLaunchTemplate(this, id, {
      launchTemplateData: {
        imageId: amiId,
        iamInstanceProfile: {
          arn: instanceProfile.attrArn,
        },
        userData: userDataBase64,
        // We don't specify instance type here as it will be overridden in the ASG
      },
    });

    return launchTemplate;
  }
}