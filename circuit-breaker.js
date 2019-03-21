import opossum from 'opossum';
import statsd from 'app/adapters/statsd';

function reportStats({ name, status }) {
    const statKey = `circuit.service.${name}.${status}`;
    statsd.increment(statKey);
}

function setupEventListeners(breaker, { service }) {
    breaker.on('open', () => reportStats(service, 'open'));
    breaker.on('halfOpen', () => reportStats(service, 'open'));
    breaker.on('close', () => reportStats(service, 'open'));
}

function setupCircuitBreakers(handler, settings) {
    const breaker = opossum(handler, settings);

    if (settings.fallback) {
        breaker.fallback(settings.fallback);
    }

    setupEventListeners(breaker);

    return breaker;
}

export default setupCircuitBreakers;
    