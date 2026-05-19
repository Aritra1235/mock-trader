interface Config {
    redis: {
        url: string;
    }
    postgres: {
        url: string;
    }
    ttl: {
        charts: number;
        quotes: number;
    }
}

const redisUrl = process.env.REDIS_URL;
if(!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
}

const postgresUrl = process.env.POSTGRES_URL;
if(!postgresUrl) {
    throw new Error('POSTGRES_URL environment variable is required');
}

const chartsCacheTtl = process.env.CHARTS_CACHE_TTL;
if(!chartsCacheTtl) {
    throw new Error('CHARTS_CACHE_TTL environment variable is required');
}
const chartsCacheTtlNum = parseInt(chartsCacheTtl);
if(isNaN(chartsCacheTtlNum)) {
    throw new Error('CHARTS_CACHE_TTL environment variable must be a valid number');
}

const quotesCacheTtl = process.env.QUOTES_CACHE_TTL;
if(!quotesCacheTtl) {
    throw new Error('QUOTES_CACHE_TTL environment variable is required');
}
const quotesCacheTtlNum = parseInt(quotesCacheTtl);
if(isNaN(quotesCacheTtlNum)) {
    throw new Error('QUOTES_CACHE_TTL environment variable must be a valid number');
}

const config: Config = {
    redis: {
        url: redisUrl
    },
    postgres: {
        url: postgresUrl
    },
    ttl: {
        charts: chartsCacheTtlNum,
        quotes: quotesCacheTtlNum
    }
};

export default config;