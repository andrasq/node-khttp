k-http
======

Thin, light-weight convenience wrapper around http and https.
Makes web requests kinda like `qhttp`, returns responses kinda like `request`.


Example
-------

    var khttp = require('k-http');

    var requestBody = { n: 1234 }
    khttp.request("http://example.com", requestBody, function(err, res, responseBody) {
        // ...
    })


Api
---

### khttp.request( urlOrOptions, [body,] callback(err, res, body) )

Make a web request to the url string or target specified by the options.
The options are passed directly to `http.request` or `https.request`.

Arguments:
- `urlOrOptions` - remote service specification, either as a url string
  or an http options object.  String urls use `GET`.
- `body` - request body to send, optional.  Can be a string, Buffer or object.
  Strings and Buffers are sent as-is, all other types (objects, numbers, etc)
  are json stringified before being sent.
- `callback` - function to receive the response.  The callback is passed any
  error, the response object, and the decoded response body.  For better compatibility
  with existing code, the response is annotated with `res.body` = `body`.

k-http options (kinda like `request`):
- `url` - remote host to connect to, specified as a string in the form
  protocol://host/path?query
- `body` - request body to send, as described above (default empty string "").
  A body passed as a function parameter overrides a body passed in options.
- `query` - query string to append to the path, without the leading `?` (default none)
- `encoding` - how to decode the response.  Set to `null` to return the raw
  response bytes in a Buffer, else returns a string converted with `toString(encoding)`
  (default 'utf8' strings)
- `json` - supply a Content-Type request header of application/json unless already set,
  and parse the response body string into a json object and return the object.
  If the response is not valid json, returns the response string.
- `auth` - object with fields `{ username: , password: }` used to build an
  "Authorization: Basic" header.  The fields `{ user: , pass: }` are also accepted.

http options used to construct a url from parts:
- `protocol` - 'http:' or 'https:' (default 'http:')
- `method` - http verb of the request (default 'GET')
- `host` - name of remote host to connect to.  Do not include the port,
  it breaks http (default `localhost`)
- `hostname` - name of remote host to connect to (default `localhost`)
- `port` - remote port to connect to (default `80`)
- `path` - resource path to access (default `/`)

Other options are presumed to be http options and are passed to the request.

### khttp.defaults( urlOrOptions )

Construct a pre-configured caller with a method `request` that will use
khttp.request to make calls.

The options are as in khttp.request.  Call-time options provided to
`callre.request` override the default options.


Related Work
------------

- [request](http://npmjs.org/package/request)
- [qhttp](http://npmjs.org/package/qhttp)
- [restify jsonClient](http://npmjs.org/package/restify)


Chane Log
---------

- 1.1.0 - `defaults()` function to return a pre-configured caller
- 1.0.1 - speed access to res.body, readme edits
- 1.0.0 - initial checkin
