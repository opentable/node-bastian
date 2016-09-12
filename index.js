const EventEmitter = require('events');
const util = require('util');

var _ = require('lodash');

function Bastian(redis) {
  EventEmitter.call(this);
  this.redis = redis;
};

util.inherits(Bastian, EventEmitter);

/**
 * Persists data in Redis, failing silently
 */
Bastian.prototype.persistData = function(desc) {
  var self = this;
  var collection = desc.collection;
  var primary = desc.primary;
  var keyPrefix = desc.keyPrefix;
  var expiration = desc.expiration;

  if (!collection.length) {
    return;
  }

  var multi = this.redis.multi();

  for (var data of collection) {
    var key = `${keyPrefix}:${data[primary]}`;
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
 * @arg desc.keyPrefix String name of Redis HASH for storing data for this collection
 * @arg desc.ids Array of IDs we are looking for
 * @arg desc.primary String representing primary key of data returned by service
 * @arg desc.handler Function(ids, cb) to be called to lookup missing data
 * @arg desc.expiration Number seconds until data should be expired
 * @arg callback Function(err, data) to be called when entire lookup is complete
 */
Bastian.prototype.lookup = function(desc, callback) {
  var keyPrefix = desc.keyPrefix;
  var ids = desc.ids;
  var primary = desc.primary;
  var handler = desc.handler;
  var expiration = desc.expiration || 0;

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
    keys.push(`${keyPrefix}:${id}`);
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

module.exports = Bastian;
