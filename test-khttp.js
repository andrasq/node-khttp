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

var assert = require('assert');
var http = require('http');
var https = require('https');
var khttp = require('.');

var httpRequest = khttp.request;
//httpRequest = require('./ar/httpRequest.js');

var echoService = 'http://localhost:1337';
var pingService = echoService + '/ping';
var slowCallMs = 100;

describe ('khttp', function() {
    var echoServer;
    var echoRequest = null;
    var singletonCall;
    var uniq = null;

    before (function(done) {
        echoServer = http.createServer(function(req, res) {
            var chunks = [];
            req.on('data', function(chunk) {
                chunks.push(chunk);
            })
            req.on('end', function() {
                echoRequest = Buffer.concat(chunks);
                var echoResponse = JSON.stringify({
                    url: req.url,
                    method: req.method,
                    headers: req.headers,
                    rawHeaders: req.rawHeaders,
                    body: echoRequest.toString(),
                });
                if (/^\/ping/.test(req.url)) {
                    return res.end('PONG:' + echoResponse);
                }
                else switch (req.url) {
                case '/':
                case '/default':
                default:
                    return res.end(echoResponse);
                case '/slowcall':
                    res.write(echoResponse.slice(0, 1));
                    return setTimeout(function() { res.end(echoResponse.slice(1)) }, slowCallMs);
                case '/badjson':
                    return res.end("{error");
                case '/responseerror':
                    return res.socket.destroy();
                case '/notjson':
                    return res.end("not json:" + echoResponse);
                case '/garbled':
                    return res.socket.write("bad response\r\n\r\n");
                }
            })
            req.on('error', function(err) {
                throw err;
            })
        })
        echoServer.on('error', function(err) {
            throw err;
        })
        echoServer.once('listening', done);
        echoServer.listen(1337);
    })

    beforeEach(function(done) {
        uniq = (Math.random() * 0x1000000).toString(16);
        echoRequest = null;
        done();
    })

    afterEach(function(done) {
        khttp.allowDuplicateCallbacks = false;
        httpRequest.allowDuplicateCallbacks = false;
        done();
    })

    after (function(done) {
        echoServer.close();
        setTimeout(done, 20);
    })


    it ('should parse package', function(done) {
        require('./package.json');
        done();
    })

    it ('should export expected properties', function(done) {
        assert.equal(typeof httpRequest, 'function');
        assert.equal(typeof khttp.allowDuplicateCallbacks, 'boolean');
        done();
    })

    it ('should make a request to a url string', function(done) {
        httpRequest(echoService, function(err, res, body) {
            assert.ifError();
            assert.equal(JSON.parse(body).url, '/');
            assert.equal(JSON.parse(body).method, 'GET');
            done();
        })
    })

    it ('should make a request to the url with query and body', function(done) {
        httpRequest({ url: pingService, body: uniq, query: 'a=1&b=2' }, function(err, res, body) {
            assert(body.indexOf('PONG:') === 0);
            body = JSON.parse(body.slice(5));
            assert.equal(body.url, '/ping?a=1&b=2');
            assert.equal(body.body, uniq);
            assert.equal(body.headers.connection, 'close');
            done();
        })
    })

    it ('should make a request to the host, port, path', function(done) {
        httpRequest({ host: 'localhost', port: 1337, body: uniq, query: 'a=11&b=22', path: '/default' }, function(err, res, body) {
            body = JSON.parse(body);
            assert.equal(body.url, '/default?a=11&b=22');
            assert.equal(body.body, uniq);
            done();
        })
    })

    it ('should accept url as a function parameter', function(done) {
        httpRequest({ url: echoService, body: 'some test body' }, uniq, function(err, res, body) {
            assert.ifError();
            assert.equal(JSON.parse(body).body, uniq);
            done();
        })
    })

    it ('should append query to path', function(done) {
        httpRequest({ url: echoService + '?a=1', body: uniq, query: 'b=2' }, function(err, res, body) {
            body = JSON.parse(body);
            assert.equal(body.url, '/?a=1&b=2');
            done();
        })
    })

    it ('should use the specified method', function(done) {
        httpRequest({ url: echoService, method: 'post', body: uniq }, function(err, res, body) {
            assert.ifError(err);
            body = JSON.parse(body);
            assert.equal(body.method, 'POST');
            assert.equal(body.body, uniq);
            done();
        })
    })

    it ('should include the passed headers', function(done) {
        httpRequest({ url: echoService, headers: {'x-uniq': uniq} }, function(err, res, body) {
            assert.ifError(err);
            assert.equal(JSON.parse(body).headers['x-uniq'], uniq);
            done();
        })
    })

    it ('should return the client request object', function(done) {
        var req = httpRequest({ url: echoService }, function(err, res, body) { });
        assert(req instanceof http.ClientRequest);
        done();
    })

    it ('should return the response body', function(done) {
        var req = httpRequest({ url: echoService, body: uniq }, function(err, res, body) {
            assert(res instanceof http.IncomingMessage);
            assert(typeof body === 'string');
            assert(res.body === body);
            assert(body.indexOf('"body":"' + uniq) > 0);
            done();
        })
    })

    it ('should connect timeout error', function(done) {
        // hit a valid (plausible) ip address that does not respond
        var startTime = Date.now()
        httpRequest({ host: '10.0.0.1', path: '/', timeout: 20 }, function(err, res, body) {
            assert(err);
            assert(Date.now() - startTime < 50);
            assert.equal(err.code, 'ETIMEDOUT');
            done();
        })
    })

    it ('should time out socket', function(done) {
        httpRequest({ url: echoService + '/slowcall', timeout: slowCallMs / 5 }, function(err, res, body) {
            assert(err);
            assert.equal(err.code, 'ESOCKETTIMEDOUT');
            done();
        })
    })

    it ('should return socket error', function(done) {
        httpRequest({ url: echoService + '/responseerror' }, function(err, res, body) {
            assert(err);
            assert(err.toString().indexOf('socket hang up') >= 0);
            done();
        })
    })

    it ('should return response error', function(done) {
        khttp.allowDuplicateCallbacks = true;
httpRequest.allowDuplicateCallbacks = true;
        httpRequest({ url: echoService }, function(err, res, body) {
            if (!err) res.emit('error', new Error('deliberate res error'));
            if (err) {
                khttp.allowDuplicateCallbacks = false;
                done();
            }
        })
    })

    it ('should accept keepAlive Agent to reuse connection', function(done) {
        var agent = new http.Agent({ keepAlive: true });
        httpRequest({ url: echoService, agent: agent }, function(err, res, body) {
            assert.ifError(err);
            body = JSON.parse(body);
            assert.equal(body.headers.connection, 'keep-alive');
            done();
        })
    })

    it ('should accept string body', function(done) {
        httpRequest({ url: echoService, body: uniq.toString() }, function(err, res, body) {
            assert.ifError(err);
            assert.strictEqual(JSON.parse(body).body, uniq.toString());
            done();
        })
    })

    it ('should accept Buffer body', function(done) {
        httpRequest({ url: echoService, body: new Buffer(uniq.toString()) }, function(err, res, body) {
            assert.ifError(err);
            assert.strictEqual(JSON.parse(body).body, uniq.toString());
            done();
        })
    })

    it ('should accept object body', function(done) {
        httpRequest({ url: echoService, body: {uniq: uniq} }, function(err, res, body) {
            assert.ifError(err);
            assert.deepEqual(JSON.parse(JSON.parse(body).body), {uniq: uniq});
            done();
        })
    })

    it ('should accept non-string, non-object body', function(done) {
        httpRequest({ url: echoService, body: 1234 }, function(err, res, body) {
            assert.ifError(err);
            assert.strictEqual(JSON.parse(body).body, '1234');
            done();
        })
    })

    it ('should send binary data', function(done) {
        var data = new Buffer(256);
        for (var i=0; i<256; i++) data[i] = i;
        httpRequest({ method: 'POST', url: echoService, body: data }, function(err, res, body) {
            assert.deepEqual(echoRequest, data);
            done();
        })
    })

    it ('should send utf8 strings', function(done) {
        var str = '';
        // skip the troublesome code points D800..DFFF which encode to FFFD but charCodeAt(i) remains D800
        for (var i=0; i<65536; i++) str += (i < 0xD800 || i > 0xDFFF) ? String.fromCharCode(i) : ' ';
        httpRequest({ method: 'POST', url: echoService, body: str }, function(err, res, body) {
            assert.strictEqual(JSON.parse(body).body, str);
            done();
        })
    })

    it ('encoding:null should return a Buffer of bytes', function(done) {
        httpRequest({ url: echoService, encoding: null }, function(err, res, body) {
            assert(Buffer.isBuffer(body));
            done();
        })
    })

    it ('json:true should make application/json request and decode response into object', function(done) {
        httpRequest({ url: echoService, json: true, body: { uniq: uniq } }, function(err, res, body) {
            assert.ifError(err);
            assert(typeof body === 'object');
            assert.equal(body.headers['content-type'], 'application/json');
            assert.deepEqual(JSON.parse(body.body), {uniq: uniq});
            done();
        })
    })

    it ('json:true should return non-json strings as-is', function(done) {
        httpRequest({ url: echoService + '/notjson', json: true, body: {a: uniq} }, function(err, res, body) {
            assert.ifError(err);
            assert.equal(typeof body, 'string');
            assert(body.indexOf('not json:') == 0);
            done();
        })
    })

    it ('json:true should not overwrite user specified content-type', function(done) {
        httpRequest({ url: echoService, json: true, body: {uniq: uniq}, headers: {'content-type': 'user-content-type'} }, function(err, res, body) {
            assert.ifError(err);
            assert(typeof body === 'object');
            assert.equal(body.headers['content-type'], 'user-content-type');
            done();
        })
    })

    it ('json:true should send non-json capable objects as plaintext', function(done) {
        var nthCall = 0;
        var requestBody = { toJSON: function() { throw new Error("not json capable") } };
        httpRequest({ url: echoService, json: true }, requestBody, function(err, res, body) {
            assert.equal(body.body, '[object Object]');
            done();
        })
    })

    it ('auth:{user,pass} should be converted into Authorization header', function(done) {
        var uri = { url: echoService, auth: {user: 'test1', pass: 'test2'}, json: true };
        httpRequest(uri, function(err, res, body) {
            assert.equal(body.headers.authorization, 'Basic ' + new Buffer('test1:test2').toString('base64'));
            done();
        })
    })

    it ('auth:{username,password} should be converted into Authorization header', function(done) {
        var uri = { url: echoService, auth: {username: 'test3', password: 'test4'}, json: true };
        httpRequest(uri, function(err, res, body) {
            assert.equal(body.headers.authorization, 'Basic ' + new Buffer('test3:test4').toString('base64'));
            done();
        })
    })

    it ('should make https calls', function(done) {
        httpRequest({ url: "https://google.com" }, function(err, res, body) {
            assert.ifError(err);
            assert.equal(res.statusCode, 301);
            done();
        })
    })

    it ('should callback only once', function(done) {
        var calledCount = 0;
        var req = httpRequest({ url: "http://localhost:1337" }, function(err, res, body) {
            calledCount += 1;
            req.emit('error', new Error("deliberate response error"));
            if (calledCount > 1) return done(new Error("too many callbacks"));
            setTimeout(function(){ done() }, 50);
        })
    })

    describe ('performance', function() {
        it ('should use little cpu', function(done) {
            var caller = httpRequest;
            //var caller = require('request');
            var doneCount = 0;
            var cpu = process.cpuUsage();
            var t1 = Date.now();
            var uri = {
                url: "https://google.com/login",        // 1.5k
            }
            for (var callCount=0; callCount<10; callCount++) {
                caller(uri, callDone);
            }
            function callDone(err, res, body) {
                doneCount += 1;
                if (doneCount === callCount) {
                    var t2 = Date.now();
                    cpu = process.cpuUsage(cpu);
                    console.log("%s: %d calls in %d ms, total cpu %d ms (%d bytes)", caller.name, callCount, t2-t1, cpu.user/1000 + cpu.system/1000, body.length);
                    // timed on a cpu with cpufreq/scaling_governor set to "performance":
                    // https small:    khttp: 20ms for 10, request: 32ms for 10 (1.5k)
                    done();
                }
            }
        })
    })
})
