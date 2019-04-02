const EventEmitter = require('events');
const opossum = require('opossum');
const util = require('util');
const _ = require('lodash');

let breakers = {};

function Bastian(redis) {
  EventEmitter.call(this);
  this.redis = redis;
};

util.inherits(Bastian, EventEmitter);

Bastian.prototype.__handle = function (handler, ids, settings, callback) {
  var self = this;

  const { serviceName } = settings;

  if (!breakers[serviceName]) {
    const {
      enabled = false,
      timeout = 250,
      errorThresholdPercentage = 5,
      resetTimeout = 300,
      serviceName } = settings;

    breakers[serviceName] = opossum(function (ids) {
      return new Promise((resolve, reject) => {
        handler(ids, (err, res) => {
          if (err) {
            return reject(err);
          }
          return resolve(res);
        });
      });
    }, {
        enabled,
        timeout,
        errorThresholdPercentage,
        resetTimeout
      });

    breakers[serviceName].on('open', () => self.emit('circuit-open', serviceName));
    breakers[serviceName].on('halfOpen', () => self.emit('circuit-half-open', serviceName));
    breakers[serviceName].on('close', () => self.emit('circuit-close', serviceName));
  }

  return breakers[serviceName].fire(ids)
    .then(res => callback(null, res))
    .catch(err => callback(err));
};

/**
 * Persists data collection in Redis, failing silently
 */
Bastian.prototype.persistData = function (opts) {
  var self = this;
  var collection = opts.collection;
  var primary = opts.primary;
  var keyPrefix = opts.keyPrefix;
  var expiration = opts.expiration;

  if (!collection.length) {
    return;
  }

  var multi = this.redis.multi();

  collection.forEach(function (data) {
    var key = keyPrefix + ':' + data[primary];
    multi.set(key, JSON.stringify(data));
    if (expiration > 0) {
      multi.expire(key, expiration);
    }
  });

  multi.exec(function (saveError) {
    if (saveError) {
      // Problem persisting data to redis
      self.emit('error', saveError);
    }
  });
};

/**
 * Persists a single record in Redis, failing silently
 */
Bastian.prototype.persistSingle = function (opts) {
  var self = this;
  var data = opts.data;
  var key = opts.key;
  var expiration = opts.expiration;

  if (!data) {
    return;
  }

  if (!expiration) {
    return void this.redis.set(key, JSON.stringify(data), function (saveError) {
      if (saveError) {
        self.emit('error', saveError);
      }
    });
  }

  this.redis.multi()
    .set(key, JSON.stringify(data))
    .expire(key, expiration)
    .exec(function (saveError) {
      if (saveError) {
        self.emit('error', saveError);
      }
    });
};

/**
 * Merges existing data with new data
 */
Bastian.prototype.mergeData = function (rawDataAsArray, newDataArray) {
  if (!newDataArray) {
    newDataArray = [];
  }

  var completeArray = rawDataAsArray
    .filter(function (d) {
      return !!d;
    })
    .map(JSON.parse);

  if (newDataArray.length) {
    completeArray = completeArray.concat(newDataArray);
  }

  return completeArray;
};

/**
 * Looks up multiple items in a collection
 *
 * @arg opts.keyPrefix String key prefix for Redis keys for storing data for this collection
 * @arg opts.ids Array of IDs we are looking for
 * @arg opts.primary String representing primary key of data returned by service
 * @arg opts.handler Function(ids, cb) to be called to lookup missing data
 * @arg opts.expiration Number seconds until data should be expired
 * @arg opts.serviceName Name of the service the handler is calling
 * @arg opts.circuitBreakerSettings.enabled Enable Circuit Breaking
 * @arg opts.circuitBreakerSettings.errorThresholdPercentage The error percentage at
 * which to open the circuit and start short-circuiting requests to fallback.
 * @arg opts.circuitBreakerSettings.resetTimeout The time in milliseconds to wait before
 * setting the breaker to `halfOpen` state, and trying the action again.
 * @arg callback Function(err, data) to be called when entire lookup is complete
 */
Bastian.prototype.lookup = function (opts, callback) {
  var keyPrefix = opts.keyPrefix;
  var ids = opts.ids;
  var primary = opts.primary;
  var handler = opts.handler;
  var expiration = opts.expiration || 0;
  var serviceName = opts.serviceName;
  var circuitBreakerSettings = opts.circuitBreakerSettings;
  var self = this;

  if (!ids.length) {
    return void setImmediate(function () {
      callback(null, []);
    });
  }

  if (!this.redis) {
    return void setImmediate(function () {
      self.__handle(
        handler,
        ids,
        Object.assign({ serviceName }, circuitBreakerSettings),
        callback);
    });
  }

  var keys = [];

  ids.forEach(function (id) {
    keys.push(keyPrefix + ':' + id);
  });

  this.redis.mget(keys, function (err, rawDataAsArray) {
    if (err) {
      // Unable to retrieve cache data
      self.emit('error', err, keyPrefix);
      return void self.__handle(
        handler,
        ids,
        Object.assign({ serviceName }, circuitBreakerSettings),
        callback);
    }

    var dataHash = _.zipObject(ids, rawDataAsArray);

    // Empty MGET items have null as value
    var discoveredIds = Object.keys(_.pickBy(dataHash, function (v) {
      return !!v;
    }));

    var remainingIds = _.difference(
      ids.map(String),
      discoveredIds
    );

    if (!remainingIds.length) {
      return void callback(null, self.mergeData(
        rawDataAsArray
      ));
    }

    self.__handle(
      handler,
      remainingIds,
      Object.assign({ serviceName }, circuitBreakerSettings),
      (err, collection) => {
        if (err) {
          return void callback(err);
        }
        // This is done asynchronously, we don't care about result
        self.persistData({
          collection: collection,
          primary: primary,
          keyPrefix: keyPrefix,
          expiration: expiration
        });

        callback(null, self.mergeData(
          rawDataAsArray,
          collection
        ));
      });
  });
};

/**
 * Looks up a single item
 *
 * @arg opts.keyPrefix String partial name of Redis key for storing data for this item
 * @arg opts.id Optional, ID we are looking for, to be combined with keyPrefix
 * @arg opts.handler Function(id, cb) to be called to lookup missing data
 * @arg opts.expiration Number seconds until data should be expired
 * @arg opts.serviceName Name of the service the handler is calling
 * @arg opts.circuitBreakerSettings.enabled Enable Circuit Breaking
 * @arg opts.circuitBreakerSettings.errorThresholdPercentage The error percentage at
 * which to open the circuit and start short-circuiting requests to fallback.
 * @arg opts.circuitBreakerSettings.resetTimeout The time in milliseconds to wait before
 * setting the breaker to `halfOpen` state, and trying the action again.
 * @arg callback Function(err, data) to be called when entire lookup is complete
 */
Bastian.prototype.get = function (opts, callback) {
  var keyPrefix = opts.keyPrefix;
  var id = opts.id || null;
  var handler = opts.handler;
  var expiration = opts.expiration || 0;
  var serviceName = opts.serviceName;
  var circuitBreakerSettings = opts.circuitBreakerSettings;
  var self = this;

  if (!this.redis) {
    return void setImmediate(function () {
      self.__handle(
        handler,
        id,
        Object.assign({ serviceName }, circuitBreakerSettings),
        callback);
    });
  }

  var key = keyPrefix + (id ? ':' + id : '');

  this.redis.get(key, function (err, rawData) {
    if (err) {
      // Unable to retrieve cache data
      self.emit('error', err, keyPrefix);
      return void self.__handle(
        handler,
        id,
        Object.assign({ serviceName }, circuitBreakerSettings),
        callback);
    }

    if (rawData) {
      return void callback(null, JSON.parse(rawData));
    }

    self.__handle(
      handler,
      id,
      Object.assign({ serviceName }, circuitBreakerSettings),
      (err, data) => {
        if (err) {
          return void callback(err);
        }

        // This is done asynchronously, we don't care about result
        self.persistSingle({
          data: data,
          key: key,
          expiration: expiration
        });

        callback(null, data);
      });
  });
};

module.exports = Bastian;
