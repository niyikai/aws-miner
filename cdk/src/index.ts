#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MinerStack } from './miner-stack';

const app = new cdk.App();
new MinerStack(app, 'MinerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});