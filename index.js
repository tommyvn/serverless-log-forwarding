'use strict';

const _ = require('underscore');

class LogForwardingPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    /* Hooks tell Serverless when to do what */
    this.hooks = {
      'package:initialize': this.updateResources.bind(this),
    };
  }


  /**
   * Updates CloudFormation resources with log forwarding
   */
  updateResources() {
    // check if stage is specified in config
    const service = this.serverless.service;
    const stage = this.options.stage && this.options.stage.length > 0
      ? this.options.stage
      : service.provider.stage;
    if (service.custom.logForwarding.stages &&
      service.custom.logForwarding.stages.indexOf(stage) === -1) {
      this.serverless.cli.log(`Log Forwarding is ignored for ${stage} stage`);
      return;
    }

    this.serverless.cli.log('Updating Log Forwarding Resources...');
    const resourceObj = this.createResourcesObj();
    if (this.serverless.service.resources === undefined) {
      this.serverless.service.resources = {
        Resources: {},
      };
    } else if (this.serverless.service.resources.Resources === undefined) {
      this.serverless.service.resources.Resources = {};
    }
    _.extend(this.serverless.service.resources.Resources, resourceObj);
    this.serverless.cli.log('Log Forwarding Resources Updated');
  }


  /**
   * Creates CloudFormation resources object with log forwarding
   * @return {Object} resources object
   */
  createResourcesObj() {
    const service = this.serverless.service;
    // Checks if the serverless file is setup correctly
    if (service.custom.logForwarding.destinationARN == null) {
      throw new Error('Serverless-log-forwarding is not configured correctly. Please see README for proper setup.');
    }
    const filterPattern = service.custom.logForwarding.filterPattern || '';
    // Get options and parameters to make resources object
    const arn = service.custom.logForwarding.destinationARN;
    // Get list of all functions in this lambda
    const functions = _.keys(service.functions);
    const principal = `logs.${service.provider.region}.amazonaws.com`;
    // Generate resources object for each function
    // Only one lambda permission is needed
    const resourceObj = {
      LogForwardingLambdaPermission: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: arn,
          Action: 'lambda:InvokeFunction',
          Principal: principal,
        },
      },
    };
    for (let i = 0; i < functions.length; i += 1) {
      /* merge new SubscriptionFilter with current resources object */
      const subscriptionFilter = this.makeSubscriptionFilter(arn, functions[i], filterPattern);
      _.extend(resourceObj, subscriptionFilter);
    }
    return resourceObj;
  }


  /**
   * Makes a Subscription Filter object for given function name
   * @param  {String} arn          arn of the lambda to forward to
   * @param  {String} functionName name of function to make SubscriptionFilter for
   * @param  {String} filterPattern filter pattern for the Subscription
   * @return {Object}               SubscriptionFilter
   */
  makeSubscriptionFilter(arn, functionName, filterPattern) {
    const functionObject = this.serverless.service.getFunction(functionName);
    const logGroupName = this.provider.naming.getLogGroupName(functionObject.name);
    const filterLogicalId = `SubscriptionFilter${this.provider.naming.getNormalizedFunctionName(functionName)}`;
    const functionLogGroupId = this.provider.naming.getLogGroupLogicalId(functionName);
    const filter = {};
    filter[filterLogicalId] = {
      Type: 'AWS::Logs::SubscriptionFilter',
      Properties: {
        DestinationArn: arn,
        FilterPattern: filterPattern,
        LogGroupName: logGroupName,
      },
      DependsOn: [
        'LogForwardingLambdaPermission',
        functionLogGroupId,
      ],
    };
    return filter;
  }
}

module.exports = LogForwardingPlugin;
