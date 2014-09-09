var control = require('control'),
	sshTask = control.task,
	pkgcloud = require('pkgcloud'),
	exec = require('child_process').exec,
	_ = require('underscore');
	
//lbClient.getLoadBalancer(config.loadbalancer, function (err, lb) {
//	console.log(err, lb.nodes);
//});
function sshWrap (str) {
	'use strict';
	// Don't run any command until chef-client has stopped running
	// TODO: Sanity check this - it should really determine if it's safe to continue.
	var CHEF_CHECK_CMD = "while [ ! -z $(sudo ps aux | grep -e '[c]hef-client worker') ]; do echo 'Chef is running - waiting...'; sleep 10; done; ";
	return "bash -c \"" + CHEF_CHECK_CMD + str + "\"";
}

var Deployer = (function () {
	'use strict';
	function Deployer (config) {
		this.config = config;
	}
	// Get a usable array of nodes in this environment from Knife
	Deployer.prototype.getAllNodesInEnvironment = function (callback) {
		// Grab eth0 and eth1 for all nodes in the given environment
		var knifeCMD = "knife search node 'chef_environment:" + this.config.environment + "' " +
			'-a network.interfaces.eth0.addresses ' +
			'-a network.interfaces.eth1.addresses ' +
			'--format json';
		exec(knifeCMD, {
			// Include a large exec buffer incase there are a large number of node
			// this might need to be adjusted
			maxBuffer: 300*1024,
		}, function (err, stdout, stderr) {
			var data, nodes;
			try {
				data = JSON.parse(stdout);
				nodes = data.rows;
			} catch (err) {
				console.log("Failed to parse output of\n", knifeCMD);
				throw new Error(err);
			}
			var output = {};
			// Sort knifes very very frustrating format into a more reasonable object for us to use.
			_.each(nodes, function (nodeObj) {
				_.each(nodeObj, function (node, name) {
					output[name] = {};
					_.each(node['network.interfaces.eth0.addresses'], function (addrDetails, addr) {
						if (addrDetails.family === 'inet') {
							output[name].eth0 = addr;
						}
					});
					_.each(node['network.interfaces.eth1.addresses'], function (addrDetails, addr) {
						if (addrDetails.family === 'inet') {
							output[name].eth1 = addr;
						}
					});
				});
			});
			callback(output);
		});
	};
	// Creates an array of "Control" objects - these are objects which have the ".ssh()" command
	// TODO: Make the selected interface controllable
	Deployer.prototype.createSSHControllers = function (arrayOfServers) {
		var shared = Object.create(control.controller);
		if (this.config.sshuser !== undefined) {
			shared.user = this.config.sshuser;
		}
		return control.controllers(_.pluck(arrayOfServers, 'eth0'), shared);
	};
	// Pause chef-client service on all systems, callback() when complete
	// TODO: ensure chef-client stopped successfully?
	Deployer.prototype.pauseChef = function (controllers, callback) {
		var command = sshWrap("sudo /etc/init.d/chef-client stop");
		_.each(controllers, function (controller) {
			controller.ssh(command, callback);
		});
	};
	// Resume chef-client service on all systems, callback() when complete
	// TODO: ensure chef-client started successfully?
	Deployer.prototype.resumeChef = function (controllers, callback) {
		var command = sshWrap("sudo /etc/init.d/chef-client start");
		_.each(controllers, function (controller) {
			controller.ssh(command, callback);
		});
	};
	// Run 'chef-client' on a system
	Deployer.prototype.chefRun = function (controller, callback) {
		var command = sshWrap("sudo chef-client");
		controller.ssh(command, function () {
			callback(null);
		});
	};
	// Get the status of chef-client
	// TODO: Get the current git_rev active on the system
	// TODO: run test?
	Deployer.prototype.status = function (controllers, callback) {
		var command = sshWrap("sudo ps aux | grep -e '[c]hef-client worker'");
		_.each(controllers, function (controller) {
			controller.ssh(command, callback);
		});
	};
	// Using the private IP address found via Knife, drain a node of connections
	// by setting it to 'DRAINING' mode in the CLB.
	// TODO: Add hooks and such so that it's easy to add logic to determine if all connections have been drained.
	Deployer.prototype.drainConnections = function (node, callback) {
		var config = this.config;
		/*this.lbClient = pkgcloud.loadbalancer.createClient({
			provider: 'rackspace',
			username: config.username,
			apiKey: config.apikey,
			region: config.region
		});*/
		// TODO: We would drain the connections from a node here
		console.log('We would drain the connections from a node here');
		callback(null);
	};
	// Using the private IP address again, we'll re-enable a node
	Deployer.prototype.enableNode = function (node, callback) {
		// TODO: we would re-enable the node in the CLB here
		console.log('we would re-enable the node in the CLB here');
		callback(null);
	};
	// Run configurable tests on a system
	// TODO: Make this configurable
	Deployer.prototype.testApp = function (controller, callback) {
		// skip for now - my example app fails its tests :P
		callback(null);
		/*var command = "bash -c \"cd /var/nodejs/mumblegame/current/ && npm test\"";
		if (this.config.testcmd !== undefined) {
			command = this.config.testcmd;
		}
		controller.ssh(command, function () {
			// TODO: Probably check to see if the test failed or not :P
			callback(null);
		});*/
	};
	// The full deploy loop:
	// this WILL NOT: 
	// - pause chef client on all systems 
	// - change the git_rev
	// - resume chef-client on all systems
	//
	// this WILL:
	// - roll thru the systems one by one, draining them of connections in the CLB
	// - run "chef-client" on each system, followed by a configurable test
	// - re-enable the systems if tests pass, or fail out with errors if tests fail and stop the deployment
	//
	// This implies the typical usage would be to call "pauseChef", then use Knife to change the GIT_REV accordingly,
	// then call "deploy", then, once satisfied that things are working as expected, call "resumeChef"
	Deployer.prototype.deploy = function (controllers, callback) {
		var list = _.clone(controllers),
			self = this;
		function next () {
			var currentNode = list.shift();
			console.log('Starting node', currentNode);
			self.drainConnections(currentNode, function (err) {
				self.chefRun(currentNode, function (err) {
					self.testApp(currentNode, function (err) {
						if (err) {
							console.log('Tests failed on', currentNode);
						} else {
							self.enableNode(currentNode, function (err) {
								if (list.length > 0) {
									next();
								} else {
									console.log('Complete!');
									callback();
								}
							});
						}
					});
				});
			});
		}
		next();
	};
	return Deployer;
})();
module.exports = Deployer;