var url = require('url');

/**
 * Mimics some of the behavior of the request module
 */
module.exports = function(options, callback) {
  var parsed = url.parse(options.url);

  var ids = parsed.query.match(/ids=\[([0-9,]*)\]/)[1].split(',').map(Number); // Convert ids back into array of numbers

  // Resolves an array of objects
  var fakeData = [];

  var lang = options.headers['Accept-Language'];

  for (var id of ids) {
    fakeData.push({
      id: id,
      name: lang === 'en-US' ? "Cool Cuisine #" + id : "Tipo de cocina fresca #" + id,
      language: lang
    });
  }

  var response = {
    statusCode: 200
  };

  setImmediate(function() {
    callback(null, response, fakeData);
  });
};
