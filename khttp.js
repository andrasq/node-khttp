/**
 * Copyright (c) 2016-2017, Kinvey, Inc. All rights reserved.
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
    var onSocketTimeout = null;
    var socketTimer = null;
    var req;

    if (!callback) { callback = requestBody; requestBody = undefined }

    var options = { headers: {} };
    mergeOptions(options, callerOptions);

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
        clearTimeout(socketTimer);
        if (!isDone || module.exports.allowDuplicateCallbacks) {
            isDone = true;
            callback(err, res, body);
        }
    }

    // arrange to error out on connect or data timeouts
    // avoid req.setTimeout, socket timeouts leak memory in node v6.8.0 - v6.9.4
    if (options.timeout > 0) {
        var connected = false;
        onSocketTimeout = function onSocketTimeout( ) {
            if (!connected) {
                req.abort();
                var err = new Error("connect timeout");
                err.code = 'ETIMEDOUT';
            } else {
                req.socket.destroy();
                var err = new Error("data timeout");
                err.code = 'ESOCKETTIMEDOUT';
            }
            returnOnce(err, req);
        }
        // time out the connection in case of eg a slow dns lookup
        socketTimer = setTimeout(onSocketTimeout, options.timeout);
    }

    var protocolEngine = (options.protocol === 'https:') ? https : http;
    req = protocolEngine.request(options, function(res) {
        var chunks = new Array();

        // connection made, switch to data timeout
        if (options.timeout > 0) {
            connected = true;
            clearTimeout(socketTimer);
            socketTimer = setTimeout(onSocketTimeout, options.timeout);
        }

        // not sure res errors can ever happen, but just in case
        res.on('error', function(err) {
            returnOnce(err, req, res);
        })

        res.on('data', function(chunk) {
            chunks.push(chunk);
            // reset data timeout on every chunk
            if (options.timeout > 0) {
                clearTimeout(socketTimer);
                socketTimer = setTimeout(onSocketTimeout, options.timeout);
            }
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

    // listen for http and tcp errors
    req.once('error', function(err) {
        returnOnce(err, req);
    })

    // send the http request
    req.end(requestBody);

    return req;
}


module.exports = {
    request: krequest,

    defaults: function defaults(options) {
        var caller = {
            opts: mergeOptions({}, options),
            request: function(url, body, cb) {
                var opts = {};
                mergeOptions(opts, this.opts);
                mergeOptions(opts, url);
                // use module.exports for testability
                return module.exports.request(opts, body, cb);
            },
            defaults: defaults,
        };
        return addAliases(caller);
    },

    // for testing
    allowDuplicateCallbacks: false,
};
addAliases(module.exports);

// decorate the khttp caller with handy aliases
function addAliases( caller ) {
    caller.call = function call(method, url, body, cb) {
        return caller.request(mergeOptions({method: method}, url), body, cb);
    };
    // make available the aliases `request` does, for familiarity
    caller.get = function get(url, body, cb) { return caller.call('GET', url, body, cb) };
    caller.head = function del(url, body, cb) { return caller.call('HEAD', url, body, cb) };
    caller.post = function post(url, body, cb) { return caller.call('POST', url, body, cb) };
    caller.put = function put(url, body, cb) { return caller.call('PUT', url, body, cb) };
    caller.patch = function patch(url, body, cb) { return caller.call('PATCH', url, body, cb) };
    caller.del = function del(url, body, cb) { return caller.call('DELETE', url, body, cb) };

    return optimizeAccess(caller);
}

// optimize access to the object properties
function optimizeAccess( object ) {
    function F() {};
    return F.prototype = object;
    try { } finally { }
}

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

// merge http request options, handling headers properly
function mergeOptions( to, from ) {
    // special case convert url strings to url options
    if (typeof from === 'string') from = { url: from };

    // merge in new request options, but not any headers yet
    var existingHeaders = to.headers;
    for (var k in from) {
        // the url is special, handle baseUrl-relative paths
        if (k === 'url' && typeof from.url === 'string' && from.url[0] === '/' && to.url != null) {
            to.url += from.url;
        }
        else to[k] = from[k];
    }
    if (existingHeaders != null) to.headers = existingHeaders;

    // then merge in headers from a valid headers object
    if (from.headers && typeof from.headers === 'object') {
        if (!to.headers) to.headers = {};
        for (var k in from.headers) {
            // clear header if undefined, node http disallows undefined headers
            if (from.headers[k] !== undefined) to.headers[k] = from.headers[k];
            else delete to.headers[k];
        }
    }

    return to;
}

// speed access to res.body
http.IncomingMessage.prototype.body = http.IncomingMessage.prototype.body || null;
http.IncomingMessage.prototype = http.IncomingMessage.prototype;
