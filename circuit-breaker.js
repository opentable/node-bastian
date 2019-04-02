const opossum = require('opossum');

function setupEventListeners(breaker, eventEmitter, serviceName) {
    breaker.on('open', () => eventEmitter('circuit-open', serviceName));
    breaker.on('halfOpen', () => eventEmitter('circuit-half-open', serviceName));
    breaker.on('close', () => eventEmitter('circuit-close', serviceName));
}

function setupCircuitBreakers(handler, eventEmitter, settings) {
    const {
        enabled = false,
        timeout = 250,
        errorThresholdPercentage = 5,
        resetTimeout = 300,
        serviceName } = settings;

    const breaker = opossum(function (ids) {
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

    setupEventListeners(breaker, eventEmitter, serviceName);
    return breaker;
}

module.exports = setupCircuitBreakers;
