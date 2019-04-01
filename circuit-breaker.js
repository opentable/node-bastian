const opossum = require('opossum');

function setupEventListeners(breaker, eventEmitter, serviceName) {
    breaker.on('open', () => eventEmitter.emit('circuit-open', serviceName));
    breaker.on('halfOpen', () => eventEmitter.emit('circuit-half-open', serviceName));
    breaker.on('close', () => eventEmitter.emit('circuit-close', serviceName));
}

function setupCircuitBreakers(handler, eventEmitter, settings) {
    const {
        enabled,
        timeout,
        errorThresholdPercentage,
        resetTimeout,
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
