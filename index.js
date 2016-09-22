const EventEmitter = require('events');
const util = require('util');

var _ = require('lodash');

function Bastian(redis) {
  EventEmitter.call(this);
  this.redis = redis;
};

util.inherits(Bastian, EventEmitter);

/**
 * Persists data collection in Redis, failing silently
 */
Bastian.prototype.persistData = function(opts) {
  var self = this;
  var collection = opts.collection;
  var primary = opts.primary;
  var keyPrefix = opts.keyPrefix;
  var expiration = opts.expiration;

  if (!collection.length) {
    return;
  }

  var multi = this.redis.multi();

  for (var data of collection) {
    var key = keyPrefix + ':' + data[primary];
    multi.set(key, JSON.stringify(data));
    if (expiration > 0) {
      multi.expire(key, expiration);
    }
  }

  multi.exec(function(saveError) {
    if (saveError) {
      // Problem persisting data to redis
      self.emit('error', saveError);
    }
  });
};

/**
 * Persists a single record in Redis, failing silently
 */
Bastian.prototype.persistSingle = function(opts) {
  var self = this;
  var data = opts.data;
  var key = opts.key;
  var expiration = opts.expiration;

  if (!data) {
    return;
  }

  if (!expiration) {
    return void this.redis.set(key, JSON.stringify(data), function(saveError) {
      if (saveError) {
        self.emit('error', saveError);
      }
    });
  }

  this.redis.multi()
    .set(key, JSON.stringify(data))
    .expire(key, expiration)
    .exec(function(saveError) {
      if (saveError) {
        self.emit('error', saveError);
      }
    });
};

/**
 * Merges existing data with new data
 */
Bastian.prototype.mergeData = function(rawDataAsArray, newDataArray) {
  if (!newDataArray) {
    newDataArray = [];
  }

  var completeArray = rawDataAsArray
    .filter(d => !!d)
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
 * @arg callback Function(err, data) to be called when entire lookup is complete
 */
Bastian.prototype.lookup = function(opts, callback) {
  var keyPrefix = opts.keyPrefix;
  var ids = opts.ids;
  var primary = opts.primary;
  var handler = opts.handler;
  var expiration = opts.expiration || 0;

  if (!ids.length) {
    return void setImmediate(() => {
      callback(null, []);
    });
  }

  if (!this.redis) {
    return void setImmediate(() => {
      handler(ids, callback);
    });
  }

  var keys = [];

  for (var id of ids) {
    keys.push(keyPrefix + ':' + id);
  }

  this.redis.mget(keys, (err, rawDataAsArray) => {
    if (err) {
      // Unable to retrieve cache data
      this.emit('error', err, keyPrefix);
      return void handler(ids, callback);
    }

    var dataHash = _.zipObject(ids, rawDataAsArray);

    // Empty MGET items have null as value
    var discoveredIds = Object.keys(_.pickBy(dataHash, v => !!v));

    var remainingIds = _.difference(
      ids.map(String),
      discoveredIds
    );

    if (!remainingIds.length) {
      return void callback(null, this.mergeData(
        rawDataAsArray
      ));
    }

    handler(remainingIds, (err, collection) => {
      if (err) {
        return void callback(err);
      }

      // This is done asynchronously, we don't care about result
      this.persistData({
        collection,
        primary,
        keyPrefix,
        expiration
      });

      callback(null, this.mergeData(
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
 * @arg callback Function(err, data) to be called when entire lookup is complete
 */
Bastian.prototype.get = function(opts, callback) {
  var keyPrefix = opts.keyPrefix;
  var id = opts.id || null;
  var handler = opts.handler;
  var expiration = opts.expiration || 0;

  if (!this.redis) {
    return void setImmediate(() => {
      handler(id, callback);
    });
  }

  let key = keyPrefix + (id ? ':' + id : '');

  this.redis.get(key, (err, rawData) => {
    if (err) {
      // Unable to retrieve cache data
      this.emit('error', err, keyPrefix);
      return void handler(id, callback);
    }

    if (rawData) {
      return void callback(null, JSON.parse(rawData));
    }

    handler(id, (err, data) => {
      if (err) {
        return void callback(err);
      }

      // This is done asynchronously, we don't care about result
      this.persistSingle({
        data,
        key,
        expiration
      });

      callback(null, data);
    });
  });
};

module.exports = Bastian;
