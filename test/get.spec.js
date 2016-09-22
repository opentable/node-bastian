var async = require('async');
var Redis = require('redis');
var test = require('tape');
var request = require('./helper/request-single.js');
var Bastian = require('../index.js');

test('get(): Normal successful usage', function(t) {
  var redis = Redis.createClient();
  var cache = new Bastian(redis);

  cache.on('error', function(err) {
    t.error(err);
  });

  redis.del([
    'TEST-cuisine-en-US-v4:1',
    'TEST-cuisine-en-US-v4:2',
    'TEST-cuisine-es-MX-v4:1',
    'TEST-cuisine-es-MX-v4:2',
  ]);

  var testRun = 0;
  var cuisineService = {
    getItem: function(id, language, callback) {
      testRun += 1;

      const VERSION = 'v4';
      cache.get({
        keyPrefix: 'TEST-cuisine-' + language + '-' + VERSION,
        id: id,
        expiration: 60 * 60 * 24,
        handler: function(id, cb) {
          var options = {
            url: 'http://restaurant.api.opentable.com/' + VERSION + '/restaurants/?id=' + id,
            json: true,
            headers: {
              "Accept-Language": language
            }
          };

          t.comment(options.url);

          if (testRun === 1) {
            t.equal(id, 1);
          } else if (testRun === 2) {
            t.equal(id, 2);
          } else if (testRun === 3) {
            t.equal(id, 1);
          } else if (testRun === 4) {
            t.error(new Error('should not execute as the data for this request is in cache'));
          }

          request(options, function(err, response, body) {
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
    function(callback) {
      cuisineService.getItem(1, 'en-US', function(err, data) {
        t.error(err, 'no error');
        t.equal(data.id, 1);
        callback(err, data);
      });
    },

    function(callback) {
      cuisineService.getItem(2, 'en-US', function(err, data) {
        t.error(err, 'no error');
        t.equal(data.id, 2);
        callback(err, data);
      });
    },

    function(callback) {
      cuisineService.getItem(1, 'es-MX', function(err, data) {
        t.error(err, 'no error');
        t.equal(data.id, 1);
        callback(err, data);
      });
    },

    function(callback) {
      cuisineService.getItem(1, 'en-US', function(err, data) {
        t.error(err, 'no error');
        t.equal(data.id, 1);
        callback(err, data);
      });
    }
  ], function(err, result) {
    t.error(err, 'no error');
    t.ok(result[0]);
    t.ok(result[1]);
    t.ok(result[2]);
    t.ok(result[3]);

    redis.quit();

    t.end(err);
  });
});

test('get(): No redis, go directly to handler', function(t) {
  var cache = new Bastian();

  cache.get({
    keyPrefix: 'no-store',
    id: 1,
    handler: function(id, cb) {
      t.equal(id, 1);

      cb(null, id * 10);
    }
  }, function(err, data) {
    t.deepEqual(data, 10, 'received data');
    t.end(err);
  });
});

test('get(): When handler fails, overall operation should fail', function(t) {
  var cache = new Bastian();

  cache.get({
    keyPrefix: 'no-store',
    id: 1,
    handler: function(id, cb) {
      cb(new Error('uh oh'));
    }
  }, function(err, data) {
    t.ok(err instanceof Error, 'end in error, no data in cache or handler');
    t.end();
  });
});

test('get(): When no ID is provided, operation should run normally', function(t) {
  var cache = new Bastian();

  cache.get({
    keyPrefix: 'no-data',
    handler: function(id, cb) {
      t.notOk(id);
      setImmediate(function() {
        cb(null, 'ok');
      });
    }
  }, function(err, data) {
    t.deepEqual(data, 'ok', 'asked for no id, received data');
    t.end(err);
  });
});

test('get(): When Redis.GET fails, still run the handler', function(t) {
  var failureGetRedis = {
    get: function(data, cb) {
      setImmediate(function() {
        cb(new Error('mget failed'));
      });
    }
  };

  var cache = new Bastian(failureGetRedis);

  var didEmitError = false;

  cache.on('error', function(err) {
    didEmitError = true;
    t.ok(err, 'does have error');
  });

  cache.get({
    keyPrefix: 'no-data',
    id: 100,
    handler: function(id, cb) {
      cb(null, 'good stuff');
    }
  }, function(err, data) {
    t.ok(didEmitError, 'did emit error');
    t.end(err);
  });
});

test('get(): With redis, no expiration', function(t) {
  var redis = Redis.createClient();
  redis.del([
    'no-expire:1',
  ]);

  var cache = new Bastian(redis);

  cache.get({
    keyPrefix: 'no-expire',
    id: 1,
    handler: function(id, cb) {
      t.equal(id, 1);

      cb(null, id * 10);
    }
  }, function(err, data) {
    t.deepEqual(data, 10, 'received data');
    redis.quit();
    t.end(err);
  });
});

test('get(): With redis, no id', function(t) {
  var redis = Redis.createClient();
  redis.del([
    'no-expire',
  ]);

  var cache = new Bastian(redis);

  cache.get({
    keyPrefix: 'no-expire',
    handler: function(id, cb) {
      t.equal(id, null, 'id should be null');

      cb(null, 100);
    }
  }, function(err, data) {
    t.deepEqual(data, 100, 'received data');
    redis.quit();
    t.end(err);
  });
});
