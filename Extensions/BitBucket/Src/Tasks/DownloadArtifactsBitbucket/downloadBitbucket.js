var tl = require('azure-pipelines-task-lib/task');
var path = require('path');
var webApim = require('vso-node-api/WebApi');
var gitInterfaces = require('vso-node-api/interfaces/GitInterfaces');
var Q = require('q');
var url = require('url');
var shell = require("shelljs");
var scw = require('./sourcecontrolwrapper.js');
var https = require("https");

var repositoryId = tl.getInput("definition");
var branch = tl.getInput("branch");
var commitId = tl.getInput("version");
var downloadPath = tl.getInput("downloadPath");
var bitbucketEndpoint = getEndpointDetails("connection");

shell.rm('-rf', downloadPath);
var error = shell.error();
if (error) {
    tl.error(error);
    tl.exit(1);
}


var path = "/2.0/repositories/" + repositoryId;
var options = {
    host: "api.bitbucket.org",
    method: "GET",
    path: path
};

// Set authentication based on the endpoint type
if (bitbucketEndpoint.Token) {
    options.auth = bitbucketEndpoint.Username + ':' + bitbucketEndpoint.Token;
} else if (bitbucketEndpoint.Username && bitbucketEndpoint.Password) {
    options.auth = bitbucketEndpoint.Username + ':' + bitbucketEndpoint.Password;
}

https.request(options, function (rs) {
    tl.debug(`HTTP status: ${rs.statusCode} ${rs.statusMessage}`);
    var result;
    var response = '';
    rs.on('data', function (data) {
        tl.debug("repository details:" + data)
        response += data
    });
    rs.on('end', function () {
        result = JSON.parse(response);
        tl.debug("result:" + JSON.stringify(result));
        var sch = new scw.SourceControlWrapper(result.scm);
        
        sch.on('stdout', function (data) {
            console.log(data.toString());
        });
        sch.on('stderr', function (data) {
            console.log(data.toString());
        });
        
        var remoteUrl = result.links.clone[0].href;
        tl.debug("Remote Url:" + remoteUrl);
        
        // encodes projects and repo names with spaces
        var repoUrl = url.parse(remoteUrl);
        if (bitbucketEndpoint.Token) {
            // For token authentication, use the token as password with 'x-bitbucket-api-token-auth' as username
            repoUrl.auth = 'x-bitbucket-api-token-auth:' + bitbucketEndpoint.Token;
        } else if (bitbucketEndpoint.Username && bitbucketEndpoint.Password) {
            repoUrl.auth = bitbucketEndpoint.Username + ':' + bitbucketEndpoint.Password;
        }
        
        // if branch, we want to clone remote branch name to avoid tracking etc.. ('/refs/remotes/...')
        var ref;
        var brPre = 'refs/heads/';
        if (branch.startsWith(brPre)) {
            ref = 'refs/remotes/origin/' + branch.substr(brPre.length, branch.length - brPre.length);
        }
        else {
            ref = branch;
        }
        
        var options = {
            creds: true,
            debugOutput: this.debugOutput
        };
        if (bitbucketEndpoint.Token) {
            sch.username = 'x-bitbucket-api-token-auth';
            sch.password = bitbucketEndpoint.Token;
        } else {
            sch.username = bitbucketEndpoint.Username;
            sch.password = bitbucketEndpoint.Password;
        }

        Q(0).then(function (code) {
            return sch.clone(repoUrl.format(repoUrl), false, downloadPath, options)
                       .then(
                function (code) {
                    shell.cd(downloadPath);
                    return sch.checkout(ref, options);
                })
                       .then(
                function (code) {
                    return sch.checkout(commitId);
                })
                       .fail(
                function (error) {
                    tl.error(error);
                    tl.exit(1);
                });
        });
    });
}).end();

function getEndpointDetails(inputFieldName) {
    var bitbucketEndpoint = tl.getInput(inputFieldName);
    var auth = tl.getEndpointAuthorization(bitbucketEndpoint, false);
    var scheme = auth.scheme.toLowerCase().trim();
    
    if (scheme === "token") {
        var token = getAuthParameter(bitbucketEndpoint, 'apitoken');
        var username = getAuthParameter(bitbucketEndpoint, 'email') || '';
        tl.debug('Using token authentication');
        return {
            "Token": token,
            "Username": username
        };
    } else if (scheme === "usernamepassword") {
        var hostUsername = getAuthParameter(bitbucketEndpoint, 'username');
        var hostPassword = getAuthParameter(bitbucketEndpoint, 'password');
        tl.debug('hostUsername: ' + hostUsername);
        tl.debug('hostPassword: ' + hostPassword);
        return {
            "Username": hostUsername,
            "Password": hostPassword
        };
    } else {
        throw new Error("The authorization scheme " + auth.scheme + " is not supported for a bitbucket endpoint. Please use either 'usernamepassword' or 'token'.");
    }
}

function getAuthParameter(endpoint, paramName) {
    var paramValue = null;
    var auth = tl.getEndpointAuthorization(endpoint, false);
    var scheme = auth.scheme.toLowerCase().trim();
    
    if (scheme !== "usernamepassword" && scheme !== "token") {
        throw new Error("The authorization scheme " + auth.scheme + " is not supported for a bitbucket endpoint. Please use either 'usernamepassword' or 'token'.");
    }
    
    var keyName = getCaseInsensitiveKeyMatch(auth['parameters'], paramName);
    paramValue = auth['parameters'][keyName];

    return paramValue;
}

function getCaseInsensitiveKeyMatch(data, paramName) {
    var keyName;
    var parameters = Object.getOwnPropertyNames(data);
    parameters.some(function (key) {
        if (key.toLowerCase() === paramName.toLowerCase()) {
            keyName = key;
            return true;
        }
    });
    
    return keyName;
}
