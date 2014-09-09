'use strict';

var pkgcloud = require('pkgcloud'),
    async = require('async'),
    _ = require('underscore'),
    config = require('./config.js');

var client = pkgcloud.services.loadbalancer.createClient(config.cloud);

function ensureStatus (loadBalancerId, callback) {
    client.getLoadBalancer(loadBalancerId, function (err, lb) {
        if (err) {
            callback(err);
            return;
        }
        // We don't want to to do anything if we're not in a known state to begin with
        if (lb.status !== 'ACTIVE') {
            callback(new Error('Load Balancer status not active'));
            return;
        }
        // check the status of each nodes. We want all of our nodes enabled
        // before we begin rotating nodes in and out
        if (_.any(lb.nodes, function (node) {
            return node.condition !== 'ENABLED';
        }) {
            callback(new Error('All nodes must be condition:ENABLED to deploy');
            return;
        }
        // If you want to any app specific validation, you could call out to that here
        // If we meet a minimum validation, lets callback with no errors
        callback();
    });
}

function updateNodeCondition (lb, node, newCondition) {
    // we return a function here so we can use this inside of async.series
    return function (next) {
        node.condition = newCondition;
        console.log('Updating Node [' + node.address + '] to condition [' + node.condition + ']');
        // first lets update the node condition
        client.updateNode(lb, node, function (err) {
            if (err) {
                next(err);
                return;
            }
            // second, lets wait for the load balancer to tell us the change
            // has been completed, and we're back at active status
            lb.setWait({
                status: 'ACTIVE'
            }, 2500, next);
        });
    }
}

function rotateNodeOut (nodeAddress, lb, callback) {
    // first, lets find the address in our list of nodes
    var node = lb.nodes.filter(function (node) {
        return node.address === nodeAddress;
    })[0];
    if (!node) {
        callback(new Error('Unable to find requested node'));
        return;
    }
    if (node.condition !== 'ENABLED') {
        callback(new Error('Node must be condition:ENABLED before rotating'));
        return;
    }
    async.series([
        //updateNodeCondition(lb, node, 'DRAINING'), // this stops new incoming connections
        //waitForAppConnectionsToClose, // This would be your function to identify if connections are complete
        updateNodeCondition(lb, node, 'DISABLED') // move to disabled condition
    ], callback);
}

function rotateOutAndDeploy (ips, lb, callback) {
    async.series([
        function (next) {
            // rotate out each ip in our array
            async.forEach(ips, function (address, cb) {
                rotateNodeOut(address, lb, cb);
            }, next)
        },
        function (cb) {
            // we're going to assume you have a callback based function to
            // deploy your code here. This could be an ssh command, or anything
            // where you actually push the code and restart your services
            deploy_code(ips, cb);
        }
    ], callback);
}

function rotateIn (ips, lb, callback) {
    async.forEach(ips, function (address, next) {
        // we don't need a multi-step process here, so we can
        // just invoke the returned function with cb directly
        updateNodeStatus(address, lb, 'ACTIVE')(next);
    }, callback);
}

function deploy (loadBalancerId, poolA, poolB, callback) {
    var lb;
    async.series([
        function (next) { ensureStatus(loadBalancerId, function (err, loadBalancer) {
            if (err) {
                next(err);
                callback;
            }
            lb = loadBalancer;
            next();
        },
        function (next) { rotateOutAndDeploy(poolA, lb, next); },
        function (next) { rotateIn(poolA, lb, next); },
        function (next) { rotateOutAndDeploy(poolB, lb, next); },
        function (next) { rotateIn(poolB, lb, next); },
        // lets make sure we return the load balancer to a known state
        function (next) { ensureStatus(loadBalancerId, next); }
        // this would be something you do post deployment
        function (next) { verifyDeployment(next); }
    ], function (err) {
        if (err) {
            callback(err);
            return;
        }
        console.log('W00t! Successful Deployment');
        callback();
    });
}

