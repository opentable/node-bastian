var url = require('url');

/**
 * Mimics some of the behavior of the request module
 */
module.exports = function(options, callback) {
  var parsed = url.parse(options.url);

  var id = Number(parsed.query.match(/id=([0-9]*)/)[1]); // Convert ids back into array of numbers

  // Resolves an array of objects
  var lang = options.headers['Accept-Language'];

  fakeData = {
    id: id,
    name: lang === 'en-US' ? "Cool Cuisine #" + id : "Tipo de cocina fresca #" + id,
    language: lang
  };

  var response = {
    statusCode: 200
  };

  setImmediate(function() {
    callback(null, response, fakeData);
  });
};
