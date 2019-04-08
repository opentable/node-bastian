# Bastian

This tool is useful for situations where you make many requests for known sets of data, and have partial cache misses.

For example, if you would like to access restaurants `1, 2, 3`, and you already have restaurants `2, 3, 4` in the cache, you should only read restaurant `1` from disk.

```shell
npm install --save bastian
```

## Example Collection Usage

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
          return cb(new Error("Unable to load data from remote server"));
        }

        cb(null, body); // Be sure to resolve an array of objects with id (primary) attributes
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

## Example Singular Usage

We also expose a method called `.get()` which is useful for loading singular items.

Note that the `id` parameter is optional.
If present it will be appended to the key in the same manner that `lookup()` appends (they're compatible).
If missing it will not be appended and will not be provided to `handler()`.

```javascript
var request = require('request');
var redis = require('redis').createClient();
var Bastian = require('bastian');

var cache = new Bastian(redis);

cache.on('error', function(err) {
  assert.ifError(err);
});

function serviceCall(id, language, callback) {
  const VERSION = 'v4';
  cache.get({
    keyPrefix: 'restaurant-' + language + '-' + VERSION,
    id: id,
    expiration: 60 * 60 * 24,
    handler: function(id, cb) {
      var url = 'http://restaurant.api.opentable.com/' + VERSION + '/restaurants/?lang=' + language + '&id=' + ids;

      console.log(`Request: ${url}`);

      request(url, function(err, response, body) {
        if (err) {
          return cb(err);
        }

        if (response.statusCode !== 200) {
          return cb(new Error("Unable to load data from remote server"));
        }

        cb(null, body); // Whatever is returned will be cached
      });
    }
  }, callback);
}

serviceCall(1, 'en-US', function(err, data) {
  // Request: http://restaurant.api.opentable.com/v4/restaurants/?lang=en-US&id=1
  // data contains item 1
});

serviceCall(2, 'en-US', function(err, data) {
  // Request: http://restaurant.api.opentable.com/v4/restaurants/?lang=en-US&id=2
  // data contains item 2
});

serviceCall(1, 'en-US', function(err, data) {
  // No URL request is made!
  // data contains item 1
});

serviceCall(1, 'es-MX', function(err, data) {
  // Request: http://restaurant.api.opentable.com/v4/restaurants/?lang=es-MX&id=1
  // data contains item 1
});
```

## TODO

* Prevent the same process from making duplicate simultaneous lookups
  * Keep a local array of requested entities
* Prevent multiple processes from making duplicate simultaneous lookups
  * Keep a list of requested entities in Redis
  * Use Pub/Sub to announce when data has become available
* Introduce Circuit breaker for when services go down
  * Redis has natural back-off logic baked into the client; but internal OT services we can spam when they're down
