# Bastian

This tool is useful for situations where you make many requests for known sets of data, and have partial cache misses.

```shell
npm install --save bastian
```

## Example Usage

```javascript
var request = require('request');
var redis = require('redis').createClient();
var Bastian = require('bastian');

var cache = new Bastian(redis);

cache.on('error', function(err) {
  assert.ifError(err);
});

function serviceCall(ids, language, callback) {
  const VERSION = 'v4';
  cache.lookup({
    primary: 'id',
    keyPrefix: 'cuisine-' + language + '-' + VERSION,
    ids: ids,
    expiration: 60 * 60 * 24,
    handler: function(ids, cb) {
      var url = 'http://cuisine.api.opentable.com/' + VERSION + '/cuisines/?lang=' + language + '&ids=[' + ids + ']';

      console.log(`Request: ${url}`);

      request(url, function(err, response, body) {
        if (err) {
          return cb(err);
        }

        if (response.statusCode !== 200) {
          return cb(response.statusCode);
        }

        cb(null, body);
      });
    }
  }, callback);
}

serviceCall([1, 2, 3], 'en-US', function(err, data) {
  // Request: http://cuisine.api.opentable.com/v4/cuisines/?lang=en-US&ids=[1,2,3]
  // data contains items 1, 2, 3
});

serviceCall([3, 4, 5], 'en-US', function(err, data) {
  // Request: http://cuisine.api.opentable.com/v4/cuisines/?lang=en-US&ids=[4,5]
  // data contains items 3, 4, 5
});

serviceCall([1, 2, 3, 4, 5], 'en-US', function(err, data) {
  // No URL request is made!
  // data contains items 1, 2, 3, 4, 5
});

serviceCall([1, 2, 3], 'es-MX', function(err, data) {
  // Request: http://cuisine.api.opentable.com/v4/cuisines/?lang=es-MX&ids=[1,2,3]
  // data contains items 1, 2, 3
});

```

## TODO

* Prevent the same process from making duplicate simultaneous lookups
* Prevent multiple processes from making duplicate simultaneous lookups
