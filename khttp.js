/**
 * Copyright (c) 2016, Kinvey, Inc. All rights reserved.
 *
 * This software is licensed to you under the Kinvey terms of service located at
 * http://www.kinvey.com/terms-of-use. By downloading, accessing and/or using this
 * software, you hereby accept such terms of service  (and any agreement referenced
 * therein) and agree that you have read, understand and agree to be bound by such
 * terms of service and are of legal age to agree to such terms with Kinvey.
 *
 * This software contains valuable confidential and proprietary information of
 * KINVEY, INC and is subject to applicable licensing agreements.
 * Unauthorized reproduction, transmission or distribution of this file and its
 * contents is a violation of applicable laws.
 */

'use strict';

var http = require('http');
var https = require('https');
var Url = require('url');

/**
 * http caller, makes calls like http and returns responses kinda like request
 */
function krequest(callerOptions, requestBody, callback) {
    var connectTimer = null;
    var onSocketTimeout = null;

    if (!callback) { callback = requestBody; requestBody = undefined }

    if (typeof callerOptions === 'string') callerOptions = { url: callerOptions };

    var k;
    var options = {};
    for (k in callerOptions) options[k] = callerOptions[k];
    options.headers = {};
    for (k in callerOptions.headers) options.headers[k] = callerOptions.headers[k];

    // parse url kinda like request
    if (options.url) {
        var parsedUrl = Url.parse(options.url);
        delete options.host;
        options.protocol = parsedUrl.protocol;
        options.hostname = parsedUrl.hostname;
        options.port = parsedUrl.port;
        options.path = parsedUrl.path;
    }

    // http.request wants the query string appended to the path
    if (options.query) {
        options.path += (options.path.indexOf('?') < 0 ? '?' : '&') + options.query;
    }

    // handle auth kinda like request
    if (options.auth && typeof options.auth === 'object') {
        var user = options.auth.user || options.auth.username;
        var pass = options.auth.pass || options.auth.password;
        options.headers['Authorization'] = "Basic " + new Buffer(user + ":" + pass).toString('base64');
    }

    // json-encode request body and set content-length kinda like request
    requestBody = requestBody !== undefined ? requestBody : options.body != null ? options.body : "";
    if (typeof requestBody === 'string' || Buffer.isBuffer(requestBody)) {
        // body is already stringified, send as-is
    }
    else if (options.json || typeof requestBody === 'object' && requestBody) {
        // json-encode objects by default; to avoid, pre-convert them to strings
        requestBody = try_json_encode(requestBody);
        if (!options.headers['Content-Type'] && !options.headers['content-type']) options.headers['Content-Type'] = 'application/json'
    }
    else requestBody = '' + requestBody;
    options.headers['Content-Length'] = (typeof requestBody === 'string') ? Buffer.byteLength(requestBody) : requestBody.length;

    var isDone = false;
    function returnOnce(err, req, res, body) {
        clearTimeout(connectTimer);
        if (onSocketTimeout) {
            req.removeListener('timeout', onSocketTimeout);
            req.socket.removeListener('timeout', onSocketTimeout);
        }
        if (!isDone || module.exports.allowDuplicateCallbacks) {
            isDone = true;
            callback(err, res, body);
        }
    }

    var protocolEngine = (options.protocol === 'https:') ? https : http;
    var req = protocolEngine.request(options, function(res) {
        clearTimeout(connectTimer);
        var chunks = new Array();

        res.on('error', function(err) {
            // can this event ever happen?  invalid http and tcp errors both to to req.on 'error'
            returnOnce(err, req, res);
        })

        res.on('data', function(chunk) {
            chunks.push(chunk);
        })

        res.on('end', function() {
            var responseBody = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);

            // decode into a `request` formatted response body
            responseBody = options.json ? try_json_decode(responseBody)
                : (options.encoding !== null) ? responseBody.toString(options.encoding)
                : responseBody;
            res.body = responseBody;

            returnOnce(null, req, res, res.body);
        })
    })

    req.once('error', function(err) {
        returnOnce(err, req);
    })

    req.end(requestBody);

    if (options.timeout > 0) {
        var timeout = parseInt(options.timeout);

        // use a timer to time out even a connect blocked on a dns lookup
        connectTimer = setTimeout(function() {
            req.abort();
            var err = new Error("connect timeout");
            err.code = 'ETIMEDOUT';
            returnOnce(err, req);
        }, timeout);

        // setTimeout before the socket is connected to make nock work
        // the timeout handler is called from req.socket, ie socket exists
        onSocketTimeout = function() {
            var err = new Error("data timeout");
            err.code = 'ESOCKETTIMEDOUT';
            req.socket.destroy();
            returnOnce(err, req);
        }
        req.setTimeout(timeout, onSocketTimeout);
    }

    return req;
}

module.exports = {
    request: krequest,

    // for testing
    allowDuplicateCallbacks: false,
};

// decode json into object, or return the string if not valid json
function try_json_decode( str ) {
    try { return JSON.parse(str) }
    catch (err) { return '' + str }
}

// exception-safe object to json conversion
function try_json_encode( obj ) {
    try { return JSON.stringify(obj) }
    catch (err) { return '' + obj }
}
