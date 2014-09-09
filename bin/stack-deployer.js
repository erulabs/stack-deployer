(function () {
	'use strict';

	var cli = require('commander'),
		config = {},
		action = false;

	cli.version('0.0.1')
		.option('-c, --config <path>', 'Path to config.json')
		.option('-u, --username <username>', 'Rackspace Cloud API username')
		.option('-k, --apikey <apikey>', 'Rackspace Cloud API key')
		.option('-e, --environment <env>', 'Name of environment where git_rev will be changed')
		.option('-l, --loadbalancer <UUID>', 'Load balancer of nodes to modify')
		.option('-U, --sshuser <sshuser>', 'Username for SSH')
		.option('-i, --sshkey <sshkey>', 'private key for SSH')
		.option('-R, --region <region>', 'Rackspace region code - defaults to IAD');

	cli.command('pauseChef')
		.description('Suspends chef-client on all nodes - will wait for running job to finish if needed')
		.action(function (cmd, options) {
			action = 'pauseChef';
		});
	cli.command('resumeChef')
		.description('Resumes chef-client on all nodes')
		.action(function (cmd, options) {
			action = 'resumeChef';
		});
	cli.command('deploy')
		.description('The full deploy loop - see README.md for details')
		.action(function (cmd, options) {
			action = 'deploy';
		});
	cli.command('status')
		.description('Shows chef-client and current git_rev status of each node')
		.action(function (cmd, options) {
			action = 'status';
		});

	cli.parse(process.argv);

	// nodestack-deployer -u username -k apikey -e prod -l UUID 

	// Get config from file if defined (-c)
	if (cli.config) {
		config = require(cli.config);
	}
	if (cli.sshuser !== undefined) {
		config.sshuser = cli.sshuser;
	}
	if (cli.region === undefined) {
		cli.region = 'IAD';
	}

	// Ensure minimum options are met:
	var mandatoryOptions = ['username', 'apikey', 'loadbalancer', 'environment', 'region'],
		missingOptions = [], i, len, opt;
	for (i = 0, len = mandatoryOptions.length; i < len; i += 1) {
		opt = mandatoryOptions[i];
		if (cli[opt]) {
			config[opt] = cli[opt];
		}
		if (config[opt] === undefined) {
			missingOptions.push(opt);
		}
	}
	// Error out if not:
	if (missingOptions.length > 0) {
		console.log('Minimum options not met. Missing:', missingOptions.join(', '));
		process.exit();
	}

	// Run desired action
	var NodeStackDeployer = require('../lib/stack-deployer.js');
	var deployer = new NodeStackDeployer(config);

	if (!action) {
		console.log('Usage: deployer [options] <action>');
	} else {
		deployer.getAllNodesInEnvironment(function (nodes) {
			var controllers = deployer.createSSHControllers(nodes);
			if (action === 'pauseChef') {
				deployer.pauseChef(controllers, function () {
					console.log('Chef paused');
				});
			} else if (action === 'resumeChef') {
				deployer.resumeChef(controllers, function () {
					console.log('Chef resumed');
				});
			} else if (action === 'deploy') {
				deployer.deploy(controllers, function () {
					console.log('Deploy complete');
				});
			} else if (action === 'status') {
				deployer.status(controllers, function () {
					console.log('Status complete');
				});
			}
		});
	}

	/*deployer.getAllNodesInEnvironment(function (nodes) {
		var controllers = deployer.createSSHControllers(nodes);
		deployer.resumeChef(controllers);
	});*/

}).call(this);
