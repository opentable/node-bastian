var async = require('async');
var Redis = require('redis');
var test = require('tape');
var redis = Redis.createClient();
var request = require('./helper/request.js');
var Bastian = require('../index.js');

test('lookup(): Normal successful usage', function (t) {
  var cache = new Bastian(redis);

  cache.on('error', function (err) {
    t.error(err);
  });

  redis.del([
    'TEST-cuisine-en-US-v4:1',
    'TEST-cuisine-en-US-v4:2',
    'TEST-cuisine-en-US-v4:3',
    'TEST-cuisine-en-US-v4:4',
    'TEST-cuisine-en-US-v4:5',
    'TEST-cuisine-es-MX-v4:1',
    'TEST-cuisine-es-MX-v4:2',
    'TEST-cuisine-es-MX-v4:3',
  ]);

  var cuisineService = {
    getItems: function (ids, language, testRun, callback) {
      const VERSION = 'v4';
      cache.lookup({
        primary: 'id',
        keyPrefix: 'TEST-cuisine-' + language + '-' + VERSION,
        ids: ids,
        expiration: 60 * 60 * 24,
        serviceName: `cuisine-service-${testRun}`,
        handler: function (cuisineIds, cb) {
          var options = {
            url: 'http://cuisine.api.opentable.com/' + VERSION + '/cuisines/?ids=[' + cuisineIds + ']',
            json: true,
            headers: {
              "Accept-Language": language
            }
          };

          t.comment(options.url);

          if (testRun === 1) {
            t.equal(cuisineIds[0], '1');
            t.equal(cuisineIds[1], '2');
            t.equal(cuisineIds[2], '3');
          } else if (testRun === 2) {
            // Note that we're not looking for ids[0] === 3 for it has already been cached
            t.equal(cuisineIds[0], '4');
            t.equal(cuisineIds[1], '5');
          } else if (testRun === 3) {
            t.equal(cuisineIds[0], '1');
            t.equal(cuisineIds[1], '2');
            t.equal(cuisineIds[2], '3');
          } else if (testRun === 4) {
            t.error(new Error('should not execute as all data for this request is in cache'));
          }

          request(options, function (err, response, body) {
            if (err) {
              return cb(err);
            }

            if (response.statusCode > 299) {
              return cb(response.statusCode);
            }

            cb(null, body);
          });
        }
      }, callback);
    }
  };

  async.series([
    function (callback) {
      cuisineService.getItems([1, 2, 3], 'en-US', 1, function (err, data) {
        t.error(err, 'no error');
        t.equal(data[0].id, 1);
        t.equal(data[1].id, 2);
        t.equal(data[2].id, 3);
        callback(err, data);
      });
    },

    function (callback) {
      cuisineService.getItems([3, 4, 5], 'en-US', 2, function (err, data) {
        t.error(err, 'no error');
        t.equal(data[0].id, 3);
        t.equal(data[1].id, 4);
        t.equal(data[2].id, 5);
        callback(err, data);
      });
    },

    function (callback) {
      cuisineService.getItems([1, 2, 3], 'es-MX', 3, function (err, data) {
        t.error(err, 'no error');
        t.equal(data[0].id, 1);
        t.equal(data[1].id, 2);
        t.equal(data[2].id, 3);
        callback(err, data);
      });
    },

    function (callback) {
      cuisineService.getItems([1], 'en-US', 4, function (err, data) {
        t.error(err, 'no error');
        t.equal(data[0].id, 1);
        callback(err, data);
      });
    }
  ], function (err, result) {
    t.error(err, 'no error');
    t.ok(result[0]);
    t.ok(result[1]);
    t.ok(result[2]);
    t.ok(result[3]);

    redis.quit();

    t.end(err);
  });
});

test('lookup(): No redis, go directly to handler', function(t) {
  var cache = new Bastian();

  cache.lookup({
    primary: 'id',
    keyPrefix: 'no-store',
    ids: [1, 2, 3],
    serviceName: 'direct-service',
    handler: function(ids, cb) {
      t.equal(ids.length, 3);

      cb(null, ids.map(function(id) {
        return {
          id: id,
          bigger: id * 10
        };
      }));
    }
  }, function(err, data) {
    t.deepEqual(data, [{id:1,bigger:10},{id:2,bigger:20},{id:3,bigger:30}], 'received data');
    t.end(err);
  });
});

test('lookup(): When handler fails, overall operation should fail', function(t) {
  var cache = new Bastian();

  cache.lookup({
    primary: 'id',
    keyPrefix: 'no-store',
    ids: [1, 2, 3],
    serviceName: 'fail-service',
    handler: function(ids, cb) {
      cb(new Error('uh oh'));
    }
  }, function(err, data) {
    t.ok(err instanceof Error, 'end in error, no data in cache or handler');
    t.end();
  });
});

test('lookup(): When no IDs are provided, operation shouold qucikly return an array', function(t) {
  var cache = new Bastian();

  cache.lookup({
    primary: 'id',
    keyPrefix: 'no-data',
    ids: [],
    serviceName: 'service-name',
    handler: function(ids, cb) {
      throw new Error('should not run');
    }
  }, function(err, data) {
    t.deepEqual(data, [], 'asked for no data, received no data');
    t.end(err);
  });
});

test('lookup(): When Redis.MGET fails, still run the handler', function(t) {
  var failureMgetRedis = {
    mget: function(data, cb) {
      setImmediate(function() {
        cb(new Error('mget failed'));
      });
    }
  };

  var cache = new Bastian(failureMgetRedis);

  var didEmitError = false;

  cache.on('error', function(err) {
    didEmitError = true;
    t.ok(err, 'does have error');
  });

  cache.lookup({
    primary: 'id',
    keyPrefix: 'no-data',
    ids: [100],
    serviceName: 'direct-to-handler-service',
    handler: function(ids, cb) {
      cb(null, 'good stuff');
    }
  }, function(err, data) {
    t.ok(didEmitError, 'did emit error');
    t.end(err);
  });
});
